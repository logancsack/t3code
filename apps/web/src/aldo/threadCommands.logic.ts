// What a command changes in a thread's entry of T3's shell, for a machine
// that sleeps (see threadCommands.ts): the same change T3's decider and
// projector make (apps/server/src/orchestration), so the thread shows it at
// once and T3 lands on it when the machine next runs. Pure, so it's tested on
// its own.

/** A thread as the cached shell has it (encoded), as far as these commands go. */
export interface AldoShellThread {
  readonly id: string;
  readonly updatedAt: string;
  readonly settledOverride?: "settled" | "active" | null;
  readonly settledAt?: string | null;
  readonly unsettledAt?: string | null;
  readonly snoozedUntil?: string | null;
  readonly snoozedAt?: string | null;
  readonly pinnedAt?: string | null;
  readonly pinOrderKey?: string | null;
  readonly titleRegeneration?: unknown;
  readonly session?: { readonly status: string } | null;
  readonly hasPendingApprovals?: boolean;
  readonly hasPendingUserInput?: boolean;
  readonly latestUserMessageAt?: string | null;
  readonly latestTurn?: {
    readonly requestedAt: string;
    readonly startedAt: string | null;
    readonly completedAt: string | null;
  } | null;
}

/** As T3's threadHasQueuedTurnStart: how long a user message no turn has taken up yet counts as work. */
const QUEUED_TURN_START_GRACE_MS = 2 * 60 * 1_000;

/** A message the user sent lately that no turn has taken up yet: work T3 won't let be settled or snoozed away. */
function hasQueuedTurnStart(thread: AldoShellThread, now: string): boolean {
  const sentAt = thread.latestUserMessageAt ?? null;
  if (sentAt === null || thread.session?.status === "error") return false;
  const messageAt = Date.parse(sentAt);
  const age = Date.parse(now) - messageAt;
  if (Number.isNaN(age) || Math.abs(age) > QUEUED_TURN_START_GRACE_MS) return false;
  const turn = thread.latestTurn ?? null;
  if (turn === null) return true;
  return [turn.requestedAt, turn.startedAt, turn.completedAt].every(
    (value) => value == null || Date.parse(value) < messageAt,
  );
}

/** A client command, as far as these go. */
export interface AldoThreadCommand {
  readonly type: string;
  readonly threadId: string;
  readonly [field: string]: unknown;
}

/** The thread leaves the shell (archived, deleted), or these fields change. */
export type AldoShellPatch =
  | { readonly remove: true }
  | { readonly set: Readonly<Record<string, unknown>> };

/**
 * What `command` does to `thread` (null when it isn't in the shell) on a
 * machine this browser isn't connected to: a patch to keep for it, "nothing"
 * (a machine known to be asleep, `asleep`, runs no session to stop), or null
 * when only the machine can take it (the command isn't one of these, or T3
 * would refuse it, so it says why).
 */
export function aldoCommandPatch(
  command: AldoThreadCommand,
  thread: AldoShellThread | null,
  now: string,
  asleep: boolean,
): AldoShellPatch | "nothing" | null {
  if (command.type === "thread.session.stop") return asleep ? "nothing" : null;
  // Archived threads (not in the shell) can still be deleted.
  if (command.type === "thread.delete") return { remove: true };
  if (thread === null) return null;
  // Work T3 won't let be parked: a request waiting on the user, or a message no turn has taken up.
  const blocked =
    thread.hasPendingApprovals === true ||
    thread.hasPendingUserInput === true ||
    hasQueuedTurnStart(thread, now);
  const working = thread.session?.status === "starting" || thread.session?.status === "running";
  const unsnoozed = thread.snoozedUntil != null ? { snoozedUntil: null, snoozedAt: null } : {};

  switch (command.type) {
    case "thread.archive":
      return { remove: true };

    case "thread.settle": {
      if (working || blocked) return null;
      const already = thread.settledOverride === "settled" && thread.settledAt != null;
      return {
        set: {
          settledOverride: "settled",
          settledAt: already ? thread.settledAt : now,
          unsettledAt: null,
          // Settling unpins and wakes it, as T3 does.
          ...(thread.pinnedAt != null ? { pinnedAt: null, pinOrderKey: null } : {}),
          ...unsnoozed,
          updatedAt:
            already && thread.pinnedAt == null && thread.snoozedUntil == null
              ? thread.updatedAt
              : now,
        },
      };
    }

    case "thread.unsettle": {
      const already = thread.settledOverride === "active";
      const updatedAt = already ? thread.updatedAt : now;
      return {
        set: {
          settledOverride: "active",
          settledAt: null,
          unsettledAt: already ? (thread.unsettledAt ?? null) : updatedAt,
          updatedAt,
        },
      };
    }

    case "thread.snooze": {
      const until = typeof command.snoozedUntil === "string" ? command.snoozedUntil : "";
      if (blocked || !(Date.parse(until) > Date.parse(now))) return null;
      const same = thread.snoozedUntil === until && thread.snoozedAt != null;
      return {
        set: {
          snoozedUntil: until,
          snoozedAt: same ? thread.snoozedAt : now,
          updatedAt: same ? thread.updatedAt : now,
        },
      };
    }

    case "thread.unsnooze":
      return {
        set: {
          snoozedUntil: null,
          snoozedAt: null,
          updatedAt: thread.snoozedUntil == null ? thread.updatedAt : now,
        },
      };

    case "thread.pin": {
      const pinnedAt = thread.pinnedAt ?? null;
      const orderKey = typeof command.orderKey === "string" ? command.orderKey : undefined;
      // Pinning promotes it: a settled thread is unsettled, a snoozed one woken.
      const promoted = thread.settledOverride === "settled" || thread.snoozedUntil != null;
      return {
        set: {
          pinnedAt: pinnedAt ?? now,
          ...(pinnedAt === null && orderKey !== undefined ? { pinOrderKey: orderKey } : {}),
          ...(thread.settledOverride === "settled"
            ? { settledOverride: "active", settledAt: null, unsettledAt: now }
            : {}),
          ...unsnoozed,
          updatedAt: pinnedAt !== null && !promoted ? thread.updatedAt : now,
        },
      };
    }

    case "thread.unpin":
      return {
        set: {
          pinnedAt: null,
          pinOrderKey: null,
          updatedAt: thread.pinnedAt == null ? thread.updatedAt : now,
        },
      };

    case "thread.pin.reorder": {
      const orderKey = typeof command.orderKey === "string" ? command.orderKey : null;
      if (thread.pinnedAt == null || orderKey === null) return null;
      return {
        set: {
          pinOrderKey: orderKey,
          updatedAt: thread.pinOrderKey === orderKey ? thread.updatedAt : now,
        },
      };
    }

    case "thread.meta.update": {
      // A rename; anything else a meta update does needs the machine.
      const fields = Object.keys(command).filter(
        (key) => !["type", "commandId", "threadId", "createdAt"].includes(key),
      );
      if (fields.length !== 1 || fields[0] !== "title" || typeof command.title !== "string") {
        return null;
      }
      return {
        set: {
          title: command.title,
          ...(thread.titleRegeneration != null ? { titleRegeneration: null } : {}),
          updatedAt: now,
        },
      };
    }

    default:
      return null;
  }
}

/**
 * The shell's threads with one thread put back as it was (`original`, at
 * `index` if it had gone), after its command didn't go through; the others
 * keep any change made since.
 */
export function restoreAldoShellThread<T extends { readonly id: string }>(
  threads: ReadonlyArray<T>,
  original: T,
  index: number,
): T[] {
  if (threads.some((thread) => thread.id === original.id)) {
    return threads.map((thread) => (thread.id === original.id ? original : thread));
  }
  const at = Math.max(0, Math.min(index, threads.length));
  return [...threads.slice(0, at), original, ...threads.slice(at)];
}

/** The cached shell's threads with the patch applied. */
export function applyAldoShellPatch<T extends { readonly id: string }>(
  threads: ReadonlyArray<T>,
  threadId: string,
  patch: AldoShellPatch,
): T[] {
  return "remove" in patch
    ? threads.filter((thread) => thread.id !== threadId)
    : threads.map((thread) => (thread.id === threadId ? { ...thread, ...patch.set } : thread));
}
