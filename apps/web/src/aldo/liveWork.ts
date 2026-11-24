// The live step of a thread whose machine this page is connected to, for its
// card and its drop-down row (liveWork.logic.ts). T3's shell of the thread says
// whether a run is under way and since when; it doesn't carry the step in
// words, so the line is the render's, when there is one. Nothing here wakes a
// machine or opens a thread: a machine this page isn't connected to has no live
// step, nor one whose shell is only what it last kept (cached, or catching up
// after the connection dropped), and the card says what Aldo's read has.

import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentShellStatus } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect, useMemo, useState } from "react";

import { useThreadShell } from "../state/entities";
import { environmentShell } from "../state/shell";
import type { AldoHomeTarget } from "./homeApi";
import { useAldoGpuRender } from "./liveFrames";
import type { AldoLiveWork } from "./liveWork.logic";

type Shell = Pick<NonNullable<ReturnType<typeof useThreadShell>>, "latestRun" | "runtime">;

/** The run a thread's shell says is under way; null while none runs, or the shell isn't live. */
export function shellWork(
  shell: Shell | null,
  status: EnvironmentShellStatus,
): AldoLiveWork | null {
  const run = shell?.latestRun;
  if (status !== "live" || !run) return null;
  if (shell?.runtime?.status !== "running" || run.status !== "running") return null;
  const since = shell.runtime.activityStartedAt ?? run.startedAt ?? run.requestedAt;
  return since ? { kind: "tool", doing: null, since } : null;
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
