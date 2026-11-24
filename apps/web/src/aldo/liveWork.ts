// The live step of a thread whose machine this page is connected to, for its
// card and its drop-down row (liveWork.logic.ts). T3's shell of the thread says
// whether a run is under way and since when, and on Aldo's machines what it's
// doing now (`liveWork`: thinking, writing, or a tool call, worded as the
// thread's timeline words it) and its plan's step. A machine whose T3 doesn't
// report that gives no words, only that it's working. Nothing here wakes a
// machine or opens a thread: a machine this page isn't connected to has no live
// step, nor one whose shell is only what it last kept (cached, or catching up
// after the connection dropped), and the card says what Aldo's read has.

import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentShellStatus } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, OrchestrationV2ThreadLiveWork, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { useEffect, useMemo, useState } from "react";

import { deriveTimelineEntriesFromVisibleTurnItems } from "../session-logic";
import { useThreadShell } from "../state/entities";
import { environmentShell } from "../state/shell";
import type { AldoHomeTarget } from "./homeApi";
import { useAldoGpuRender } from "./liveFrames";
import type { AldoLiveWork } from "./liveWork.logic";
import { aldoStepUnderWay } from "./progress.logic";
import { aldoWorkStep, aldoWorkWords } from "./workLabels.logic";

type Shell = Pick<NonNullable<ReturnType<typeof useThreadShell>>, "latestRun" | "runtime"> & {
  readonly source: { readonly liveWork?: OrchestrationV2ThreadLiveWork | undefined };
};

/** A tool call under way in the thread's own words ("Running tests"), and the site, for one in the browser. */
function toolStep(
  item: NonNullable<OrchestrationV2ThreadLiveWork["tool"]>,
): Pick<AldoLiveWork, "doing" | "surface" | "site"> | null {
  const [row] = deriveTimelineEntriesFromVisibleTurnItems({
    visibleTurnItems: [
      {
        position: 0,
        visibility: "local",
        sourceThreadId: item.threadId,
        sourceItemId: item.id,
        item,
      },
    ],
    optimisticMessages: [],
  });
  if (row?.kind !== "work") return null;
  const step = aldoWorkStep(row.entry);
  return {
    doing: aldoWorkWords.step(row.entry, true),
    surface: step?.kind === "browse" ? "browser" : null,
    site: step?.site ?? null,
  };
}

/** The step a thread's shell says is under way; null while no run is, or the shell isn't live. */
export function shellWork(
  shell: Shell | null,
  status: EnvironmentShellStatus,
): AldoLiveWork | null {
  const run = shell?.latestRun;
  if (status !== "live" || !run) return null;
  if (shell?.runtime?.status !== "running" || run.status !== "running") return null;
  const reported = shell.source.liveWork;
  if (reported === undefined) {
    const since = shell.runtime.activityStartedAt ?? run.startedAt ?? run.requestedAt;
    return since ? { kind: "tool", doing: null, since } : null;
  }
  const tool = reported.tool ? toolStep(reported.tool) : null;
  return {
    kind: reported.kind,
    // A call it has no words for is on the plan's step.
    doing: tool?.doing ?? (reported.plan ? aldoStepUnderWay(reported.plan.step) : null),
    since: DateTime.formatIso(reported.startedAt),
    plan: reported.plan
      ? { done: reported.plan.completedSteps, total: reported.plan.totalSteps }
      : null,
    surface: tool?.surface ?? null,
    site: tool?.site ?? null,
  };
}

/** What a thread is doing now, live, with its render on the GPU computer; null when this page has no live word of it. */
export function useAldoLiveWork(target: AldoHomeTarget): AldoLiveWork | null {
  const ref = useMemo(
    () => scopeThreadRef(target.environmentId as EnvironmentId, target.threadId as ThreadId),
    [target.environmentId, target.threadId],
  );
  const status = useAtomValue(
    environmentShell.stateValueAtom(target.environmentId as EnvironmentId),
  ).status;
  const work = shellWork(useThreadShell(ref), status);
  const render = useAldoGpuRender(target);
  return work && render ? { ...work, render } : work;
}

/** The time, taken again every 15 seconds: often enough for a line's "· 4 min". */
export function useAldoLiveNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
