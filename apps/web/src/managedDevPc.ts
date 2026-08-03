import { randomUUID } from "./lib/utils";

export type ManagedDevPcWorkspaceState =
  | "starting"
  | "ready"
  | "restarting"
  | "paused"
  | "stopped"
  | "error";

export type ManagedDevPcDisplayStatus =
  | "running"
  | "starting"
  | "restarting"
  | "pausing"
  | "paused"
  | "stopped"
  | "restoring"
  | "reconnecting"
  | "unreachable"
  | "attention";

export interface ManagedDevPcTelemetry {
  readonly sampledAt: string;
  readonly receivedAt: string;
  readonly cpuPercent: number | null;
  readonly memory: {
    readonly usedBytes: number;
    readonly totalBytes: number;
  };
  readonly disks: {
    readonly root: {
      readonly usedBytes: number;
      readonly totalBytes: number;
    } | null;
    readonly workspace: {
      readonly usedBytes: number;
      readonly totalBytes: number;
    } | null;
  };
  readonly uptimeSeconds: number;
  readonly t3Healthy: boolean;
}

export interface ManagedDevPcBootstrap {
  readonly managed: true;
  readonly state: ManagedDevPcWorkspaceState;
  readonly status?: ManagedDevPcDisplayStatus;
  readonly ready: boolean;
  readonly connected?: boolean;
  readonly requiresResume?: boolean;
  readonly pairingToken?: string;
  readonly previewUrlTemplate: string;
  readonly previewUrls?: Readonly<Record<string, string>>;
  readonly region?: string | null;
  readonly t3Version?: string | null;
  readonly runtimeVersion?: string | null;
  readonly agentVersion?: string | null;
  readonly lastHeartbeatAt?: string | null;
  readonly lastActivityAt?: string | null;
  readonly connectedAt?: string | null;
  readonly idleTimeoutMinutes?: number;
  readonly autoStopAt?: string | null;
  readonly machine?: {
    readonly cpuCount: number;
    readonly memoryBytes: number;
  };
  readonly telemetry?: ManagedDevPcTelemetry | null;
  readonly detail?: string;
}

export const isManagedDevPc = import.meta.env.VITE_DEVPC_MANAGED === "1";

const BOOTSTRAP_PATH = "/_devpc/bootstrap";
const START_PATH = "/_devpc/workspace/start";
const WEBSOCKET_TICKET_PATH = "/_devpc/ws-ticket";
export const MANAGED_WORKSPACE_ACTION_STORAGE_KEY = "devpc-managed-workspace-action";
export const MANAGED_WORKSPACE_ACTION_CLEARED_EVENT = "devpc-managed-workspace-action-cleared";
const SESSION_RECOVERY_KEY = "devpc-managed-session-recovery-at";
const SESSION_RECOVERY_COOLDOWN_MS = 30_000;
const MAX_RESUME_WAIT_POLLS = 40;
const MANAGED_WAKE_SLOW_THRESHOLD_MS = 75_000;
let sessionRecoveryReloadScheduled = false;
let bootstrapResumeRequestKey: string | undefined;
let bootstrapResumeUsesSharedStorage = false;
let lastAnnouncedWakeState: string | undefined;

export function isAmbiguousLifecycleResponse(status: number): boolean {
  return status === 408 || status >= 500;
}

export function requiresManagedResume(bootstrap: ManagedDevPcBootstrap): boolean {
  const resumable = new Set(["paused", "stopped"]);
  if (bootstrap.status) return resumable.has(bootstrap.status);
  return Boolean(bootstrap.requiresResume || resumable.has(bootstrap.state));
}

export function isManagedBootstrapRunning(bootstrap: ManagedDevPcBootstrap): boolean {
  return bootstrap.status
    ? bootstrap.status === "running"
    : bootstrap.state === "ready" && bootstrap.ready;
}

export function shouldPromptManagedResume(
  bootstrap: ManagedDevPcBootstrap,
  resumeAccepted: boolean,
): boolean {
  return requiresManagedResume(bootstrap) && !resumeAccepted;
}

export function shouldRepromptManagedResume(resumeAccepted: boolean, waitPolls: number): boolean {
  return resumeAccepted && waitPolls >= MAX_RESUME_WAIT_POLLS;
}

export function isManagedResumeTransition(bootstrap: ManagedDevPcBootstrap): boolean {
  return ["starting", "restoring", "reconnecting"].includes(bootstrap.status ?? bootstrap.state);
}

export type ManagedWakePhase = "machine" | "connection" | "workspace";

export interface ManagedWakePresentation {
  readonly title: string;
  readonly description: string;
  readonly timing: string;
  readonly delayed: boolean;
}

export function managedWakePhase(bootstrap: ManagedDevPcBootstrap): ManagedWakePhase {
  if (isManagedBootstrapRunning(bootstrap)) return "workspace";
  const status = bootstrap.status ?? bootstrap.state;
  if (bootstrap.connected || status === "reconnecting") return "connection";
  return "machine";
}

export function managedWakePresentation(
  phase: ManagedWakePhase,
  elapsedMs: number,
): ManagedWakePresentation {
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  const delayed = elapsedMs >= MANAGED_WAKE_SLOW_THRESHOLD_MS;
  const timing = delayed
    ? `Taking longer than usual · ${elapsedSeconds}s elapsed`
    : elapsedSeconds >= 10
      ? `Still working · ${elapsedSeconds}s elapsed`
      : "Usually ready in about a minute";

  switch (phase) {
    case "connection":
      return {
        title: "Connecting securely",
        description: "Your machine is awake. Aldo is establishing its private connection.",
        timing,
        delayed,
      };
    case "workspace":
      return {
        title: "Opening your workspace",
        description: "The secure connection is ready. Aldo is loading your workspace.",
        timing,
        delayed,
      };
    case "machine":
      return {
        title: "Waking your workspace",
        description: "Your private machine is powering on. Your files and threads are safe.",
        timing,
        delayed,
      };
  }
}

export function clearCompletedPauseAction(bootstrap: ManagedDevPcBootstrap): void {
  reconcileBootstrapLifecycleAction(bootstrap);
}

type StoredManagedWorkspaceAction = {
  readonly action: "pause" | "restart" | "resume";
  readonly phase?: "pending" | "uncertain";
  readonly idempotencyKey?: string;
  readonly progressObserved?: boolean;
  readonly restartConfirmations?: number;
};

function readStoredManagedWorkspaceAction(): StoredManagedWorkspaceAction | null {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(MANAGED_WORKSPACE_ACTION_STORAGE_KEY) ?? "null",
    ) as Partial<StoredManagedWorkspaceAction> | null;
    if (!stored || !["pause", "restart", "resume"].includes(String(stored.action))) return null;
    return stored as StoredManagedWorkspaceAction;
  } catch {
    return null;
  }
}

function writeStoredManagedWorkspaceAction(stored: StoredManagedWorkspaceAction): boolean {
  try {
    window.localStorage.setItem(MANAGED_WORKSPACE_ACTION_STORAGE_KEY, JSON.stringify(stored));
    return true;
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
    return false;
  }
}

function clearStoredManagedWorkspaceAction(
  action: StoredManagedWorkspaceAction["action"],
  idempotencyKey?: string,
): void {
  try {
    const stored = readStoredManagedWorkspaceAction();
    if (stored) {
      if (
        stored.action !== action ||
        (idempotencyKey !== undefined && stored.idempotencyKey !== idempotencyKey)
      ) {
        return;
      }
      window.localStorage.removeItem(MANAGED_WORKSPACE_ACTION_STORAGE_KEY);
    } else if (
      action !== "resume" ||
      bootstrapResumeRequestKey !== idempotencyKey ||
      bootstrapResumeUsesSharedStorage
    ) {
      return;
    }
    if (action === "resume") {
      bootstrapResumeRequestKey = undefined;
      bootstrapResumeUsesSharedStorage = false;
    }
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

export function readPersistedManagedResume(): {
  readonly requestKey: string;
  readonly accepted: boolean;
  readonly uncertain: boolean;
} | null {
  const stored = readStoredManagedWorkspaceAction();
  if (
    stored?.action !== "resume" ||
    typeof stored.idempotencyKey !== "string" ||
    stored.idempotencyKey.length === 0
  ) {
    return null;
  }
  return {
    requestKey: stored.idempotencyKey,
    accepted: stored.progressObserved === true,
    uncertain: stored.phase === "uncertain",
  };
}

export function ownsPersistedManagedResume(requestKey: string): boolean {
  const stored = readStoredManagedWorkspaceAction();
  return stored
    ? stored.action === "resume" && stored.idempotencyKey === requestKey
    : !bootstrapResumeUsesSharedStorage && bootstrapResumeRequestKey === requestKey;
}

export function reconcileBootstrapLifecycleAction(
  bootstrap: ManagedDevPcBootstrap,
): "pending-restart-confirmation" | null {
  try {
    const stored = readStoredManagedWorkspaceAction();
    if (!stored) return null;
    const action = stored.action;
    const status = bootstrap.status ?? bootstrap.state;
    const running = isManagedBootstrapRunning(bootstrap);
    const incompatibleRestart = action === "restart" && requiresManagedResume(bootstrap);
    if (incompatibleRestart) {
      window.localStorage.removeItem(MANAGED_WORKSPACE_ACTION_STORAGE_KEY);
      if (typeof window.dispatchEvent === "function") {
        window.dispatchEvent(
          new CustomEvent(MANAGED_WORKSPACE_ACTION_CLEARED_EVENT, {
            detail: { action },
          }),
        );
      }
      return null;
    }
    const restartProgressFromStatus =
      action === "restart" && ["restarting", "starting", "restoring"].includes(status);
    const progressObserved =
      stored.progressObserved === true ||
      restartProgressFromStatus ||
      (action === "resume" && ["starting", "restoring", "reconnecting"].includes(status));
    const completed =
      (action === "pause" && ["paused", "stopped"].includes(status)) ||
      (action === "resume" && running);
    if (completed) {
      window.localStorage.removeItem(MANAGED_WORKSPACE_ACTION_STORAGE_KEY);
      if (action === "resume") {
        bootstrapResumeRequestKey = undefined;
        bootstrapResumeUsesSharedStorage = false;
      }
      if (typeof window.dispatchEvent === "function") {
        window.dispatchEvent(
          new CustomEvent(MANAGED_WORKSPACE_ACTION_CLEARED_EVENT, {
            detail: { action },
          }),
        );
      }
      return null;
    }
    if (action === "restart" && progressObserved && running) {
      const previousConfirmations =
        typeof stored.restartConfirmations === "number" &&
        Number.isInteger(stored.restartConfirmations) &&
        stored.restartConfirmations >= 0
          ? stored.restartConfirmations
          : 0;
      if (previousConfirmations >= 1) {
        window.localStorage.removeItem(MANAGED_WORKSPACE_ACTION_STORAGE_KEY);
        if (typeof window.dispatchEvent === "function") {
          window.dispatchEvent(
            new CustomEvent(MANAGED_WORKSPACE_ACTION_CLEARED_EVENT, {
              detail: { action },
            }),
          );
        }
        return null;
      }
      writeStoredManagedWorkspaceAction({
        ...stored,
        progressObserved: true,
        restartConfirmations: 1,
      });
      return "pending-restart-confirmation";
    }
    if (progressObserved && (stored.progressObserved !== true || restartProgressFromStatus)) {
      writeStoredManagedWorkspaceAction({
        ...stored,
        progressObserved: true,
        restartConfirmations: restartProgressFromStatus ? 0 : (stored.restartConfirmations ?? 0),
      });
    }
    return null;
  } catch {
    // Storage can be unavailable or contain an obsolete record.
    return null;
  }
}

function updateBootstrapMessage(
  message: string,
  failed = false,
  phase: ManagedWakePhase = "machine",
  elapsedMs = 0,
): void {
  const root = document.getElementById("root");
  if (!root) return;
  root.replaceChildren();
  const presentation = managedWakePresentation(phase, elapsedMs);
  const surface = document.createElement("main");
  surface.className =
    "managed-wake-surface flex h-dvh min-h-0 justify-center overflow-x-hidden overflow-y-auto bg-background px-6 py-12 text-foreground";
  const wakeState = `${phase}:${presentation.delayed ? "delayed" : "expected"}`;
  const announceState = !failed && wakeState !== lastAnnouncedWakeState;
  surface.ariaLive = failed ? "assertive" : announceState ? "polite" : "off";
  surface.ariaBusy = "false";
  if (!failed) lastAnnouncedWakeState = wakeState;
  const content = document.createElement("section");
  content.className = "w-full max-w-md";

  const logo = document.createElement("img");
  logo.className = "mb-8 size-11 rounded-xl";
  logo.src = "/apple-touch-icon.png";
  logo.alt = "";
  logo.width = 44;
  logo.height = 44;

  const eyebrow = document.createElement("p");
  eyebrow.className =
    "mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground";
  eyebrow.textContent = "Workspace status";

  const title = document.createElement("h1");
  title.className = "text-balance text-2xl font-semibold tracking-tight sm:text-3xl";
  const detail = document.createElement("p");
  detail.className = "mt-3 text-pretty text-sm leading-6 text-muted-foreground sm:text-base";

  if (failed) {
    title.textContent = "Workspace unavailable";
    detail.textContent = message;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className =
      "mt-6 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => window.location.reload());
    content.append(logo, eyebrow, title, detail, retry);
    surface.append(content);
    root.append(surface);
    return;
  }

  title.textContent = presentation.title;
  detail.textContent = presentation.description;

  const progressTrack = document.createElement("div");
  progressTrack.className = "mt-8 h-1 overflow-hidden rounded-full bg-muted";
  progressTrack.role = "progressbar";
  progressTrack.ariaLabel = "Workspace wake progress";
  progressTrack.ariaValueText = presentation.timing;
  const progressIndicator = document.createElement("div");
  progressIndicator.className =
    "h-full w-2/5 rounded-full bg-primary motion-safe:animate-managed-wake-progress motion-reduce:hidden";
  progressTrack.append(progressIndicator);

  const stages = document.createElement("ol");
  stages.className = "mt-7 space-y-4";
  const stageDefinitions: ReadonlyArray<readonly [ManagedWakePhase, string]> = [
    ["machine", "Starting your private machine"],
    ["connection", "Connecting securely"],
    ["workspace", "Opening your workspace"],
  ];
  const activeStage = stageDefinitions.findIndex(([stage]) => stage === phase);
  for (const [index, [, label]] of stageDefinitions.entries()) {
    const completed = index < activeStage;
    const active = index === activeStage;
    const item = document.createElement("li");
    item.className = `flex items-center gap-3 text-sm ${
      active ? "font-medium text-foreground" : "text-muted-foreground"
    }`;
    const marker = document.createElement("span");
    marker.className = completed
      ? "flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground"
      : active
        ? "flex size-6 shrink-0 items-center justify-center rounded-full border border-primary bg-primary/10 text-xs text-primary motion-safe:animate-status-pulse"
        : "flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs";
    marker.textContent = completed ? "✓" : String(index + 1);
    const text = document.createElement("span");
    text.textContent = label;
    item.append(marker, text);
    stages.append(item);
  }

  const timing = document.createElement("p");
  timing.className = "mt-8 text-sm font-medium text-muted-foreground";
  timing.textContent = presentation.timing;
  const liveDetail = document.createElement("span");
  liveDetail.className = "sr-only";
  liveDetail.textContent = message;
  timing.append(liveDetail);

  content.append(logo, eyebrow, title, detail, progressTrack, stages, timing);
  if (presentation.delayed) {
    const delayed = document.createElement("p");
    delayed.className = "mt-2 text-sm leading-6 text-muted-foreground";
    delayed.textContent = "Aldo is still retrying automatically. Keep this screen open.";
    content.append(delayed);
  }
  surface.append(content);
  root.append(surface);
}

type ResumeRequestOutcome = "accepted" | "rejected" | "superseded" | "uncertain";

export async function requestManagedResume(
  resumeRequestKey: string,
): Promise<ResumeRequestOutcome> {
  const existing = readStoredManagedWorkspaceAction();
  if (existing && !ownsPersistedManagedResume(resumeRequestKey)) return "superseded";
  bootstrapResumeRequestKey = resumeRequestKey;
  const progressObserved =
    existing?.action === "resume" &&
    existing.idempotencyKey === resumeRequestKey &&
    existing.progressObserved === true;
  bootstrapResumeUsesSharedStorage = writeStoredManagedWorkspaceAction({
    action: "resume",
    phase: "pending",
    idempotencyKey: resumeRequestKey,
    progressObserved,
    restartConfirmations: 0,
  });
  try {
    const response = await fetch(START_PATH, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "idempotency-key": resumeRequestKey,
      },
      body: "{}",
      signal: AbortSignal.timeout(30_000),
    });
    if (!ownsPersistedManagedResume(resumeRequestKey)) return "superseded";
    if (response.ok) {
      writeStoredManagedWorkspaceAction({
        action: "resume",
        phase: "pending",
        idempotencyKey: resumeRequestKey,
        progressObserved: true,
        restartConfirmations: 0,
      });
      return "accepted";
    }
    if (isAmbiguousLifecycleResponse(response.status)) {
      writeStoredManagedWorkspaceAction({
        action: "resume",
        phase: "uncertain",
        idempotencyKey: resumeRequestKey,
        progressObserved,
        restartConfirmations: 0,
      });
      return "uncertain";
    }
    clearStoredManagedWorkspaceAction("resume", resumeRequestKey);
    return "rejected";
  } catch {
    if (!ownsPersistedManagedResume(resumeRequestKey)) return "superseded";
    writeStoredManagedWorkspaceAction({
      action: "resume",
      phase: "uncertain",
      idempotencyKey: resumeRequestKey,
      progressObserved,
      restartConfirmations: 0,
    });
    return "uncertain";
  }
}

function waitForManagedResume(
  resumeRequestKey = `resume-${randomUUID()}`,
): Promise<{ requestKey: string; uncertain: boolean } | null> {
  return new Promise((resolve) => {
    const root = document.getElementById("root");
    if (!root) {
      resolve({ requestKey: resumeRequestKey, uncertain: true });
      return;
    }
    root.replaceChildren();
    lastAnnouncedWakeState = undefined;
    const surface = document.createElement("main");
    surface.className =
      "flex h-dvh min-h-0 items-center justify-center bg-background px-6 text-foreground";
    const card = document.createElement("section");
    card.className =
      "w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-sm";
    const title = document.createElement("h1");
    title.className = "text-base font-semibold";
    title.textContent = "Workspace paused";
    const detail = document.createElement("p");
    detail.className = "mt-2 text-sm text-muted-foreground";
    detail.textContent = "Your files are safe. Resume when you want to continue.";
    const error = document.createElement("p");
    error.className = "mt-3 hidden text-sm text-destructive";
    const resume = document.createElement("button");
    resume.type = "button";
    resume.className =
      "mt-4 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60";
    resume.textContent = "Resume workspace";
    let submitted = false;
    const schedulePolling = () => {
      queueMicrotask(() => {
        window.setTimeout(() => {
          if (!submitted) resolve(null);
        }, 1_500);
      });
    };
    resume.addEventListener("click", () => {
      submitted = true;
      resume.disabled = true;
      resume.textContent = "Resuming…";
      error.classList.add("hidden");
      void requestManagedResume(resumeRequestKey).then((outcome) => {
        if (outcome === "rejected") {
          submitted = false;
          resume.disabled = false;
          resume.textContent = "Resume workspace";
          error.textContent = "The workspace could not be resumed. Try again.";
          error.classList.remove("hidden");
          schedulePolling();
          return;
        }
        if (outcome === "accepted") {
          updateBootstrapMessage("Resuming your workspace…");
          resolve({ requestKey: resumeRequestKey, uncertain: false });
        } else if (outcome === "superseded") {
          const supersedingResume = readPersistedManagedResume();
          if (!supersedingResume) {
            resolve(null);
            return;
          }
          updateBootstrapMessage("Resuming your workspace…");
          resolve({
            requestKey: supersedingResume.requestKey,
            uncertain: supersedingResume.uncertain,
          });
        } else {
          // The gateway may have accepted the idempotent request before the response
          // was interrupted. Resume bootstrap polling and safely retry the same key
          // if the workspace still reports that it needs a resume.
          updateBootstrapMessage("Checking whether your workspace resumed…");
          resolve({ requestKey: resumeRequestKey, uncertain: true });
        }
      });
    });
    card.append(title, detail, error, resume);
    surface.append(card);
    root.append(surface);
    resume.focus();
    schedulePolling();
  });
}

function pairingHash(token: string): string {
  return new URLSearchParams([["token", token]]).toString();
}

function clearManagedSessionRecovery(): void {
  try {
    window.sessionStorage.removeItem(SESSION_RECOVERY_KEY);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

function scheduleManagedSessionRecovery(): boolean {
  if (sessionRecoveryReloadScheduled) return false;
  const now = Date.now();
  try {
    const previous = Number(window.sessionStorage.getItem(SESSION_RECOVERY_KEY) ?? 0);
    if (Number.isFinite(previous) && now - previous < SESSION_RECOVERY_COOLDOWN_MS) {
      return false;
    }
    window.sessionStorage.setItem(SESSION_RECOVERY_KEY, String(now));
  } catch {
    // The in-memory guard still prevents a reload loop within this document.
  }
  sessionRecoveryReloadScheduled = true;
  window.location.reload();
  return true;
}

export async function prepareManagedDevPc(): Promise<void> {
  if (!isManagedDevPc) return;

  let wakeStartedAt = Date.now();
  const showWakeProgress = (message: string, phase: ManagedWakePhase = "machine") => {
    updateBootstrapMessage(message, false, phase, Date.now() - wakeStartedAt);
  };
  showWakeProgress("Checking your workspace status…");
  const persistedResume = readPersistedManagedResume();
  let failures = 0;
  let resumeAccepted = persistedResume?.accepted ?? false;
  let resumeRequestKey = persistedResume?.requestKey;
  let resumeUncertain = persistedResume?.uncertain ?? false;
  let resumeWaitPolls = 0;
  while (true) {
    try {
      const response = await fetch(BOOTSTRAP_PATH, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Workspace bootstrap returned ${response.status}.`);
      }
      const bootstrap = (await response.json()) as ManagedDevPcBootstrap;
      window.__DEVPC_MANAGED_BOOTSTRAP__ = bootstrap;
      const lifecycleReconciliation = reconcileBootstrapLifecycleAction(bootstrap);
      if (isManagedBootstrapRunning(bootstrap)) {
        if (lifecycleReconciliation === "pending-restart-confirmation") {
          failures = 0;
          showWakeProgress("Confirming that your workspace restarted…", "connection");
          await new Promise((resolve) => window.setTimeout(resolve, 1_500));
          continue;
        }
        if (bootstrap.pairingToken) {
          window.location.hash = pairingHash(bootstrap.pairingToken);
        }
        showWakeProgress("Opening your workspace…", "workspace");
        return;
      }
      if (requiresManagedResume(bootstrap)) {
        failures = 0;
        if (shouldRepromptManagedResume(resumeAccepted, resumeWaitPolls)) {
          if (resumeRequestKey) clearStoredManagedWorkspaceAction("resume", resumeRequestKey);
          resumeAccepted = false;
          resumeRequestKey = undefined;
          resumeUncertain = false;
          resumeWaitPolls = 0;
        }
        if (shouldPromptManagedResume(bootstrap, resumeAccepted)) {
          const result = await waitForManagedResume(resumeRequestKey);
          if (!result) continue;
          resumeRequestKey = result.requestKey;
          resumeUncertain = result.uncertain;
          resumeAccepted = true;
          resumeWaitPolls = 0;
          wakeStartedAt = Date.now();
        } else {
          resumeWaitPolls += 1;
          showWakeProgress("Resuming your workspace…", managedWakePhase(bootstrap));
          if (resumeUncertain && resumeRequestKey) {
            const outcome = await requestManagedResume(resumeRequestKey);
            if (outcome === "accepted") {
              resumeUncertain = false;
            } else if (outcome === "superseded") {
              const supersedingResume = readPersistedManagedResume();
              resumeAccepted = supersedingResume !== null;
              resumeRequestKey = supersedingResume?.requestKey;
              resumeUncertain = supersedingResume?.uncertain ?? false;
            } else if (outcome === "rejected") {
              resumeAccepted = false;
              resumeUncertain = false;
            }
          }
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
        continue;
      }
      if (resumeRequestKey && isManagedResumeTransition(bootstrap)) {
        resumeAccepted = true;
        resumeUncertain = false;
        resumeWaitPolls = 0;
        failures = 0;
        showWakeProgress("Resuming your workspace…", managedWakePhase(bootstrap));
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
        continue;
      }
      if (resumeRequestKey) clearStoredManagedWorkspaceAction("resume", resumeRequestKey);
      resumeAccepted = false;
      resumeRequestKey = undefined;
      resumeUncertain = false;
      resumeWaitPolls = 0;
      failures = 0;
      showWakeProgress(
        bootstrap.detail ?? "The workspace is still starting…",
        managedWakePhase(bootstrap),
      );
      await new Promise((resolve) => window.setTimeout(resolve, 1_500));
    } catch (error) {
      failures += 1;
      if (failures >= 4) {
        updateBootstrapMessage(
          error instanceof Error ? error.message : "The workspace could not be reached.",
          true,
        );
        throw error;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1_500));
    }
  }
}

export async function prepareManagedWebSocketUrl(socketUrl: string): Promise<string> {
  if (!isManagedDevPc) return socketUrl;

  const response = await fetch(WEBSOCKET_TICKET_PATH, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: "{}",
  });
  if (!response.ok) {
    if ([401, 403].includes(response.status) && scheduleManagedSessionRecovery()) {
      throw new Error("Refreshing the managed workspace connection.");
    }
    throw new Error("The managed workspace connection could not be authorized.");
  }
  const payload = (await response.json()) as {
    ticket?: unknown;
    websocketUrl?: unknown;
  };
  if (typeof payload.ticket !== "string" || payload.ticket.length < 20) {
    throw new Error("The managed workspace returned an invalid connection credential.");
  }

  const managedSocketUrl =
    typeof payload.websocketUrl === "string" ? payload.websocketUrl : undefined;
  const resolved = new URL(managedSocketUrl ?? socketUrl, window.location.origin);
  if (!["ws:", "wss:"].includes(resolved.protocol)) {
    throw new Error("The managed workspace returned an invalid WebSocket URL.");
  }
  resolved.searchParams.delete("wsTicket");
  resolved.searchParams.delete("gatewayTicket");
  resolved.searchParams.set(managedSocketUrl ? "wsTicket" : "gatewayTicket", payload.ticket);
  clearManagedSessionRecovery();
  return resolved.toString();
}

/**
 * Loopback port serving the managed workspace's shared browser.
 *
 * The host exposes one headed Chrome that the user watches over noVNC and agents
 * drive over the DevTools protocol, so a site signed into by hand stays signed in
 * for the agent. It arrives as an ordinary preview grant on this port.
 */
export const MANAGED_WORKSPACE_BROWSER_PORT = 6080;

/**
 * URL of the shared workspace browser, when this deployment has one.
 *
 * Returns the granted URL untouched: the host builds it pointing at the noVNC
 * client with the viewer options already set, because the port's own root serves
 * a directory listing rather than a screen.
 */
export function managedWorkspaceBrowserUrl(): string | null {
  if (!isManagedDevPc) return null;
  const granted =
    window.__DEVPC_MANAGED_BOOTSTRAP__?.previewUrls?.[String(MANAGED_WORKSPACE_BROWSER_PORT)];
  return granted ?? null;
}

export function resolveManagedPreviewUrl(port: number, path: string): string | null {
  if (!isManagedDevPc) return null;
  const template = window.__DEVPC_MANAGED_BOOTSTRAP__?.previewUrlTemplate;
  const granted = window.__DEVPC_MANAGED_BOOTSTRAP__?.previewUrls?.[String(port)];
  if (granted) {
    const base = new URL(granted, window.location.origin);
    const resolved = new URL(path.startsWith("/") ? path.slice(1) : path, base);
    if (base.searchParams.has("grant")) {
      resolved.searchParams.set("grant", base.searchParams.get("grant")!);
    }
    return resolved.toString();
  }
  if (!template) return null;
  const base = new URL(template.replace("{port}", String(port)), window.location.origin);
  return new URL(path.startsWith("/") ? path.slice(1) : path, base).toString();
}
