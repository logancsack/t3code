/**
 * ThreadPlanProgressService - in-memory per-thread plan progress for the
 * Working indicators (sidebar rows, in-chat working line).
 *
 * Plans are a progress annotation, not a surface of their own: the useful
 * kernel of a turn.plan.updated event is "which step is the agent on right
 * now". Ingestion records the current step here and the shell query reads it
 * at mapping time — no persistence, no migration (same pattern as
 * ThreadBackgroundLivenessService). Cleared when the turn settles or the
 * session dies, so a finished plan never lingers as stale UI.
 *
 * The same goes for what the turn is doing at this moment (current work):
 * thinking, a tool call (its latest activity, as the timeline has it), or
 * writing its reply, and since when.
 *
 * @module ThreadPlanProgressService
 */
import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export interface ThreadPlanProgress {
  readonly step: string;
  readonly completedSteps: number;
  readonly totalSteps: number;
}

export interface ThreadCurrentWork {
  readonly kind: "thinking" | "tool" | "writing";
  readonly startedAt: string;
  /** For a tool call, its latest activity (payload projected for clients). */
  readonly activity: OrchestrationThreadActivity | null;
}

interface PlanStepInput {
  readonly step: string;
  readonly status: string;
}

export class ThreadPlanProgressService extends Context.Service<
  ThreadPlanProgressService,
  {
    /**
     * Feed one turn.plan.updated payload. An all-completed plan clears the
     * entry (the turn is wrapping up; nothing is "in progress" anymore).
     */
    readonly recordPlanProgress: (threadId: string, plan: ReadonlyArray<PlanStepInput>) => void;

    /** Turn settled or session died: the working indicator reverts to plain. */
    readonly clearThreadPlanProgress: (threadId: string) => void;

    /** A turn started: what an earlier one was doing is over. */
    readonly clearThreadCurrentWork: (threadId: string) => void;

    readonly getThreadPlanProgress: (threadId: string) => ThreadPlanProgress | null;

    /** The turn streams its reasoning or its reply (between tool calls). */
    readonly recordStreaming: (threadId: string, kind: "thinking" | "writing", at: string) => void;

    /** A tool activity (tool.started / tool.updated / tool.completed), projected. */
    readonly recordToolActivity: (threadId: string, activity: OrchestrationThreadActivity) => void;

    readonly getThreadCurrentWork: (threadId: string) => ThreadCurrentWork | null;
  }
>()("t3/orchestration/ThreadPlanProgress/ThreadPlanProgressService") {}

const ENDED_TOOL_STATUSES = new Set(["completed", "failed", "declined", "stopped"]);

function toolCallIdOf(activity: OrchestrationThreadActivity): string | null {
  const payload = activity.payload as { toolCallId?: unknown } | null;
  return typeof payload?.toolCallId === "string" ? payload.toolCallId : null;
}

function toolEnded(activity: OrchestrationThreadActivity): boolean {
  const status = (activity.payload as { status?: unknown } | null)?.status;
  return (
    activity.kind === "tool.completed" ||
    (typeof status === "string" && ENDED_TOOL_STATUSES.has(status))
  );
}

export function make(): ThreadPlanProgressService["Service"] {
  const progressByThreadId = new Map<string, ThreadPlanProgress>();
  const workByThreadId = new Map<string, ThreadCurrentWork>();
  // Tool calls under way, by id, oldest first: the newest is the current work.
  const toolsByThreadId = new Map<
    string,
    Map<string, { readonly activity: OrchestrationThreadActivity; readonly startedAt: string }>
  >();

  return {
    recordPlanProgress: (threadId, plan) => {
      const totalSteps = plan.length;
      const completedSteps = plan.filter((step) => step.status === "completed").length;
      // Current step: the in-progress one, else the first pending one (a
      // plan that was just written has no in-progress step yet).
      const current =
        plan.find((step) => step.status === "inProgress") ??
        plan.find((step) => step.status !== "completed");
      if (totalSteps === 0 || completedSteps === totalSteps || current === undefined) {
        progressByThreadId.delete(threadId);
        return;
      }
      progressByThreadId.set(threadId, {
        step: current.step,
        completedSteps,
        totalSteps,
      });
    },

    clearThreadPlanProgress: (threadId) => {
      progressByThreadId.delete(threadId);
      workByThreadId.delete(threadId);
      toolsByThreadId.delete(threadId);
    },

    clearThreadCurrentWork: (threadId) => {
      workByThreadId.delete(threadId);
      toolsByThreadId.delete(threadId);
    },

    getThreadPlanProgress: (threadId) => progressByThreadId.get(threadId) ?? null,

    recordStreaming: (threadId, kind, at) => {
      // Text streamed while a tool runs doesn't replace the tool.
      if ((toolsByThreadId.get(threadId)?.size ?? 0) > 0) return;
      if (workByThreadId.get(threadId)?.kind === kind) return;
      workByThreadId.set(threadId, { kind, startedAt: at, activity: null });
    },

    recordToolActivity: (threadId, activity) => {
      const id = toolCallIdOf(activity);
      if (!id) return;
      const tools = toolsByThreadId.get(threadId) ?? new Map();
      toolsByThreadId.set(threadId, tools);
      if (toolEnded(activity)) {
        tools.delete(id);
      } else {
        tools.set(id, { activity, startedAt: tools.get(id)?.startedAt ?? activity.createdAt });
      }
      const newest = [...tools.values()].at(-1);
      workByThreadId.set(
        threadId,
        newest
          ? { kind: "tool", startedAt: newest.startedAt, activity: newest.activity }
          : // Its last tool call ended: it's thinking about what's next.
            { kind: "thinking", startedAt: activity.createdAt, activity: null },
      );
    },

    getThreadCurrentWork: (threadId) => workByThreadId.get(threadId) ?? null,
  };
}

export const layer = Layer.effect(ThreadPlanProgressService, Effect.sync(make));
