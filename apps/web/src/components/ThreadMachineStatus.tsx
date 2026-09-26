import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { CloudIcon, MoonIcon, TriangleAlertIcon } from "lucide-react";
import { useMemo } from "react";

import type { ManagedDevPcDisplayStatus } from "../managedDevPc";
import { useThreadShell } from "../state/entities";
import {
  deriveThreadMachineView,
  type ThreadMachinePhase,
  type ThreadMachineView,
} from "../threadMachine";
import type { ComposerBannerStackItem } from "./chat/ComposerBannerStack";
import { StatusDot } from "./ManagedDevPcStatus";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const DOT_STATUS: Record<ThreadMachinePhase, ManagedDevPcDisplayStatus> = {
  transitional: "starting",
  running: "running",
  asleep: "paused",
  failed: "attention",
};

/** The thread machine's state in the chat header. Renders nothing off a hub. */
export function ThreadMachineStatusPill(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const threadRef = useMemo(
    () => scopeThreadRef(props.environmentId, props.threadId),
    [props.environmentId, props.threadId],
  );
  const machine = useThreadShell(threadRef)?.machine;
  const view = deriveThreadMachineView(machine);
  if (!view) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="status"
            aria-label={`Machine: ${view.description}`}
            data-thread-machine-state={view.state}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-border/70 px-2 text-xs font-medium text-muted-foreground"
          />
        }
      >
        <StatusDot status={DOT_STATUS[view.phase]} />
        <span className="hidden @xl/header-actions:inline">{view.label}</span>
      </TooltipTrigger>
      <TooltipPopup side="bottom" className="max-w-72 whitespace-normal">
        {view.description}
      </TooltipPopup>
    </Tooltip>
  );
}

/**
 * The composer notice for a machine the user has to know about: asleep (the
 * next send wakes it) or failed (with a retry when one is possible).
 */
export function buildThreadMachineBannerItem(input: {
  readonly threadKey: string;
  readonly view: ThreadMachineView | null;
  readonly onRetry: (() => void) | null;
  readonly retrying: boolean;
  readonly onDismiss: () => void;
}): ComposerBannerStackItem | null {
  const { view } = input;
  if (!view) return null;
  if (view.phase === "asleep") {
    return {
      id: `thread-machine:${input.threadKey}:${view.state}`,
      variant: "info",
      priority: "notice",
      icon: <MoonIcon />,
      title: view.description,
      dismissLabel: "Dismiss machine status",
      onDismiss: input.onDismiss,
    };
  }
  if (view.phase === "failed") {
    return {
      id: `thread-machine:${input.threadKey}:failed:${view.updatedAt}`,
      variant: "error",
      icon: <TriangleAlertIcon />,
      title: "This thread's machine failed",
      description: view.detail ?? "Send a message to try again.",
      ...(input.onRetry
        ? {
            actions: (
              <Button size="xs" variant="outline" disabled={input.retrying} onClick={input.onRetry}>
                {input.retrying ? "Retrying…" : "Retry"}
              </Button>
            ),
          }
        : {}),
    };
  }
  return null;
}

/** Stands in for machine-backed panels (files) while the machine sleeps. */
export function ThreadMachineAsleepPanel({ view }: { readonly view: ThreadMachineView }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <MoonIcon className="size-5 text-muted-foreground/70" aria-hidden />
      <p className="text-sm font-medium text-foreground">
        {view.phase === "failed" ? "Machine unavailable" : "Machine asleep"}
      </p>
      <p className="max-w-xs text-sm text-muted-foreground">
        {view.phase === "failed"
          ? (view.detail ?? "This thread's machine could not start.")
          : "Files live on this thread's machine. Send a message to wake it."}
      </p>
    </div>
  );
}

/** Where a new hub thread runs, in place of the local/worktree picker. */
export function HubRunContextLabel() {
  return (
    <span
      className="inline-flex h-7 min-w-0 items-center gap-1 px-[calc(--spacing(2)-1px)] text-sm font-medium text-muted-foreground/70 sm:h-6"
      data-composer-context-control
    >
      <CloudIcon className="size-3 shrink-0" />
      <span
        data-composer-label
        className="min-w-0 truncate group-data-[compact]/composer-context:max-w-0"
      >
        New machine
      </span>
    </span>
  );
}
