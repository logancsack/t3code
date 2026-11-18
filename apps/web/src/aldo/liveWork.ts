// The live step of a thread whose machine this page is connected to, for its
// card and its drop-down row (liveWork.logic.ts). T3's shell of the thread
// carries what a working line needs: whether a turn is running, what it's
// doing now (`currentWork`: thinking, writing, or a tool call, worded as the
// thread's timeline words it) and its plan's step (planProgress). A machine
// whose T3 doesn't report what it's doing gives the plan's step, or nothing.
// Nothing here wakes a machine or opens a thread: a machine this page isn't
// connected to has no live step, nor one whose shell is only what it last
// kept (cached, or catching up after the connection dropped), and the card
// says what Aldo's read has. A
// render on the GPU computer says its frame, while its card's view reads it.

import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentShellStatus } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, OrchestrationThreadActivity, ThreadId } from "@t3tools/contracts";
import { useEffect, useMemo, useState } from "react";

import { deriveWorkLogEntries } from "../session-logic";
import { useThreadShell } from "../state/entities";
import { environmentShell } from "../state/shell";
import type { AldoHomeTarget } from "./homeApi";
import { useAldoGpuRender } from "./liveFrames";
import type { AldoLiveWork } from "./liveWork.logic";
import { aldoStepUnderWay } from "./progress.logic";
import { aldoWorkStep, aldoWorkWords } from "./workLabels.logic";

type Shell = NonNullable<ReturnType<typeof useThreadShell>>;

/** A tool call under way in the thread's own words ("Running tests"), and the site, for one in the browser. */
function toolStep(
  activity: OrchestrationThreadActivity,
): Pick<AldoLiveWork, "doing" | "surface" | "site"> | null {
  // The timeline words a call under way from its updates, and its start says the same.
  const [entry] = deriveWorkLogEntries([
    activity.kind === "tool.started" ? { ...activity, kind: "tool.updated" } : activity,
  ]);
  if (!entry) return null;
  const step = aldoWorkStep(entry);
  return {
    doing: aldoWorkWords.step(entry, true),
    surface: step?.kind === "browse" ? "browser" : null,
    site: step?.site ?? null,
  };
}

/** The step a thread's shell says is under way; null while no turn runs, or the shell isn't live. */
export function shellWork(
  shell: Shell | null,
  status: EnvironmentShellStatus,
): AldoLiveWork | null {
  const turn = shell?.latestTurn;
  if (status !== "live" || !shell) return null;
  if (shell.session?.status !== "running" || turn?.state !== "running") return null;
  const reported = shell.currentWork ?? null;
  const progress = shell.planProgress ?? null;
  const plan = progress ? { done: progress.completedSteps, total: progress.totalSteps } : null;
  if (reported) {
    const tool = reported.activity ? toolStep(reported.activity) : null;
    return {
      kind: reported.kind,
      // A call it has no words for is on the plan's step.
      doing: tool?.doing ?? (progress ? aldoStepUnderWay(progress.step) : null),
      since: reported.startedAt,
      plan,
      surface: tool?.surface ?? null,
      site: tool?.site ?? null,
    };
  }
  if (progress)
    return {
      kind: "tool",
      doing: aldoStepUnderWay(progress.step),
      since: turn.startedAt ?? turn.requestedAt,
      plan,
    };
  return null;
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
