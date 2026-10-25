import { RegistryContext } from "@effect/atom-react";
import * as Scheduler from "effect/Scheduler";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { createElement } from "react";

/** Fiber resumes waiting for the next microtask, in the order they were asked for. */
let resumes: Array<() => void> = [];

function runResumes(): void {
  const due = resumes;
  resumes = [];
  // One batch for every fiber resumed now: an atom that reads every
  // environment (presentations, the sidebar's lists) rebuilds once for all
  // that changed, not once for each. With hundreds of environments, opening
  // the app rebuilt each of them hundreds of times. A resume asked for while
  // these run waits for the next microtask, as it would have.
  Atom.batch(() => {
    for (const resume of due) {
      try {
        resume();
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  });
}

function resumeInBatches(resume: () => void): () => void {
  let cancelled = false;
  resumes.push(() => {
    if (!cancelled) resume();
  });
  if (resumes.length === 1) queueMicrotask(runResumes);
  return () => {
    cancelled = true;
  };
}

/**
 * The registry atoms' fibers run on (their effects and streams): resumed in
 * microtasks, as by default, but together. Its own housekeeping (removing
 * unused atoms) keeps the registry's other scheduler and its timing.
 */
export const appAtomRegistry = Object.assign(AtomRegistry.make(), {
  scheduler: new Scheduler.MixedScheduler("sync", resumeInBatches),
});

export function AppAtomRegistryProvider({ children }: React.PropsWithChildren) {
  return createElement(RegistryContext.Provider, { value: appAtomRegistry }, children);
}
