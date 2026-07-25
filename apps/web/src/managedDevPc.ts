export type ManagedDevPcWorkspaceState = "starting" | "ready" | "restarting" | "stopped" | "error";

export interface ManagedDevPcBootstrap {
  readonly managed: true;
  readonly state: ManagedDevPcWorkspaceState;
  readonly ready: boolean;
  readonly pairingToken?: string;
  readonly previewUrlTemplate: string;
  readonly previewUrls?: Readonly<Record<string, string>>;
  readonly t3Version?: string;
  readonly detail?: string;
}

export const isManagedDevPc = import.meta.env.VITE_DEVPC_MANAGED === "1";

const BOOTSTRAP_PATH = "/_devpc/bootstrap";
const WEBSOCKET_TICKET_PATH = "/_devpc/ws-ticket";
const SESSION_RECOVERY_KEY = "devpc-managed-session-recovery-at";
const SESSION_RECOVERY_COOLDOWN_MS = 30_000;
let sessionRecoveryReloadScheduled = false;

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
  title.textContent = failed ? "Workspace unavailable" : "Starting your Dev PC";
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
