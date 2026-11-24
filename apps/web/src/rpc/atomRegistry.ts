import { RegistryContext } from "@effect/atom-react";
import * as Scheduler from "effect/Scheduler";
import { Atom, AtomRegistry } from "effect/reactivity";
import { createElement } from "react";

import { isAldoCloud } from "../aldo/api";

/** Fiber resumes waiting for the next microtask, in the order they were asked for. */
let resumes: Array<() => void> = [];

function runResumes(): void {
  const due = resumes;
  resumes = [];
  // One batch for every fiber resumed now, so an atom that reads every environment rebuilds
  // once for all that changed. A resume asked for while these run waits for the next microtask.
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

// Aldo connects hundreds of environments at once, so its atoms' fibers resume together.
export const appAtomRegistry = isAldoCloud
  ? Object.assign(AtomRegistry.make(), {
      scheduler: new Scheduler.MixedScheduler("sync", resumeInBatches),
    })
  : AtomRegistry.make();

export function AppAtomRegistryProvider({ children }: React.PropsWithChildren) {
  return createElement(RegistryContext.Provider, { value: appAtomRegistry }, children);
}

/**
 * Calls `listener` with each value after the current one. A bare `subscribe` never computes a
 * derived atom nobody has read, so it never learns its parents and never fires.
 */
export function subscribeAtomChanges<A>(
  atom: Atom.Atom<A>,
  listener: (value: A) => void,
): () => void {
  let current = true;
  return appAtomRegistry.subscribe(
    atom,
    (value) => {
      if (current) {
        current = false;
        return;
      }
      listener(value);
    },
    { immediate: true },
  );
}
