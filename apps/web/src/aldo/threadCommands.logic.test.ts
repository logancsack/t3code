import { describe, expect, it } from "vite-plus/test";

import {
  aldoCommandPatch,
  applyAldoShellPatch,
  restoreAldoShellThread,
  type AldoShellThread,
  type AldoThreadCommand,
} from "./threadCommands.logic";

const NOW = "2026-09-30T21:00:00.000Z";
const BEFORE = "2026-09-29T10:00:00.000Z";
const thread = (overrides: Partial<AldoShellThread> = {}): AldoShellThread => ({
  id: "t1",
  updatedAt: BEFORE,
  settledOverride: null,
  settledAt: null,
  unsettledAt: null,
  snoozedUntil: null,
  snoozedAt: null,
  pinnedAt: null,
  pinOrderKey: null,
  session: { status: "ready" },
  ...overrides,
});
const command = (type: string, fields: Record<string, unknown> = {}) => ({
  type,
  commandId: "c1",
  threadId: "t1",
  ...fields,
});

/** On a machine the directory has asleep, unless said otherwise. */
const patchFor = (
  command: AldoThreadCommand,
  current: AldoShellThread | null,
  now = NOW,
  asleep = true,
) => aldoCommandPatch(command, current, now, asleep);

describe("aldoCommandPatch", () => {
  it("settles, unpinning and waking the thread as T3 does", () => {
    expect(patchFor(command("thread.settle"), thread(), NOW)).toEqual({
      set: { settledOverride: "settled", settledAt: NOW, unsettledAt: null, updatedAt: NOW },
    });
    expect(
      patchFor(
        command("thread.settle"),
        thread({ pinnedAt: BEFORE, pinOrderKey: "a", snoozedUntil: NOW, snoozedAt: BEFORE }),
        NOW,
      ),
    ).toEqual({
      set: {
        settledOverride: "settled",
        settledAt: NOW,
        unsettledAt: null,
        pinnedAt: null,
        pinOrderKey: null,
        snoozedUntil: null,
        snoozedAt: null,
        updatedAt: NOW,
      },
    });
  });

  it("keeps a settled thread's times when it's settled again", () => {
    expect(
      patchFor(
        command("thread.settle"),
        thread({ settledOverride: "settled", settledAt: BEFORE }),
        NOW,
      ),
    ).toEqual({
      set: { settledOverride: "settled", settledAt: BEFORE, unsettledAt: null, updatedAt: BEFORE },
    });
  });

  it("leaves a settle T3 would refuse to the machine", () => {
    expect(
      patchFor(command("thread.settle"), thread({ session: { status: "running" } }), NOW),
    ).toBeNull();
    expect(
      patchFor(command("thread.settle"), thread({ hasPendingUserInput: true }), NOW),
    ).toBeNull();
  });

  it("unsettles, stamping its return to the active list once", () => {
    expect(patchFor(command("thread.unsettle", { reason: "user" }), thread(), NOW)).toEqual({
      set: { settledOverride: "active", settledAt: null, unsettledAt: NOW, updatedAt: NOW },
    });
    expect(
      patchFor(
        command("thread.unsettle", { reason: "user" }),
        thread({ settledOverride: "active", unsettledAt: BEFORE }),
        NOW,
      ),
    ).toEqual({
      set: { settledOverride: "active", settledAt: null, unsettledAt: BEFORE, updatedAt: BEFORE },
    });
  });

  it("archives and deletes by taking it out of the shell", () => {
    expect(patchFor(command("thread.archive"), thread(), NOW)).toEqual({ remove: true });
    expect(patchFor(command("thread.delete"), thread(), NOW)).toEqual({ remove: true });
    // An archived thread (not in the shell) can still be deleted.
    expect(patchFor(command("thread.delete"), null, NOW)).toEqual({ remove: true });
    expect(patchFor(command("thread.archive"), null, NOW)).toBeNull();
  });

  it("pins, promoting a settled or snoozed thread", () => {
    expect(
      patchFor(
        command("thread.pin", { orderKey: "m" }),
        thread({ settledOverride: "settled", settledAt: BEFORE, snoozedUntil: NOW }),
        NOW,
      ),
    ).toEqual({
      set: {
        pinnedAt: NOW,
        pinOrderKey: "m",
        settledOverride: "active",
        settledAt: null,
        unsettledAt: NOW,
        snoozedUntil: null,
        snoozedAt: null,
        updatedAt: NOW,
      },
    });
    // Pinned already: its place stays.
    expect(
      patchFor(
        command("thread.pin", { orderKey: "z" }),
        thread({ pinnedAt: BEFORE, pinOrderKey: "a" }),
        NOW,
      ),
    ).toEqual({ set: { pinnedAt: BEFORE, updatedAt: BEFORE } });
  });

  it("unpins, reorders and snoozes as T3 does", () => {
    expect(patchFor(command("thread.unpin"), thread({ pinnedAt: BEFORE }), NOW)).toEqual({
      set: { pinnedAt: null, pinOrderKey: null, updatedAt: NOW },
    });
    expect(patchFor(command("thread.pin.reorder", { orderKey: "b" }), thread(), NOW)).toBeNull();
    expect(
      patchFor(
        command("thread.pin.reorder", { orderKey: "b" }),
        thread({ pinnedAt: BEFORE, pinOrderKey: "a" }),
        NOW,
      ),
    ).toEqual({ set: { pinOrderKey: "b", updatedAt: NOW } });
    const until = "2026-10-01T09:00:00.000Z";
    expect(patchFor(command("thread.snooze", { snoozedUntil: until }), thread(), NOW)).toEqual({
      set: { snoozedUntil: until, snoozedAt: NOW, updatedAt: NOW },
    });
    // A wake time that's passed is T3's to refuse.
    expect(patchFor(command("thread.snooze", { snoozedUntil: BEFORE }), thread(), NOW)).toBeNull();
    expect(
      patchFor(
        command("thread.unsnooze", { reason: "user" }),
        thread({ snoozedUntil: until }),
        NOW,
      ),
    ).toEqual({ set: { snoozedUntil: null, snoozedAt: null, updatedAt: NOW } });
  });

  it("renames, but leaves any other meta update to the machine", () => {
    expect(patchFor(command("thread.meta.update", { title: "New name" }), thread(), NOW)).toEqual({
      set: { title: "New name", updatedAt: NOW },
    });
    expect(
      patchFor(
        command("thread.meta.update", { title: "New name" }),
        thread({ titleRegeneration: { requestId: "r", startedAt: BEFORE } }),
        NOW,
      ),
    ).toEqual({ set: { title: "New name", titleRegeneration: null, updatedAt: NOW } });
    expect(
      patchFor(command("thread.meta.update", { regenerateTitle: true }), thread(), NOW),
    ).toBeNull();
    expect(patchFor(command("thread.meta.update", { branch: "main" }), thread(), NOW)).toBeNull();
  });

  it("has nothing to stop on a sleeping machine, and leaves the rest to it", () => {
    expect(patchFor(command("thread.session.stop"), thread(), NOW)).toBe("nothing");
    expect(patchFor(command("thread.turn.start"), thread(), NOW)).toBeNull();
    expect(patchFor(command("thread.unarchive"), null, NOW)).toBeNull();
  });
});

describe("aldoCommandPatch on work T3 won't park", () => {
  it("leaves settling or snoozing a message no turn has taken up yet to the machine", () => {
    const queued = thread({
      latestUserMessageAt: "2026-09-30T20:59:30.000Z",
      latestTurn: {
        requestedAt: BEFORE,
        startedAt: BEFORE,
        completedAt: BEFORE,
      },
    });
    expect(patchFor(command("thread.settle"), queued, NOW)).toBeNull();
    expect(
      patchFor(command("thread.snooze", { snoozedUntil: "2026-10-01T09:00:00.000Z" }), queued, NOW),
    ).toBeNull();
    // Taken up by a turn, or long ago: it settles.
    const taken = thread({
      latestUserMessageAt: "2026-09-30T20:59:30.000Z",
      latestTurn: {
        requestedAt: "2026-09-30T20:59:30.000Z",
        startedAt: "2026-09-30T20:59:31.000Z",
        completedAt: "2026-09-30T20:59:50.000Z",
      },
    });
    expect(patchFor(command("thread.settle"), taken, NOW)).not.toBeNull();
    expect(
      patchFor(
        command("thread.settle"),
        thread({ latestUserMessageAt: BEFORE, latestTurn: null }),
        NOW,
      ),
    ).not.toBeNull();
  });

  it("stops no session only on a machine known to be asleep", () => {
    expect(patchFor(command("thread.session.stop"), thread(), NOW, true)).toBe("nothing");
    expect(patchFor(command("thread.session.stop"), thread(), NOW, false)).toBeNull();
  });
});

describe("restoreAldoShellThread", () => {
  it("puts back one thread, keeping the others' changes", () => {
    const original = thread({ title: "old" } as Partial<AldoShellThread>);
    const changed = [
      thread({ id: "t0", pinnedAt: NOW }),
      { ...original, settledOverride: "settled" as const },
    ];
    expect(restoreAldoShellThread(changed, original, 1)).toEqual([changed[0], original]);
    // Removed (archived here): back where it was.
    expect(restoreAldoShellThread([changed[0]!], original, 0)).toEqual([original, changed[0]]);
  });
});

describe("applyAldoShellPatch", () => {
  it("changes or removes the one thread", () => {
    const threads = [thread(), thread({ id: "t2" })];
    expect(applyAldoShellPatch(threads, "t1", { remove: true }).map((t) => t.id)).toEqual(["t2"]);
    const renamed = applyAldoShellPatch(threads, "t2", { set: { pinnedAt: NOW } });
    expect(renamed[1]?.pinnedAt).toBe(NOW);
    expect(renamed[0]).toBe(threads[0]);
  });
});
