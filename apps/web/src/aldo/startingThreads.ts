// A new thread is in the sidebar from its first message, not once its cloud
// agent is up. T3 creates a thread when its first message reaches the machine
// (the message's bootstrap), and the machine is created or woken first
// (dispatch.ts), so for half a minute or more the thread showed only where it
// was sent. Sending it now also puts the thread in the machine's cached shell
// as T3 will have it, connecting (startingThreads.logic.ts); the machine's own
// shell replaces that copy once it connects, a moment before T3 creates the
// thread. Until then T3 may follow a thread the machine doesn't have, which
// pendingThreads.ts makes safe. If the message doesn't go, the thread leaves
// the sidebar and the draft it was sent from is a draft again. A machine that
// was never created has no threads, so a copy left by a page that closed
// before its machine was created is cleared on the next page load.

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";

import { useComposerDraftStore } from "../composerDraftStore";
import { readCachedShells, seedEnvironmentCache } from "../connection/storage";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readThreadShell } from "../state/entities";
import { environmentPresentations } from "../state/presentation";
import { environmentShell } from "../state/shell";
import { isAldoCloud, isAldoEnvironmentId, type AldoEnvironment } from "./cloud";
import { markAldoThreadPending, settleAldoThreadPending } from "./pendingThreads";
import {
  withAldoStartingThread,
  withoutAldoThreads,
  type AldoNewThread,
  type AldoStartingShell,
} from "./startingThreads.logic";

type CachedShell = AldoStartingShell & { readonly snapshotSequence: number };

/** The threads this tab shows on each machine it's bringing up for them. */
const shown = new Map<string, Set<string>>();
/** Machines never created whose cache this tab has checked for threads left behind. */
const leftoversChecked = new Set<string>();

function phaseOf(environmentId: string): string | undefined {
  return appAtomRegistry
    .get(environmentPresentations.presentationsAtom)
    .get(environmentId as EnvironmentId)?.connection.phase;
}

/** Connected, or about to be: its own shell is moments away. */
function isLive(environmentId: string): boolean {
  const phase = phaseOf(environmentId);
  return phase === "connected" || phase === "connecting" || phase === "reconnecting";
}

/** Connected: what's shown is T3's own shell, and so is its cache. */
function isConnected(environmentId: string): boolean {
  return phaseOf(environmentId) === "connected";
}

/** Whether this tab shows a thread on this machine that it hasn't connected to yet. */
export function aldoShowsStartingThread(environmentId: string): boolean {
  return shown.has(environmentId);
}

function forget(environmentId: string, threadId: string): boolean {
  const threads = shown.get(environmentId);
  if (!threads?.delete(threadId)) return false;
  if (threads.size === 0) shown.delete(environmentId);
  return true;
}

/** One change to a machine's cached shell at a time: each reads the one the last wrote. */
const locks = new Map<string, Promise<unknown>>();

function serially(environmentId: string, run: () => Promise<void>): Promise<void> {
  const next = (locks.get(environmentId) ?? Promise.resolve()).then(run, run);
  locks.set(
    environmentId,
    next.catch(() => undefined),
  );
  return next;
}

/**
 * Changes the machine's cached shell and shows it, unless the machine is
 * connected. (One still trying to connect, as when it never came online,
 * shows its cache.)
 */
async function change(
  environmentId: string,
  edit: (shell: CachedShell) => CachedShell | null,
): Promise<void> {
  if (isConnected(environmentId)) return;
  const cached = (await readCachedShells([environmentId as EnvironmentId])).get(
    environmentId as EnvironmentId,
  );
  const next = cached ? edit(cached.snapshot as CachedShell) : null;
  if (!next || isConnected(environmentId)) return;
  await seedEnvironmentCache({
    environmentId: environmentId as EnvironmentId,
    shell: next,
    serverConfig: null,
  });
  // Already registered: its shell reloads from the cache. (One registering later reads it then.)
  if (phaseOf(environmentId) !== undefined && !isConnected(environmentId)) {
    appAtomRegistry.refresh(environmentShell.stateAtom(environmentId as EnvironmentId));
  }
}

/**
 * The first message of a new thread is being sent to a machine that isn't
 * up: the thread shows in the sidebar now, until the machine shows its own.
 */
export function showAldoStartingThread(environmentId: string, thread: AldoNewThread): void {
  if (!isAldoCloud || !isAldoEnvironmentId(environmentId) || isLive(environmentId)) return;
  markAldoThreadPending(environmentId, thread.id);
  const threads = shown.get(environmentId) ?? new Set<string>();
  threads.add(thread.id);
  shown.set(environmentId, threads);
  void serially(environmentId, () =>
    change(environmentId, (shell) => withAldoStartingThread(shell, thread)),
  ).catch(() => undefined);
}

/** dispatch.ts: the client is connected to the machine, whose shell is the one shown now. */
export function aldoMachineConnected(environmentId: string): void {
  shown.delete(environmentId);
}

/**
 * dispatch.ts: this page stopped waiting for a machine Aldo is bringing up
 * for a message it holds. What's shown from here is Aldo's copy of the
 * machine's threads (shells.ts), which says where the message stands, not
 * this page's own copy, which would show it starting for good.
 */
export function releaseAldoStartingThreads(environmentId: string): void {
  shown.delete(environmentId);
}

/** Drafts T3 took for this thread when it showed are drafts again: there is no such thread. */
function releaseDrafts(ref: ScopedThreadRef): void {
  useComposerDraftStore.setState((state) => {
    let drafts: typeof state.draftThreadsByThreadKey | null = null;
    for (const [key, draft] of Object.entries(state.draftThreadsByThreadKey)) {
      const to = draft.promotedTo;
      if (to?.environmentId !== ref.environmentId || to.threadId !== ref.threadId) continue;
      drafts ??= { ...state.draftThreadsByThreadKey };
      drafts[key] = { ...draft, promotedTo: null };
    }
    return drafts ? { draftThreadsByThreadKey: drafts } : state;
  });
}

/** How long a thread taken out of the cache waits to leave what the page shows. */
const UNLISTED_WAIT_MS = 2_000;

/** Resolves once the page no longer lists the thread (or after a while). */
async function unlisted(ref: ScopedThreadRef): Promise<boolean> {
  const deadline = Date.now() + UNLISTED_WAIT_MS;
  while (readThreadShell(ref) !== null) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

/**
 * A new thread's first message didn't go: the thread leaves the sidebar, and
 * the draft it was sent from is a draft again, to send once more (unless T3
 * has the thread: then its turn is what failed, as in T3).
 */
export async function withdrawAldoStartingThread(
  environmentId: string,
  threadId: string,
): Promise<void> {
  if (!isAldoCloud || !isAldoEnvironmentId(environmentId)) return;
  settleAldoThreadPending(environmentId, threadId);
  const ref = scopeThreadRef(
    environmentId as EnvironmentId,
    threadId as ScopedThreadRef["threadId"],
  );
  if (forget(environmentId, threadId)) {
    await serially(environmentId, () =>
      change(environmentId, (shell) => withoutAldoThreads(shell, new Set([threadId]))),
    ).catch(() => undefined);
  }
  // Once the page no longer lists it, or T3 would take the draft for it again.
  if (await unlisted(ref)) releaseDrafts(ref);
}

/**
 * On every directory fetch: the threads cached for machines that were never
 * created, and that this tab isn't bringing up for a thread, were left by a
 * page that closed first, so they go. Each machine is checked once per tab.
 */
export async function clearLeftoverAldoThreads(
  environments: ReadonlyArray<AldoEnvironment>,
): Promise<void> {
  const ids = environments
    .filter(
      (environment) =>
        environment.state === "new" &&
        // Aldo's own starts show from Aldo's shell (an older Aldo says nothing).
        environment.shellSequence === null &&
        !leftoversChecked.has(environment.environmentId) &&
        !shown.has(environment.environmentId) &&
        !isLive(environment.environmentId),
    )
    .map((environment) => environment.environmentId);
  if (ids.length === 0) return;
  for (const environmentId of ids) leftoversChecked.add(environmentId);
  const cached = await readCachedShells(ids.map((environmentId) => environmentId as EnvironmentId));
  await Promise.all(
    [...cached]
      .filter(([, shell]) => shell.threadCount > 0)
      .map(([environmentId]) =>
        serially(environmentId, () =>
          shown.has(environmentId)
            ? Promise.resolve()
            : change(environmentId, (shell) => withoutAldoThreads(shell, "all")),
        ),
      ),
  );
}
