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
const SESSION_RECOVERY_KEY = "devpc-managed-session-recovery-at";
const SESSION_RECOVERY_COOLDOWN_MS = 30_000;
const MAX_RESUME_WAIT_POLLS = 40;
let sessionRecoveryReloadScheduled = false;

export function requiresManagedResume(bootstrap: ManagedDevPcBootstrap): boolean {
  const resumable = new Set(["paused", "stopped"]);
  return Boolean(
    bootstrap.requiresResume ||
    (bootstrap.status && resumable.has(bootstrap.status)) ||
    resumable.has(bootstrap.state),
  );
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

function updateBootstrapMessage(message: string, failed = false): void {
  const root = document.getElementById("root");
  if (!root) return;
  root.replaceChildren();
  const surface = document.createElement("main");
  surface.className =
    "flex h-dvh min-h-0 items-center justify-center bg-background px-6 text-foreground";
  const card = document.createElement("section");
  card.className =
    "w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-sm";
  const title = document.createElement("h1");
  title.className = "text-base font-semibold";
  title.textContent = failed ? "Workspace unavailable" : "Starting your workspace";
  const detail = document.createElement("p");
  detail.className = "mt-2 text-sm text-muted-foreground";
  detail.textContent = message;
  card.append(title, detail);
  if (failed) {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className =
      "mt-4 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => window.location.reload());
    card.append(retry);
  }
  surface.append(card);
  root.append(surface);
}

type ResumeRequestOutcome = "accepted" | "rejected" | "uncertain";

async function requestManagedResume(resumeRequestKey: string): Promise<ResumeRequestOutcome> {
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
    return response.ok ? "accepted" : "rejected";
  } catch {
    return "uncertain";
  }
}

function waitForManagedResume(
  resumeRequestKey = `resume-${randomUUID()}`,
): Promise<{ requestKey: string; uncertain: boolean }> {
  return new Promise((resolve) => {
    const root = document.getElementById("root");
    if (!root) {
      resolve({ requestKey: resumeRequestKey, uncertain: true });
      return;
    }
    root.replaceChildren();
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
    resume.addEventListener("click", () => {
      resume.disabled = true;
      resume.textContent = "Resuming…";
      error.classList.add("hidden");
      void requestManagedResume(resumeRequestKey).then((outcome) => {
        if (outcome === "rejected") {
          resume.disabled = false;
          resume.textContent = "Resume workspace";
          error.textContent = "The workspace could not be resumed. Try again.";
          error.classList.remove("hidden");
          return;
        }
        if (outcome === "accepted") {
          updateBootstrapMessage("Resuming your workspace…");
          resolve({ requestKey: resumeRequestKey, uncertain: false });
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

  updateBootstrapMessage("Connecting to the managed workspace…");
  let failures = 0;
  let resumeAccepted = false;
  let resumeRequestKey: string | undefined;
  let resumeUncertain = false;
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
      if (bootstrap.ready) {
        if (bootstrap.pairingToken) {
          window.location.hash = pairingHash(bootstrap.pairingToken);
        }
        return;
      }
      if (requiresManagedResume(bootstrap)) {
        failures = 0;
        if (shouldRepromptManagedResume(resumeAccepted, resumeWaitPolls)) {
          resumeAccepted = false;
          resumeRequestKey = undefined;
          resumeUncertain = false;
          resumeWaitPolls = 0;
        }
        if (shouldPromptManagedResume(bootstrap, resumeAccepted)) {
          const result = await waitForManagedResume(resumeRequestKey);
          resumeRequestKey = result.requestKey;
          resumeUncertain = result.uncertain;
          resumeAccepted = true;
          resumeWaitPolls = 0;
        } else {
          resumeWaitPolls += 1;
          updateBootstrapMessage("Resuming your workspace…");
          if (resumeUncertain && resumeRequestKey) {
            const outcome = await requestManagedResume(resumeRequestKey);
            if (outcome === "accepted") {
              resumeUncertain = false;
            } else if (outcome === "rejected") {
              resumeAccepted = false;
              resumeUncertain = false;
            }
          }
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
        continue;
      }
      resumeAccepted = false;
      resumeRequestKey = undefined;
      resumeUncertain = false;
      resumeWaitPolls = 0;
      failures = 0;
      updateBootstrapMessage(bootstrap.detail ?? "The workspace is still starting…");
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
