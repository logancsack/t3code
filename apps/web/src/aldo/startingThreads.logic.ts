// A new thread as T3's shell will have it once its first message reaches the
// machine, for the sidebar to show before then (see startingThreads.ts).
// Pure, so it's tested on its own.

/** What T3 creates the thread from: its first message's bootstrap (createThread). */
export interface AldoNewThread {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly modelSelection: { readonly instanceId: string };
  readonly runtimeMode: string;
  readonly interactionMode: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly createdAt: string;
  /** When its first message was sent. */
  readonly sentAt: string;
}

/** A cached shell (encoded), as far as adding and removing threads goes. */
export interface AldoStartingShell {
  readonly projects: ReadonlyArray<{ readonly id: string }>;
  readonly threads: ReadonlyArray<{ readonly id: string }>;
}

/** The thread's shell entry: connecting, its message sent, as Aldo's own starts show (src/lib/threads.ts). */
export function aldoStartingShellThread(thread: AldoNewThread) {
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    latestTurn: null,
    createdAt: thread.createdAt,
    updatedAt: thread.sentAt,
    archivedAt: null,
    session: {
      threadId: thread.id,
      status: "starting",
      providerName: null,
      providerInstanceId: thread.modelSelection.instanceId,
      runtimeMode: thread.runtimeMode,
      activeTurnId: null,
      lastError: null,
      updatedAt: thread.sentAt,
    },
    latestUserMessageAt: thread.sentAt,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

/**
 * `shell` with the new thread, or null when there's nothing to add: it has
 * the thread already, or not its project (the sidebar shows a thread under
 * its project).
 */
export function withAldoStartingThread<S extends AldoStartingShell>(
  shell: S,
  thread: AldoNewThread,
): S | null {
  if (shell.threads.some((entry) => entry.id === thread.id)) return null;
  if (!shell.projects.some((project) => project.id === thread.projectId)) return null;
  return { ...shell, threads: [...shell.threads, aldoStartingShellThread(thread)] };
}

/** `shell` without these threads, or null when it has none of them. */
export function withoutAldoThreads<S extends AldoStartingShell>(
  shell: S,
  threadIds: ReadonlySet<string> | "all",
): S | null {
  const threads = shell.threads.filter((entry) => threadIds !== "all" && !threadIds.has(entry.id));
  return threads.length === shell.threads.length ? null : { ...shell, threads };
}
