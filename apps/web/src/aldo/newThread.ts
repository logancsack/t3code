// Starting a thread at once (B1): "New" opens a draft where the user is (in
// the project of the thread on screen, else General), ready to type in, and
// the draft's place picker (AldoDraftPlace) moves it to another project or
// repository before its first message, taking what's typed along. T3's own
// ways in (its "without a project", its draft's project picker) do the same,
// each thread on a machine of its own.

import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { toastManager } from "../components/ui/toast";
import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { randomUUID } from "../lib/utils";
import { waitForProject } from "../state/entities";
import {
  aldoSupportsGeneralThreads,
  getAldoEnvironments,
  subscribeAldoEnvironments,
  type AldoNewProject,
} from "./directory";
import { isAldoCloud } from "./api";
import { aldoProjectRefForNewThread, startAldoSandbox } from "./threads";

/** What's typed in a draft being moved, for the draft it moves to (AldoRepositoryDialog). */
let carried: { readonly from: DraftId; readonly prompt: string } | null = null;

/** Keeps a draft's words for the thread the start dialog opens next. */
export function carryAldoDraft(from: DraftId, prompt: string): void {
  carried = prompt.trim() ? { from, prompt } : null;
}

/** Puts carried words into the draft that just opened, and empties the one they came from. */
export function landAldoCarriedDraft(opened: { readonly draftId: DraftId } | null): void {
  const words = carried;
  carried = null;
  if (!opened || !words) return;
  const store = useComposerDraftStore.getState();
  store.setPrompt(opened.draftId, words.prompt);
  if (words.from !== opened.draftId) store.setPrompt(words.from, "");
}

export function dropAldoCarriedDraft(): void {
  carried = null;
}

type Opened = { readonly draftId: DraftId } | null;

/** The start under way, shared by every place that opens a thread, with where it opens (its repositories). */
let opening: { readonly place: string; readonly done: Promise<Opened> } | null = null;

/**
 * Opens a thread in `place` (its repositories; a share's is its own) with
 * `open`: one elsewhere goes first, then this one opens where it was asked,
 * not in that one's draft; one under way for the same place, whichever button
 * or key asked, is the one it opens (a second would make another computer).
 */
export async function openAldoThreadOnce(
  place: string,
  open: () => Promise<Opened>,
): Promise<Opened> {
  for (let other = opening; other && other.place !== place; other = opening) await other.done;
  if (opening) return opening.done;
  const done = open().finally(() => {
    opening = null;
  });
  opening = { place, done };
  return done;
}

/**
 * Opens a draft thread in `repos` (none: General) at once; `carry` moves a
 * draft's words into it, and `alone` opens one of its own (what was shared),
 * never the one another start opens. Resolves with the draft that opened, or null.
 */
export function useStartAldoThread(): {
  readonly start: (
    repos: ReadonlyArray<string>,
    carry?: { readonly from: DraftId; readonly prompt: string },
    alone?: boolean,
  ) => Promise<Opened>;
  readonly starting: boolean;
} {
  const handleNewThread = useNewThreadHandler();
  const [starting, setStarting] = useState(false);
  const start = useCallback(
    async (
      repos: ReadonlyArray<string>,
      carry?: { readonly from: DraftId; readonly prompt: string },
      alone = false,
    ) => {
      // One alone is a place of its own: it waits for the others, and they for it.
      const place = alone ? randomUUID() : repos.join("\n");
      return openAldoThreadOnce(place, async () => {
        setStarting(true);
        try {
          // When there's no machine to be had, startAldoSandbox says why.
          const projectRef = await startAldoSandbox({ repos }).catch(() => null);
          if (projectRef === null) return null;
          if (carry) carryAldoDraft(carry.from, carry.prompt);
          const opened = await handleNewThread(projectRef);
          landAldoCarriedDraft(opened);
          return opened;
        } catch (cause) {
          dropAldoCarriedDraft();
          toastManager.add({
            type: "error",
            title: "Couldn't open a new thread",
            description: cause instanceof Error ? cause.message : String(cause),
          });
          return null;
        } finally {
          setStarting(false);
        }
      });
    },
    [handleNewThread],
  );
  return { start, starting };
}

/**
 * Where "New" opens a thread: in the project of the thread on screen (its
 * machine's repositories, as T3's New does), else General (none).
 */
export function aldoNewThreadPlace(
  environmentId: string | null | undefined,
): ReadonlyArray<string> {
  const machine = getAldoEnvironments()?.find((entry) => entry.environmentId === environmentId);
  return machine ? (machine.repos ?? [machine.repo]).filter((ref) => ref.length > 0) : [];
}

/** Each draft's latest move asked for (aldoProjectForMovedDraft), so only that one lands. */
const latestMoves = new Map<DraftId, number>();
let moves = 0;

/**
 * Where a draft can move: a project the client has (another machine of it),
 * repositories (none: General), or a new project; null is General.
 */
export type AldoDraftTarget =
  | ScopedProjectRef
  | { readonly repos: ReadonlyArray<string> }
  | { readonly create: AldoNewProject }
  | null;

/**
 * Where a draft moving to another place before its first message goes (the
 * place picker, T3's project picker on a draft): to `target` (null: General)
 * on a machine of its own, an idle one or a new one, never another thread's.
 * Resolves with the project for the draft to take, or null when another move
 * was asked for meanwhile, the draft was sent (it stays where it went), or
 * the machine couldn't be had (which it shows).
 */
export async function aldoProjectForMovedDraft(
  draftId: DraftId,
  target: AldoDraftTarget,
): Promise<EnvironmentProject | null> {
  const move = ++moves;
  latestMoves.set(draftId, move);
  const project = await movedDraftProject(target);
  const latest = latestMoves.get(draftId) === move;
  if (latest) latestMoves.delete(draftId);
  const draft = useComposerDraftStore.getState().getDraftSession(draftId);
  return latest && project !== null && draft !== null && draft.promotedTo == null ? project : null;
}

async function movedDraftProject(target: AldoDraftTarget): Promise<EnvironmentProject | null> {
  // When there's no machine to be had, startAldoSandbox says why.
  const projectRef = await (
    target === null
      ? startAldoSandbox({ repos: [] })
      : "repos" in target
        ? startAldoSandbox({ repos: target.repos })
        : "create" in target
          ? startAldoSandbox({ create: target.create })
          : aldoProjectRefForNewThread(target)
  ).catch(() => null);
  if (projectRef === null) return null;
  return waitForProject(projectRef).catch((cause: unknown) => {
    toastManager.add({
      type: "error",
      title: "Couldn't move the draft",
      description: cause instanceof Error ? cause.message : String(cause),
    });
    return null;
  });
}

/**
 * Whether a thread can start without a project, in General: never outside
 * Aldo, nor on an older Aldo (its directory says, once listed).
 */
export function useAldoGeneralThreads(): boolean {
  return useSyncExternalStore(
    subscribeAldoEnvironments,
    () => isAldoCloud && aldoSupportsGeneralThreads(),
    () => false,
  );
}

/**
 * T3's "without a project" in Aldo: a General draft at once, on a computer of
 * its own, as New opens (T3's scratch project would go on the machine of the
 * thread on screen). Null where there's none (useAldoGeneralThreads).
 */
export function useAldoStartWithoutProject(): (() => Promise<void>) | null {
  const { start } = useStartAldoThread();
  const general = useAldoGeneralThreads();
  return useMemo(
    () =>
      general
        ? async () => {
            await start([]);
          }
        : null,
    [general, start],
  );
}
