import { useCallback, useEffect, useState } from "react";
import { RotateCwIcon } from "lucide-react";

import {
  isManagedDevPc,
  type ManagedDevPcBootstrap,
  type ManagedDevPcWorkspaceState,
} from "../managedDevPc";

const STATUS_PATH = "/_devpc/workspace";

const statusLabel: Record<ManagedDevPcWorkspaceState, string> = {
  starting: "Starting",
  ready: "Online",
  restarting: "Restarting",
  stopped: "Stopped",
  error: "Needs attention",
};

export function ManagedDevPcStatus() {
  const [workspace, setWorkspace] = useState<ManagedDevPcBootstrap | null>(
    window.__DEVPC_MANAGED_BOOTSTRAP__ ?? null,
  );
  const [restarting, setRestarting] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch(STATUS_PATH, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (response.ok) setWorkspace((await response.json()) as ManagedDevPcBootstrap);
  }, []);

  useEffect(() => {
    if (!isManagedDevPc) return;
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (!isManagedDevPc || !workspace) return null;
  const state = restarting ? "restarting" : workspace.state;
  const ready = state === "ready";

  const restart = async () => {
    if (
      !window.confirm("Restart this workspace? Active terminals and agent runs will disconnect.")
    ) {
      return;
    }
    setRestarting(true);
    const response = await fetch("/_devpc/workspace/restart", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `restart-${Date.now()}`,
      },
      body: "{}",
    });
    if (!response.ok) {
      setRestarting(false);
      window.alert("The workspace restart could not be started.");
      return;
    }
    window.setTimeout(() => window.location.reload(), 1_500);
  };

  return (
    <div
      className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-sm text-sidebar-muted-foreground/80"
      aria-live="polite"
      data-devpc-workspace-status={state}
    >
      <span className="relative flex size-4 shrink-0 items-center justify-center" aria-hidden>
        <span
          className={`size-2 rounded-full ${
            ready ? "bg-emerald-500" : state === "error" ? "bg-destructive" : "bg-amber-500"
          }`}
        />
        {state === "starting" || state === "restarting" ? (
          <span className="absolute size-3.5 animate-ping rounded-full bg-amber-500/25" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">Workspace · {statusLabel[state]}</span>
      <button
        type="button"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-muted-foreground/70 outline-hidden hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:pointer-events-none disabled:opacity-40"
        disabled={!ready}
        onClick={() => void restart()}
        aria-label="Restart workspace"
        title="Restart workspace"
      >
        <RotateCwIcon className="size-3.5" />
      </button>
    </div>
  );
}
