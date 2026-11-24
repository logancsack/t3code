/**
 * What each running thread is doing right now, for a managed workspace's thread list: thinking,
 * writing, or a tool call, and the step of its task list. Held in memory, read when a shell is
 * sent, and dropped when the run settles. Nothing here is stored.
 */
import type {
  OrchestrationV2DomainEvent,
  OrchestrationV2ThreadLiveWork,
  OrchestrationV2ThreadShell,
  OrchestrationV2TurnItem,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { forkParked } from "../serverActivation.ts";

type TurnItem = OrchestrationV2TurnItem;
type ToolItem = Extract<
  TurnItem,
  {
    readonly type:
      | "command_execution"
      | "file_change"
      | "file_search"
      | "web_search"
      | "dynamic_tool"
      | "subagent";
  }
>;
type LiveWork = OrchestrationV2ThreadLiveWork;

const OPEN_ITEM_STATUSES = new Set<TurnItem["status"]>(["pending", "running", "waiting"]);
const SETTLED_RUN_STATUSES = new Set([
  "completed",
  "interrupted",
  "failed",
  "cancelled",
  "rolled_back",
]);
const MAX_TEXT = 1_000;
const MAX_ARGUMENT = 300;
const MAX_CHANGES = 20;

const clip = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);

function isToolItem(item: TurnItem): item is ToolItem {
  switch (item.type) {
    case "command_execution":
    case "file_change":
    case "file_search":
    case "web_search":
    case "dynamic_tool":
    case "subagent":
      return true;
    default:
      return false;
  }
}

/** The arguments a step is worded from (a path, an address, a name); long values are bodies. */
function wordedInput(input: unknown): unknown {
  if (typeof input === "string") return clip(input, MAX_TEXT);
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const worded: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") worded[key] = clip(value, MAX_ARGUMENT);
    else if (typeof value === "number" || typeof value === "boolean") worded[key] = value;
  }
  return worded;
}

/**
 * A tool call as the list words it: no output or file bodies, and times fixed at its start so an
 * update that only adds output leaves it equal.
 */
export function bareToolItem(item: ToolItem, startedAt: LiveWork["startedAt"]): ToolItem {
  const fixed = { startedAt, updatedAt: startedAt, completedAt: null };
  switch (item.type) {
    case "command_execution": {
      const { output: _output, deferredWork: _deferred, ...rest } = item;
      return { ...rest, ...fixed, input: clip(item.input, MAX_TEXT) };
    }
    case "file_change": {
      const { diffStr: _diff, oldStr: _old, newStr: _new, deferredWork: _deferred, ...rest } = item;
      return {
        ...rest,
        ...fixed,
        ...(item.changes === undefined ? {} : { changes: item.changes.slice(0, MAX_CHANGES) }),
      };
    }
    case "file_search":
    case "web_search": {
      const { results: _results, deferredWork: _deferred, ...rest } = item;
      return { ...rest, ...fixed };
    }
    case "dynamic_tool": {
      const { output: _output, deferredWork: _deferred, ...rest } = item;
      return { ...rest, ...fixed, input: wordedInput(item.input) };
    }
    case "subagent": {
      const { progress: _progress, deferredWork: _deferred, ...rest } = item;
      return { ...rest, ...fixed, prompt: clip(item.prompt, MAX_ARGUMENT), result: null };
    }
  }
}

function planOf(
  steps: Extract<TurnItem, { readonly type: "todo_list" }>["steps"],
): LiveWork["plan"] {
  const current =
    steps.find((step) => step.status === "running") ??
    steps.find((step) => step.status !== "completed");
  if (current === undefined) return null;
  return {
    step: current.text,
    completedSteps: steps.filter((step) => step.status === "completed").length,
    totalSteps: steps.length,
  };
}

const samePlan = (left: LiveWork["plan"], right: LiveWork["plan"]) =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.step === right.step &&
    left.completedSteps === right.completedSteps &&
    left.totalSteps === right.totalSteps);

interface Tracked {
  /** Open tool calls, oldest first; the newest is the one shown. */
  readonly open: Map<TurnItemId, { readonly tool: ToolItem; readonly key: string }>;
  streaming: Pick<LiveWork, "kind" | "startedAt"> | null;
  plan: LiveWork["plan"];
  /** Replaced only when it changes, so the shell stream's unchanged check drops everything else. */
  work: LiveWork | undefined;
}

/**
 * Follows a thread's events. `work` keeps its identity until the kind, the tool call or the plan
 * step changes: text deltas and tool output move nothing.
 */
export function makeTracker() {
  const threads = new Map<ThreadId, Tracked>();

  const refresh = (tracked: Tracked) => {
    const newest = Array.from(tracked.open.values()).at(-1);
    tracked.work =
      newest !== undefined
        ? { kind: "tool", startedAt: newest.tool.updatedAt, tool: newest.tool, plan: tracked.plan }
        : tracked.streaming !== null
          ? { ...tracked.streaming, tool: null, plan: tracked.plan }
          : undefined;
  };

  const record = (event: OrchestrationV2DomainEvent): void => {
    if (event.type === "thread.deleted") {
      threads.delete(event.threadId);
      return;
    }
    if (event.type === "run.updated") {
      if (SETTLED_RUN_STATUSES.has(event.payload.status)) threads.delete(event.threadId);
      return;
    }
    if (event.type !== "turn-item.updated") return;
    const item = event.payload;
    let tracked = threads.get(event.threadId);
    if (tracked === undefined) {
      tracked = { open: new Map(), streaming: null, plan: null, work: undefined };
      threads.set(event.threadId, tracked);
    }
    if (isToolItem(item)) {
      const known = tracked.open.get(item.id);
      if (!OPEN_ITEM_STATUSES.has(item.status)) {
        if (known === undefined) return;
        tracked.open.delete(item.id);
        if (tracked.open.size === 0) {
          tracked.streaming = { kind: "thinking", startedAt: event.occurredAt };
        }
      } else {
        const tool = bareToolItem(
          item,
          known?.tool.updatedAt ?? item.startedAt ?? event.occurredAt,
        );
        const key = JSON.stringify(tool);
        if (known?.key === key) return;
        tracked.open.set(item.id, { tool, key });
      }
    } else if (item.type === "todo_list") {
      const plan = planOf(item.steps);
      if (samePlan(tracked.plan, plan)) return;
      tracked.plan = plan;
      tracked.streaming ??= { kind: "thinking", startedAt: event.occurredAt };
    } else if (
      (item.type === "reasoning" || item.type === "assistant_message") &&
      (item.streaming || OPEN_ITEM_STATUSES.has(item.status))
    ) {
      const kind = item.type === "reasoning" ? "thinking" : "writing";
      if (tracked.streaming?.kind === kind) return;
      tracked.streaming = { kind, startedAt: event.occurredAt };
      // A tool call still open is what the thread is doing; this shows once it closes.
      if (tracked.open.size > 0) return;
    } else {
      return;
    }
    refresh(tracked);
  };

  return { record, get: (threadId: ThreadId) => threads.get(threadId)?.work };
}

/** Adds what a thread is doing to its shell. Anything but a managed workspace adds nothing. */
export class ThreadLiveWork extends Context.Reference<{
  readonly withLiveWork: (shell: OrchestrationV2ThreadShell) => OrchestrationV2ThreadShell;
}>("t3/managedDevPc/ThreadLiveWork", {
  defaultValue: () => ({ withLiveWork: (shell) => shell }),
}) {}

export const layer = Layer.effect(
  ThreadLiveWork,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    if (!config.managedDevPc) return ThreadLiveWork.defaultValue();
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const tracker = makeTracker();
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) =>
        Effect.sync(() => tracker.record(event)),
      ),
    );
    return {
      withLiveWork: (shell) => {
        const liveWork = shell.activeRunId === null ? undefined : tracker.get(shell.id);
        return liveWork === undefined ? shell : { ...shell, liveWork };
      },
    };
  }),
);
