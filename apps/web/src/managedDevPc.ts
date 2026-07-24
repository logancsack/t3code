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
