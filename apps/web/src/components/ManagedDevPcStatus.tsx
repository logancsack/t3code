import { useCallback, useEffect, useState } from "react";

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
    if (!window.confirm("Restart this Dev PC? Active terminals and agent runs will disconnect.")) {
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
    <div className="fixed right-3 top-2 z-[100] flex h-8 items-center gap-2 rounded-lg border border-border/80 bg-background/95 px-2.5 text-xs shadow-sm backdrop-blur">
      <span
        className={`size-2 rounded-full ${ready ? "bg-emerald-500" : state === "error" ? "bg-destructive" : "bg-amber-500"}`}
        aria-hidden
      />
      <span className="font-medium">{statusLabel[state]}</span>
      <button
        type="button"
        className="rounded px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        disabled={!ready}
        onClick={() => void restart()}
      >
        Restart
      </button>
    </div>
  );
}
