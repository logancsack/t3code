import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronRightIcon, PauseIcon, PlayIcon, RotateCwIcon } from "lucide-react";

import {
  isAmbiguousLifecycleResponse,
  isManagedDevPc,
  type ManagedDevPcBootstrap,
  type ManagedDevPcDisplayStatus,
  type ManagedDevPcTelemetry,
} from "../managedDevPc";
import { randomUUID } from "../lib/utils";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";

const STATUS_PATH = "/_devpc/workspace";
const SETTINGS_PATH = "/_devpc/workspace/settings";
const TELEMETRY_FRESH_MS = 60_000;
const STATUS_REQUEST_TIMEOUT_MS = 10_000;
const ACTION_REQUEST_TIMEOUT_MS = 30_000;
const IDLE_TIMEOUTS = [15, 30, 60, 120, 240] as const;

const statusLabel: Record<ManagedDevPcDisplayStatus, string> = {
  running: "Running",
  starting: "Starting…",
  restarting: "Restarting…",
  pausing: "Pausing…",
  paused: "Paused",
  stopped: "Stopped",
  restoring: "Restoring…",
  reconnecting: "Reconnecting…",
  unreachable: "Unreachable",
  attention: "Needs attention",
};

const statusDescription: Record<ManagedDevPcDisplayStatus, string> = {
  running: "Connected and ready.",
  starting: "Starting your machine…",
  restarting: "Restarting your machine…",
  pausing: "Pausing your machine…",
  paused: "Paused. Resume when you want to continue.",
  stopped: "Stopped. Resume when you want to continue.",
  restoring: "Restoring your workspace disk…",
  reconnecting: "Connection interrupted. Aldo is reconnecting.",
  unreachable: "The workspace agent is not responding.",
  attention: "The workspace needs attention before it can be used.",
};
const KNOWN_STATUSES = new Set<string>(Object.keys(statusLabel));

type PendingAction = "restart" | "pause" | "resume";
type Confirmation = "restart" | "pause";
type ActionSnapshotResult = "pending" | "progressing" | "resolved" | "failed";
type ActionSessionSnapshot = {
  readonly pendingAction: PendingAction | null;
  readonly uncertainAction: PendingAction | null;
  readonly settingsPending: boolean;
};

const managedActionKeys = { current: {} as Partial<Record<PendingAction, string>> };
const managedPendingAction = { current: null as PendingAction | null };
const managedUncertainAction = { current: null as PendingAction | null };
const managedActionProgress = {
  current: {} as Partial<Record<PendingAction, boolean>>,
};
const managedRestartConfirmations = { current: 0 };
const managedPendingIdleTimeout = { current: null as number | null };
const managedIdleTimeout = { current: undefined as number | undefined };
const managedActionListeners = new Set<() => void>();
let managedActionSnapshot: ActionSessionSnapshot = {
  pendingAction: null,
  uncertainAction: null,
  settingsPending: false,
};

function subscribeManagedActionSession(listener: () => void): () => void {
  managedActionListeners.add(listener);
  return () => managedActionListeners.delete(listener);
}

function getManagedActionSnapshot(): ActionSessionSnapshot {
  return managedActionSnapshot;
}

function updateManagedActionSession(
  kind: "pendingAction" | "uncertainAction",
  action: PendingAction | null,
): void {
  const ref = kind === "pendingAction" ? managedPendingAction : managedUncertainAction;
  if (ref.current === action) return;
  ref.current = action;
  managedActionSnapshot = { ...managedActionSnapshot, [kind]: action };
  managedActionListeners.forEach((listener) => listener());
}

function updateManagedSettingsPending(settingsPending: boolean): void {
  if (managedActionSnapshot.settingsPending === settingsPending) return;
  managedActionSnapshot = { ...managedActionSnapshot, settingsPending };
  managedActionListeners.forEach((listener) => listener());
}

export function actionSnapshotResult(
  action: PendingAction,
  workspace: ManagedDevPcBootstrap,
  progressObserved = false,
  restartCompletionConfirmations = 0,
): ActionSnapshotResult {
  const status = workspace.status ?? workspace.state;
  if (workspace.state === "error" || status === "attention") return "failed";
  if (action === "pause") {
    if (["paused", "stopped"].includes(status)) return "resolved";
    if (["pausing", "stopping"].includes(status)) return "progressing";
    return "pending";
  }
  if (action === "resume") {
    if (status === "running" || (workspace.state === "ready" && workspace.ready)) {
      return "resolved";
    }
    if (["starting", "restoring", "reconnecting"].includes(status)) return "progressing";
    return "pending";
  }
  if (["restarting", "starting", "restoring"].includes(status)) return "progressing";
  if (
    progressObserved &&
    restartCompletionConfirmations > 0 &&
    (status === "running" || workspace.state === "ready")
  ) {
    return "resolved";
  }
  return "pending";
}

export function displayStatus(
  workspace: ManagedDevPcBootstrap,
  pendingAction: PendingAction | null = null,
  statusUnavailable = false,
): ManagedDevPcDisplayStatus {
  if (statusUnavailable) return "unreachable";
  if (pendingAction === "restart") return "restarting";
  if (pendingAction === "pause") return "pausing";
  if (pendingAction === "resume") return "starting";
  if (workspace.status) {
    return KNOWN_STATUSES.has(workspace.status) ? workspace.status : "attention";
  }
  if (workspace.state === "ready") return "running";
  if (workspace.state === "restarting") return "restarting";
  if (workspace.state === "starting") return "starting";
  if (workspace.state === "paused") return "paused";
  if (workspace.state === "stopped") return "stopped";
  return "attention";
}

export function formatRelativeTime(value: string | null | undefined, now = Date.now()): string {
  if (!value) return "unknown";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "unknown";
  const seconds = Math.max(0, Math.round((now - timestamp) / 1_000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(timestamp);
}

export function withIdleTimeout(
  workspace: ManagedDevPcBootstrap,
  idleTimeoutMinutes: number | undefined,
): ManagedDevPcBootstrap {
  if (idleTimeoutMinutes === undefined) {
    const { idleTimeoutMinutes: _previous, ...withoutIdleTimeout } = workspace;
    return withoutIdleTimeout;
  }
  return { ...workspace, idleTimeoutMinutes };
}

function formatClock(value: string | null | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  const gibibytes = value / 1024 ** 3;
  return `${gibibytes >= 10 ? Math.round(gibibytes) : gibibytes.toFixed(1)} GB`;
}

function formatUptime(seconds: number | undefined): string {
  if (!seconds || seconds < 60) return "< 1 minute";
  const hours = Math.floor(seconds / 3600);
  if (hours < 1) return `${Math.floor(seconds / 60)} minutes`;
  if (hours < 24) return `${hours} hours`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export function idleTimeoutLabel(minutes: number | undefined): string {
  if (minutes === undefined) return "Unavailable";
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

function StatusDot({ status }: { status: ManagedDevPcDisplayStatus }) {
  const transitional = ["starting", "restarting", "pausing", "restoring"].includes(status);
  const ring = ["paused", "stopped", "unreachable"].includes(status);
  const color =
    status === "running"
      ? "bg-emerald-500"
      : status === "attention"
        ? "bg-destructive"
        : ring
          ? "border border-current bg-transparent text-muted-foreground"
          : "bg-amber-500";
  return (
    <span className="relative flex size-4 shrink-0 items-center justify-center" aria-hidden>
      <span className={`size-2 rounded-full ${color}`} />
      {transitional ? (
        <span className="absolute size-3.5 rounded-full bg-amber-500/25 motion-safe:animate-ping" />
      ) : null}
    </span>
  );
}

function ResourceBar({
  label,
  value,
  percent,
  stale,
}: {
  label: string;
  value: string;
  percent: number;
  stale: boolean;
}) {
  const bounded = Math.min(100, Math.max(0, percent));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-4 text-xs">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">{value}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-border">
        <div
          className={`h-full rounded-full ${stale ? "bg-muted-foreground/45" : "bg-foreground/55"}`}
          style={{ width: `${bounded}%` }}
        />
      </div>
    </div>
  );
}

function Metrics({
  telemetry,
  status,
  onRetry,
}: {
  telemetry: ManagedDevPcTelemetry;
  status: ManagedDevPcDisplayStatus;
  onRetry: () => void;
}) {
  const stale = Date.now() - Date.parse(telemetry.receivedAt) > TELEMETRY_FRESH_MS;
  if (["unreachable", "attention", "paused", "stopped"].includes(status)) {
    return (
      <section className="space-y-2 border-t pt-5">
        <h3 className="text-sm font-semibold">Resources</h3>
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            Live metrics are unavailable while the workspace agent is not reporting.
          </p>
          <Button size="xs" variant="ghost" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </section>
    );
  }

  const memoryPercent = (telemetry.memory.usedBytes / telemetry.memory.totalBytes) * 100;
  const disk = telemetry.disks.workspace;
  const diskPercent = disk ? (disk.usedBytes / disk.totalBytes) * 100 : null;
  return (
    <section className="space-y-3 border-t pt-5">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-semibold">Resources</h3>
        <div
          className={`flex items-center gap-1 text-xs ${
            stale ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
          }`}
        >
          <span>Updated {formatRelativeTime(telemetry.receivedAt)}</span>
          {stale ? (
            <>
              <span aria-hidden>·</span>
              <button type="button" className="font-medium hover:underline" onClick={onRetry}>
                Retry
              </button>
            </>
          ) : null}
        </div>
      </div>
      {telemetry.cpuPercent === null ? null : (
        <ResourceBar
          label="CPU"
          value={`${Math.round(telemetry.cpuPercent)}%`}
          percent={telemetry.cpuPercent}
          stale={stale}
        />
      )}
      <ResourceBar
        label="Memory"
        value={`${formatBytes(telemetry.memory.usedBytes)} / ${formatBytes(
          telemetry.memory.totalBytes,
        )}`}
        percent={memoryPercent}
        stale={stale}
      />
      {disk && diskPercent !== null ? (
        <ResourceBar
          label="Workspace disk"
          value={`${formatBytes(disk.usedBytes)} / ${formatBytes(disk.totalBytes)}`}
          percent={diskPercent}
          stale={stale}
        />
      ) : null}
    </section>
  );
}

export function ManagedDevPcStatus() {
  const [workspace, setWorkspace] = useState<ManagedDevPcBootstrap | null>(
    window.__DEVPC_MANAGED_BOOTSTRAP__ ?? null,
  );
  const [open, setOpen] = useState(false);
  const { pendingAction, uncertainAction, settingsPending } = useSyncExternalStore(
    subscribeManagedActionSession,
    getManagedActionSnapshot,
    getManagedActionSnapshot,
  );
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actionKeys = managedActionKeys;
  const pendingActionRef = managedPendingAction;
  const uncertainActionRef = managedUncertainAction;
  const actionProgressObserved = managedActionProgress;
  const restartCompletionConfirmations = managedRestartConfirmations;
  const pendingIdleTimeout = managedPendingIdleTimeout;
  const refreshSequence = useRef(0);
  const latestAppliedRefresh = useRef(0);
  const componentMounted = useRef(false);

  const updatePendingAction = useCallback((action: PendingAction | null) => {
    updateManagedActionSession("pendingAction", action);
  }, []);

  const updateUncertainAction = useCallback((action: PendingAction | null) => {
    updateManagedActionSession("uncertainAction", action);
  }, []);

  const invalidateWorkspaceRefreshes = () => {
    latestAppliedRefresh.current = ++refreshSequence.current;
  };

  const refresh = useCallback(async () => {
    const generation = ++refreshSequence.current;
    const restartConfirmationsAtRequestStart = restartCompletionConfirmations.current;
    const idleTimeoutAtRequestStart = pendingIdleTimeout.current;
    try {
      const response = await fetch(STATUS_PATH, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(STATUS_REQUEST_TIMEOUT_MS),
      });
      if (!componentMounted.current) return null;
      if (!response.ok) {
        if (generation < latestAppliedRefresh.current) return null;
        latestAppliedRefresh.current = generation;
        setStatusUnavailable(true);
        return null;
      }
      const next = (await response.json()) as ManagedDevPcBootstrap;
      if (!componentMounted.current) return null;
      if (generation < latestAppliedRefresh.current) return null;
      latestAppliedRefresh.current = generation;
      window.__DEVPC_MANAGED_BOOTSTRAP__ = next;
      if (idleTimeoutAtRequestStart === null) {
        managedIdleTimeout.current = next.idleTimeoutMinutes;
      }
      const action = pendingActionRef.current ?? uncertainActionRef.current;
      if (action) {
        const result = actionSnapshotResult(
          action,
          next,
          actionProgressObserved.current[action] ?? false,
          restartConfirmationsAtRequestStart,
        );
        if (result === "failed") {
          delete actionKeys.current[action];
          delete actionProgressObserved.current[action];
          restartCompletionConfirmations.current = 0;
          updatePendingAction(null);
          updateUncertainAction(null);
          setError("The workspace reported a problem before the action completed.");
        } else if (result === "resolved") {
          delete actionKeys.current[action];
          delete actionProgressObserved.current[action];
          restartCompletionConfirmations.current = 0;
          updatePendingAction(null);
          updateUncertainAction(null);
          setError(null);
        } else if (result === "progressing") {
          actionProgressObserved.current[action] = true;
          restartCompletionConfirmations.current = 0;
          updatePendingAction(action);
          updateUncertainAction(null);
          setError(null);
        } else if (
          action === "restart" &&
          actionProgressObserved.current.restart &&
          (next.status === "running" || next.state === "ready")
        ) {
          // Require two status snapshots after accepted restart progress. The first
          // can still be the eventually-consistent pre-action projection.
          restartCompletionConfirmations.current = 1;
        }
      }
      setWorkspace(
        idleTimeoutAtRequestStart === null
          ? next
          : withIdleTimeout(next, idleTimeoutAtRequestStart),
      );
      setStatusUnavailable(false);
      return next;
    } catch {
      if (!componentMounted.current) return null;
      if (generation < latestAppliedRefresh.current) return null;
      latestAppliedRefresh.current = generation;
      setStatusUnavailable(true);
      return null;
    }
  }, [updatePendingAction, updateUncertainAction]);

  useEffect(() => {
    if (!isManagedDevPc) return;
    componentMounted.current = true;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => {
      componentMounted.current = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  const status = workspace
    ? displayStatus(workspace, pendingAction, statusUnavailable)
    : "unreachable";
  const telemetry = workspace?.telemetry ?? null;
  const idleTimeoutMinutes = managedIdleTimeout.current ?? workspace?.idleTimeoutMinutes;
  const statusMeta = useMemo(() => {
    if (!workspace) return "Status unavailable";
    if (status === "unreachable") {
      const lastSeen = formatClock(workspace.lastHeartbeatAt);
      return lastSeen ? `No response since ${lastSeen}` : "No recent response";
    }
    if (workspace.lastHeartbeatAt && ["running", "reconnecting"].includes(status)) {
      return `Heartbeat ${formatRelativeTime(workspace.lastHeartbeatAt)}`;
    }
    return statusDescription[status];
  }, [status, workspace]);

  if (!isManagedDevPc || !workspace) return null;

  const runAction = async (action: PendingAction) => {
    const path =
      action === "restart"
        ? "/_devpc/workspace/restart"
        : action === "pause"
          ? "/_devpc/workspace/stop"
          : "/_devpc/workspace/start";
    setConfirmation(null);
    updatePendingAction(action);
    updateUncertainAction(null);
    setError(null);
    const existingKey = actionKeys.current[action];
    const idempotencyKey = existingKey ?? `${action}-${randomUUID()}`;
    actionKeys.current[action] = idempotencyKey;
    if (!existingKey) {
      actionProgressObserved.current[action] = false;
      if (action === "restart") restartCompletionConfirmations.current = 0;
    }
    let definitiveFailure = false;
    try {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: "{}",
        signal: AbortSignal.timeout(ACTION_REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        definitiveFailure = !isAmbiguousLifecycleResponse(response.status);
        throw new Error("request failed");
      }
      const result = (await response.json()) as { state?: string };
      const reflectedStatus: ManagedDevPcDisplayStatus | null =
        action === "restart" && result.state === "restarting"
          ? "restarting"
          : action === "pause" && ["stopping", "paused", "stopped"].includes(result.state ?? "")
            ? result.state === "stopping"
              ? "pausing"
              : result.state === "paused"
                ? "paused"
                : "stopped"
            : action === "resume" && ["starting", "ready"].includes(result.state ?? "")
              ? result.state === "starting"
                ? "starting"
                : "running"
              : null;
      actionProgressObserved.current[action] = true;
      if (action === "restart") restartCompletionConfirmations.current = 0;
      if (!componentMounted.current) return;
      if (reflectedStatus) {
        invalidateWorkspaceRefreshes();
        const projectedWorkspace = {
          ...(window.__DEVPC_MANAGED_BOOTSTRAP__ ?? workspace),
          status: reflectedStatus,
          ready: reflectedStatus === "running",
        };
        window.__DEVPC_MANAGED_BOOTSTRAP__ = projectedWorkspace;
        setWorkspace(projectedWorkspace);
        updateUncertainAction(null);
        // Keep the guard until a mounted instance observes the action through the
        // status endpoint. The response can outlive this route's sidebar instance.
        updatePendingAction(action);
      } else {
        // The request was accepted even if the gateway returned a state this client
        // does not model yet. Keep the guard and let status polling settle it.
        invalidateWorkspaceRefreshes();
        updatePendingAction(action);
        updateUncertainAction(null);
      }
      void refresh();
    } catch {
      if (definitiveFailure) {
        delete actionKeys.current[action];
        delete actionProgressObserved.current[action];
        if (action === "restart") restartCompletionConfirmations.current = 0;
        if (pendingActionRef.current === action) updatePendingAction(null);
        if (uncertainActionRef.current === action) updateUncertainAction(null);
        setError(
          action === "resume"
            ? "The workspace could not be resumed. Try again."
            : `The workspace could not be ${action === "pause" ? "paused" : "restarted"}. Try again.`,
        );
      } else if (actionKeys.current[action] === idempotencyKey) {
        updatePendingAction(null);
        updateUncertainAction(action);
        setError("The request was interrupted. Retrying is safe while Aldo checks the workspace.");
        void refresh();
      }
    }
  };

  const updateIdleTimeout = async (value: string | null) => {
    const minutes = Number(value);
    if (!IDLE_TIMEOUTS.includes(minutes as (typeof IDLE_TIMEOUTS)[number])) return;
    const previousIdleTimeoutMinutes = idleTimeoutMinutes;
    pendingIdleTimeout.current = minutes;
    managedIdleTimeout.current = minutes;
    updateManagedSettingsPending(true);
    setError(null);
    invalidateWorkspaceRefreshes();
    const projectedWorkspace = withIdleTimeout(
      window.__DEVPC_MANAGED_BOOTSTRAP__ ?? workspace,
      minutes,
    );
    window.__DEVPC_MANAGED_BOOTSTRAP__ = projectedWorkspace;
    setWorkspace(projectedWorkspace);
    try {
      const response = await fetch(SETTINGS_PATH, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idleTimeoutMinutes: minutes }),
        signal: AbortSignal.timeout(ACTION_REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error("request failed");
      const result = (await response.json()) as { idleTimeoutMinutes?: number };
      const confirmedMinutes = IDLE_TIMEOUTS.includes(
        result.idleTimeoutMinutes as (typeof IDLE_TIMEOUTS)[number],
      )
        ? result.idleTimeoutMinutes
        : minutes;
      pendingIdleTimeout.current = null;
      managedIdleTimeout.current = confirmedMinutes;
      const confirmedWorkspace = withIdleTimeout(
        window.__DEVPC_MANAGED_BOOTSTRAP__ ?? workspace,
        confirmedMinutes,
      );
      window.__DEVPC_MANAGED_BOOTSTRAP__ = confirmedWorkspace;
      if (componentMounted.current) setWorkspace(confirmedWorkspace);
    } catch {
      invalidateWorkspaceRefreshes();
      pendingIdleTimeout.current = null;
      managedIdleTimeout.current = previousIdleTimeoutMinutes;
      const restoredWorkspace = withIdleTimeout(
        window.__DEVPC_MANAGED_BOOTSTRAP__ ?? workspace,
        previousIdleTimeoutMinutes,
      );
      window.__DEVPC_MANAGED_BOOTSTRAP__ = restoredWorkspace;
      if (componentMounted.current) {
        setWorkspace(restoredWorkspace);
        setError("The auto-pause setting could not be updated. Try again.");
      }
    } finally {
      updateManagedSettingsPending(false);
    }
  };

  const canOperate =
    status === "running" &&
    workspace.state === "ready" &&
    pendingAction === null &&
    uncertainAction === null;
  const canResume =
    ["paused", "stopped"].includes(status) && pendingAction === null && uncertainAction === null;
  const autoStopClock = formatClock(workspace.autoStopAt);
  const ariaState = statusLabel[status].replace("…", "");
  const visibleError =
    error ??
    (uncertainAction
      ? "The request was interrupted. Retrying is safe while Aldo checks the workspace."
      : null);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          if (!uncertainActionRef.current) setError(null);
          void refresh();
        }
      }}
    >
      <DialogTrigger
        render={
          <button
            type="button"
            className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-sm text-sidebar-muted-foreground/80 outline-hidden hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            aria-label={`Workspace — ${ariaState}. Open workspace controls.`}
            aria-haspopup="dialog"
            data-devpc-workspace-status={status}
          />
        }
      >
        <StatusDot status={status} />
        <span className="min-w-0 flex-1 truncate text-left font-medium">
          Workspace · {statusLabel[status]}
        </span>
        <ChevronRightIcon className="size-3.5 shrink-0 opacity-45" aria-hidden />
      </DialogTrigger>

      <DialogPopup className="w-full sm:max-w-[440px]" data-devpc-workspace-control-center>
        <DialogHeader>
          <DialogTitle>Workspace</DialogTitle>
          <DialogDescription className="sr-only">
            View workspace health, resources, settings, and controls.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-5">
          <section className="space-y-3" aria-live="polite">
            <div className="flex items-start gap-2.5">
              <div className="pt-0.5">
                <StatusDot status={status} />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{statusLabel[status]}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{statusMeta}</p>
              </div>
            </div>
            {canResume ? (
              <Button className="w-full" onClick={() => void runAction("resume")}>
                <PlayIcon />
                Resume workspace
              </Button>
            ) : null}
            {visibleError ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-destructive">{visibleError}</p>
                {uncertainAction ? (
                  <Button
                    className="shrink-0"
                    size="xs"
                    variant="outline"
                    onClick={() => void runAction(uncertainAction)}
                  >
                    Retry {uncertainAction === "pause" ? "pause" : uncertainAction}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="space-y-2 border-t pt-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-sm font-semibold" htmlFor="workspace-idle-timeout">
                  Pause after inactivity
                </label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Agent work counts even when this tab is closed.
                </p>
              </div>
              <Select
                value={idleTimeoutMinutes === undefined ? null : String(idleTimeoutMinutes)}
                onValueChange={(value) => void updateIdleTimeout(value)}
                disabled={settingsPending || idleTimeoutMinutes === undefined}
              >
                <SelectTrigger
                  id="workspace-idle-timeout"
                  className="w-32 shrink-0"
                  size="sm"
                  aria-label="Pause after inactivity"
                >
                  <SelectValue>{idleTimeoutLabel(idleTimeoutMinutes)}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {IDLE_TIMEOUTS.map((minutes) => (
                    <SelectItem key={minutes} value={String(minutes)}>
                      {idleTimeoutLabel(minutes)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {status === "paused"
                ? "Paused until you resume."
                : idleTimeoutMinutes === undefined
                  ? "Auto-pause timing is unavailable."
                  : autoStopClock
                    ? `Pauses around ${autoStopClock} if activity stays quiet.`
                    : `Pauses after ${idleTimeoutLabel(idleTimeoutMinutes)} of inactivity.`}
            </p>
          </section>

          {telemetry ? (
            <Metrics telemetry={telemetry} status={status} onRetry={() => void refresh()} />
          ) : null}

          <section className="space-y-3 border-t pt-5">
            <h3 className="text-sm font-semibold">Details</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-xs">
              <dt className="text-muted-foreground">Region</dt>
              <dd className="text-right">{workspace.region ?? "—"}</dd>
              <dt className="text-muted-foreground">Machine</dt>
              <dd className="text-right">
                {workspace.machine
                  ? `${workspace.machine.cpuCount} vCPU · ${formatBytes(
                      workspace.machine.memoryBytes,
                    )}`
                  : "—"}
              </dd>
              <dt className="text-muted-foreground">Uptime</dt>
              <dd className="text-right">
                {telemetry ? formatUptime(telemetry.uptimeSeconds) : "—"}
              </dd>
              <dt className="text-muted-foreground">Runtime</dt>
              <dd className="truncate text-right">{workspace.runtimeVersion ?? "—"}</dd>
              <dt className="text-muted-foreground">T3</dt>
              <dd className="truncate text-right">{workspace.t3Version ?? "—"}</dd>
            </dl>
          </section>
        </DialogPanel>
        <DialogFooter className="max-sm:flex-col sm:justify-end">
          <div className="flex gap-2 max-sm:flex-col">
            <Button
              className="max-sm:w-full"
              variant="outline"
              disabled={!canOperate}
              onClick={() => setConfirmation("restart")}
            >
              <RotateCwIcon />
              Restart
            </Button>
            <Button
              className="max-sm:w-full"
              variant="outline"
              disabled={!canOperate}
              onClick={() => setConfirmation("pause")}
            >
              <PauseIcon />
              Pause
            </Button>
          </div>
        </DialogFooter>
      </DialogPopup>

      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(next) => !next && setConfirmation(null)}
      >
        <AlertDialogPopup className="sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmation === "pause" ? "Pause workspace?" : "Restart workspace?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation === "pause"
                ? "Processes stop and the workspace stays paused until you resume it. Reloading Aldo will not wake it. Files are kept."
                : "Running processes stop and anything held in memory is lost. Files on the workspace disk are kept. This takes about a minute."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button onClick={() => void runAction(confirmation === "pause" ? "pause" : "restart")}>
              {confirmation === "pause" ? "Pause" : "Restart"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </Dialog>
  );
}
