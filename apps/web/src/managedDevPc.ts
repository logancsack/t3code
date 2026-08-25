import type {
  ClientOrchestrationCommand,
  ExecutionEnvironmentDescriptor,
} from "@t3tools/contracts";
import { setOrchestrationCommandDispatchOverride } from "@t3tools/client-runtime/operations";

import { randomUUID } from "./lib/utils";
import {
  readManagedPrimaryEnvironmentDescriptor,
  writeManagedPrimaryEnvironmentDescriptor,
} from "./managedPrimaryEnvironment";

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
  /** RSA-OAEP SPKI public key used to seal commands while the workspace is asleep. */
  readonly dispatchPublicKey?: string;
  /** Public metadata needed to render the cached T3 shell while the VM is asleep. */
  readonly environmentDescriptor?: ExecutionEnvironmentDescriptor;
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
  /** The in-flight wake is installing a newer workspace runtime first. */
  readonly runtimeUpdating?: boolean;
}

export const isManagedDevPc = import.meta.env.VITE_DEVPC_MANAGED === "1";

const BOOTSTRAP_PATH = "/_devpc/bootstrap";
const START_PATH = "/_devpc/workspace/start";
const WEBSOCKET_TICKET_PATH = "/_devpc/ws-ticket";
const DISPATCH_PATH = "/_devpc/dispatches";
export const MANAGED_WORKSPACE_ACTION_STORAGE_KEY = "devpc-managed-workspace-action";
export const MANAGED_WORKSPACE_ACTION_CLEARED_EVENT = "devpc-managed-workspace-action-cleared";
const SESSION_RECOVERY_KEY = "devpc-managed-session-recovery-at";
const SESSION_RECOVERY_COOLDOWN_MS = 30_000;
const MAX_RESUME_WAIT_POLLS = 40;
const MANAGED_WAKE_SLOW_THRESHOLD_MS = 75_000;
const MANAGED_COMMAND_READY_POLL_MS = 1_500;
let sessionRecoveryReloadScheduled = false;
let bootstrapResumeRequestKey: string | undefined;
let bootstrapResumeUsesSharedStorage = false;
let lastAnnouncedWakeState: string | undefined;
let managedCommandTransportReadyPromise: Promise<void> | undefined;

interface ManagedSealedDispatch {
  readonly version: 1;
  readonly encryptedKey: string;
  readonly iv: string;
  readonly ciphertext: string;
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const decoded = window.atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sealManagedCommand(
  publicKey: string,
  command: ClientOrchestrationCommand,
): Promise<ManagedSealedDispatch> {
  const rsaKey = await window.crypto.subtle.importKey(
    "spki",
    decodeBase64(publicKey),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  const contentKey = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"],
  );
  const rawContentKey = await window.crypto.subtle.exportKey("raw", contentKey);
  const encryptedKey = await window.crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    rsaKey,
    rawContentKey,
  );
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    contentKey,
    new TextEncoder().encode(JSON.stringify(command)),
  );
  return {
    version: 1,
    encryptedKey: encodeBase64Url(encryptedKey),
    iv: encodeBase64Url(iv.buffer),
    ciphertext: encodeBase64Url(ciphertext),
  };
}

/** Route primary managed commands through Aldo's durable wake queue. */
export function installManagedCommandDispatch(): void {
  if (!isManagedDevPc) return;
  setOrchestrationCommandDispatchOverride(prepareManagedCommandDispatch);
}

/**
 * Persist a managed command before the ordinary RPC waits for the workspace.
 *
 * The queue's 202 only proves that Aldo stored the encrypted command; it is not
 * T3's orchestration receipt. Returning a synthetic receipt here made drafts
 * look active forever when relay delivery was delayed or rejected. Always let
 * requestWhenConnected send the same idempotent command after the VM wakes so
 * the composer settles only after T3 actually accepts it. The durable copy is
 * still the tab-close fallback and a later duplicate is harmless because the
 * command id is stable.
 */
export async function prepareManagedCommandDispatch(input: {
  readonly command: ClientOrchestrationCommand;
  readonly primary: boolean;
}): Promise<null> {
  if (!input.primary) return null;
  if (managedCommandRequiresLiveTransport(input.command)) {
    await requestManagedResume(`dispatch-${input.command.commandId}`);
    await waitForManagedCommandTransportReady();
    return null;
  }
  const queued = await queueManagedCommand(input.command);
  if (!queued) {
    // One-time compatibility for a workspace paused before its guest runtime
    // published a sealing key. Wake it explicitly, then let the normal RPC
    // request wait for the relay; future commands use the durable queue.
    await requestManagedResume(`dispatch-${input.command.commandId}`);
  }
  await waitForManagedCommandTransportReady();
  return null;
}

/**
 * Wait for Aldo's durable lifecycle boundary, not merely a reachable socket.
 *
 * A resumed VM can briefly expose its previous T3 process while Aldo installs
 * a newer runtime. Sending through that maintenance relay lets the old process
 * accept a turn that the same start operation subsequently restarts. The
 * bootstrap endpoint reports `running` only after runtime configuration,
 * version reconciliation, relay replacement, and lifecycle completion.
 */
export async function waitForManagedCommandTransportReady(): Promise<void> {
  if (managedCommandTransportReadyPromise) return managedCommandTransportReadyPromise;
  const pending = pollForManagedCommandTransportReady();
  managedCommandTransportReadyPromise = pending;
  return pending.finally(() => {
    if (managedCommandTransportReadyPromise === pending) {
      managedCommandTransportReadyPromise = undefined;
    }
  });
}

async function pollForManagedCommandTransportReady(): Promise<void> {
  while (true) {
    try {
      const response = await fetch(BOOTSTRAP_PATH, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        if ([401, 403].includes(response.status)) {
          if (scheduleManagedSessionRecovery()) {
            throw new ManagedBootstrapTerminalError("Refreshing the managed workspace connection.");
          }
          throw new ManagedBootstrapHttpError(response.status);
        }
        if (!isAmbiguousLifecycleResponse(response.status) && response.status !== 429) {
          throw new ManagedBootstrapHttpError(response.status);
        }
      } else {
        const bootstrap = (await response.json()) as ManagedDevPcBootstrap;
        window.__DEVPC_MANAGED_BOOTSTRAP__ = bootstrap;
        if (bootstrap.environmentDescriptor) {
          writeManagedPrimaryEnvironmentDescriptor(bootstrap.environmentDescriptor);
        }
        reconcileBootstrapLifecycleAction(bootstrap);
        if (isManagedBootstrapRunning(bootstrap)) return;
        const status = bootstrap.status ?? bootstrap.state;
        if (bootstrap.state === "error" || ["attention", "unreachable"].includes(status)) {
          throw new ManagedBootstrapTerminalError(
            bootstrap.detail ?? "The managed workspace could not start.",
          );
        }
      }
    } catch (error) {
      if (!isTransientBootstrapFailure(error)) throw error;
    }
    await new Promise((resolve) => window.setTimeout(resolve, MANAGED_COMMAND_READY_POLL_MS));
  }
}

export function managedCommandRequiresLiveTransport(command: ClientOrchestrationCommand): boolean {
  // Attachment data URLs can reach tens of megabytes. Keep those in T3's
  // existing streamed/live path instead of copying them through PostgreSQL;
  // requestWhenConnected retains the command while Morph wakes.
  // Bootstrap turns are safe to queue: the managed T3 endpoint now executes
  // the same create-thread/worktree/setup transaction as live WebSocket
  // dispatch. Persisting them before wake makes a hard refresh non-destructive.
  return command.type === "thread.turn.start" && command.message.attachments.length > 0;
}

export async function queueManagedCommand(
  command: ClientOrchestrationCommand,
): Promise<{ readonly sequence: number } | null> {
  const publicKey = window.__DEVPC_MANAGED_BOOTSTRAP__?.dispatchPublicKey;
  if (!publicKey) return null;
  const response = await fetch(DISPATCH_PATH, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "idempotency-key": command.commandId,
    },
    body: JSON.stringify({
      commandId: command.commandId,
      sealed: await sealManagedCommand(publicKey, command),
    }),
  });
  if (!response.ok) {
    throw new Error(`Aldo could not queue the command (${response.status}).`);
  }
  return { sequence: 0 };
}

export function isAmbiguousLifecycleResponse(status: number): boolean {
  return status === 408 || status >= 500;
}

/** A non-ok bootstrap response, carrying its status for retryability triage. */
class ManagedBootstrapHttpError extends Error {
  constructor(readonly status: number) {
    super(`Workspace bootstrap returned ${status}.`);
  }
}

class ManagedBootstrapTerminalError extends Error {}

/**
 * Only failures the gateway may heal on its own deserve the extended retry
 * budget: network errors, timeouts, rate limiting, and 5xx. A definitive 4xx
 * (an expired session, a missing workspace) will not change in eighteen
 * seconds of polling.
 */
function isTransientBootstrapFailure(error: unknown): boolean {
  if (error instanceof ManagedBootstrapTerminalError) return false;
  if (error instanceof ManagedBootstrapHttpError) {
    return isAmbiguousLifecycleResponse(error.status) || error.status === 429;
  }
  return true;
}

export function requiresManagedResume(bootstrap: ManagedDevPcBootstrap): boolean {
  const resumable = new Set(["paused", "stopped"]);
  if (bootstrap.status) return resumable.has(bootstrap.status);
  return Boolean(bootstrap.requiresResume || resumable.has(bootstrap.state));
}

export function isManagedWorkspaceSleeping(): boolean {
  return (
    isManagedDevPc &&
    window.__DEVPC_MANAGED_BOOTSTRAP__ !== undefined &&
    requiresManagedResume(window.__DEVPC_MANAGED_BOOTSTRAP__)
  );
}

/**
 * The managed workspace cannot serve its primary environment right now:
 * asleep, or a wake, restart, or runtime update is still in flight. The Aldo
 * gateway has already authenticated this browser either way, and the cached
 * shell is expected to render, fall back to cached environment metadata, and
 * queue work until the lifecycle completes — a not-yet-running guest must
 * never surface as a fatal error to a page the gateway happily served.
 */
export function isManagedWorkspaceUnavailable(): boolean {
  if (!isManagedDevPc) return false;
  const bootstrap = window.__DEVPC_MANAGED_BOOTSTRAP__;
  if (bootstrap === undefined) return false;
  return !isManagedBootstrapRunning(bootstrap);
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
  if (existing && !ownsPersistedManagedResume(resumeRequestKey)) {
    // This call is made only for fresh, trusted user intent: a resume click or
    // a command the user just submitted. A prior lifecycle action may survive
    // in localStorage after the workspace later pauses again (notably when an
    // earlier resume completed between status polls). Treating that older
    // record as authoritative skips the start request entirely and strands the
    // new command in requestWhenConnected forever. Latest explicit intent wins;
    // the control plane serializes a concurrent pause/restart safely, while the
    // stable new key keeps retries idempotent.
    clearStoredManagedWorkspaceAction(existing.action, existing.idempotencyKey);
    if (typeof window.dispatchEvent === "function") {
      window.dispatchEvent(
        new CustomEvent(MANAGED_WORKSPACE_ACTION_CLEARED_EVENT, {
          detail: { action: existing.action },
        }),
      );
    }
  }
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

export function waitForManagedResume(
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

  const wakeStartedAt = Date.now();
  let bootstrapProgressVisible = false;
  const showWakeProgress = (message: string, phase: ManagedWakePhase = "machine") => {
    bootstrapProgressVisible = true;
    updateBootstrapMessage(message, false, phase, Date.now() - wakeStartedAt);
  };
  // Keep the persisted shell in the DOM while the lightweight bootstrap checks
  // lifecycle state. Opening a page must never look like a wake unless a wake
  // was actually requested.
  let failures = 0;
  let coldBootstrapResumeKey: string | undefined;
  let coldBootstrapResumeSubmitted = false;
  while (true) {
    try {
      const response = await fetch(BOOTSTRAP_PATH, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new ManagedBootstrapHttpError(response.status);
      }
      const bootstrap = (await response.json()) as ManagedDevPcBootstrap;
      window.__DEVPC_MANAGED_BOOTSTRAP__ = bootstrap;
      if (bootstrap.environmentDescriptor) {
        writeManagedPrimaryEnvironmentDescriptor(bootstrap.environmentDescriptor);
      }
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
        if (bootstrapProgressVisible) {
          showWakeProgress("Opening your workspace…", "workspace");
        }
        return;
      }
      if (requiresManagedResume(bootstrap)) {
        // The gateway retains the public descriptor reported by the guest, so
        // even a new browser can render while Morph stays paused.
        if (readManagedPrimaryEnvironmentDescriptor()) return;
        coldBootstrapResumeKey ??=
          readPersistedManagedResume()?.requestKey ?? `bootstrap-${randomUUID()}`;
        if (!coldBootstrapResumeSubmitted) {
          // Compatibility for a control plane that has not observed the new
          // guest metadata yet: ask before waking instead of doing it on load.
          await waitForManagedResume(coldBootstrapResumeKey);
          coldBootstrapResumeSubmitted = true;
        }
        failures = 0;
        showWakeProgress("Your machine is waking up…", "machine");
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
        continue;
      }
      // A wake, restart, or runtime update is already in flight. The cached
      // shell opens now, exactly like the sleeping-workspace path above: the
      // workspace status surface reports live progress, reads come from the
      // cached environment, and anything the user sends waits in the durable
      // dispatch queue or the connected-transport retry loop until the
      // lifecycle completes. The blocking status page is reserved for a first
      // boot with nothing cached to show — never for an arrival that happens
      // to land mid-wake (autonomous runtime convergence made that common).
      // Except: keep the gate when this page itself asked for the wake from
      // its pre-shell resume card, so that flow keeps its progress screen.
      if (!coldBootstrapResumeSubmitted && readManagedPrimaryEnvironmentDescriptor()) return;
      failures = 0;
      showWakeProgress(
        bootstrap.detail ?? "The workspace is still starting…",
        managedWakePhase(bootstrap),
      );
      await new Promise((resolve) => window.setTimeout(resolve, 1_500));
    } catch (error) {
      failures += 1;
      // The gateway answers transient control-plane trouble with 503 +
      // retry-after while it recovers, which can span a relay handoff or a
      // control-plane deploy (~15–20 s). Twelve polls at 1.5 s gives ~18 s
      // of tolerance before the fatal card, instead of giving up during a
      // blip the platform is already healing. Definitive failures skip the
      // budget entirely.
      if (!isTransientBootstrapFailure(error) || failures >= 12) {
        updateBootstrapMessage(
          error instanceof Error ? error.message : "The workspace could not be reached.",
          true,
        );
        throw error;
      }
      if (failures >= 2) {
        showWakeProgress("Reconnecting to your workspace…", "connection");
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
    // Without a bound, a hung gateway pins the connection attempt until the
    // supervisor's establishment timeout; failing fast keeps the retry loop
    // (which mints a fresh ticket per attempt) moving.
    signal: AbortSignal.timeout(10_000),
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
