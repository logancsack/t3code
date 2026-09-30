import { describe, expect, it } from "vite-plus/test";

import {
  aldoCommandPatch,
  applyAldoShellPatch,
  type AldoShellThread,
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

describe("aldoCommandPatch", () => {
  it("settles, unpinning and waking the thread as T3 does", () => {
    expect(aldoCommandPatch(command("thread.settle"), thread(), NOW)).toEqual({
      set: { settledOverride: "settled", settledAt: NOW, unsettledAt: null, updatedAt: NOW },
    });
    expect(
      aldoCommandPatch(
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
      aldoCommandPatch(
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
      aldoCommandPatch(command("thread.settle"), thread({ session: { status: "running" } }), NOW),
    ).toBeNull();
    expect(
      aldoCommandPatch(command("thread.settle"), thread({ hasPendingUserInput: true }), NOW),
    ).toBeNull();
  });

  it("unsettles, stamping its return to the active list once", () => {
    expect(aldoCommandPatch(command("thread.unsettle", { reason: "user" }), thread(), NOW)).toEqual(
      {
        set: { settledOverride: "active", settledAt: null, unsettledAt: NOW, updatedAt: NOW },
      },
    );
    expect(
      aldoCommandPatch(
        command("thread.unsettle", { reason: "user" }),
        thread({ settledOverride: "active", unsettledAt: BEFORE }),
        NOW,
      ),
    ).toEqual({
      set: { settledOverride: "active", settledAt: null, unsettledAt: BEFORE, updatedAt: BEFORE },
    });
  });

  it("archives and deletes by taking it out of the shell", () => {
    expect(aldoCommandPatch(command("thread.archive"), thread(), NOW)).toEqual({ remove: true });
    expect(aldoCommandPatch(command("thread.delete"), thread(), NOW)).toEqual({ remove: true });
    // An archived thread (not in the shell) can still be deleted.
    expect(aldoCommandPatch(command("thread.delete"), null, NOW)).toEqual({ remove: true });
    expect(aldoCommandPatch(command("thread.archive"), null, NOW)).toBeNull();
  });

  it("pins, promoting a settled or snoozed thread", () => {
    expect(
      aldoCommandPatch(
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
      aldoCommandPatch(
        command("thread.pin", { orderKey: "z" }),
        thread({ pinnedAt: BEFORE, pinOrderKey: "a" }),
        NOW,
      ),
    ).toEqual({ set: { pinnedAt: BEFORE, updatedAt: BEFORE } });
  });

  it("unpins, reorders and snoozes as T3 does", () => {
    expect(aldoCommandPatch(command("thread.unpin"), thread({ pinnedAt: BEFORE }), NOW)).toEqual({
      set: { pinnedAt: null, pinOrderKey: null, updatedAt: NOW },
    });
    expect(
      aldoCommandPatch(command("thread.pin.reorder", { orderKey: "b" }), thread(), NOW),
    ).toBeNull();
    expect(
      aldoCommandPatch(
        command("thread.pin.reorder", { orderKey: "b" }),
        thread({ pinnedAt: BEFORE, pinOrderKey: "a" }),
        NOW,
      ),
    ).toEqual({ set: { pinOrderKey: "b", updatedAt: NOW } });
    const until = "2026-10-01T09:00:00.000Z";
    expect(
      aldoCommandPatch(command("thread.snooze", { snoozedUntil: until }), thread(), NOW),
    ).toEqual({ set: { snoozedUntil: until, snoozedAt: NOW, updatedAt: NOW } });
    // A wake time that's passed is T3's to refuse.
    expect(
      aldoCommandPatch(command("thread.snooze", { snoozedUntil: BEFORE }), thread(), NOW),
    ).toBeNull();
    expect(
      aldoCommandPatch(
        command("thread.unsnooze", { reason: "user" }),
        thread({ snoozedUntil: until }),
        NOW,
      ),
    ).toEqual({ set: { snoozedUntil: null, snoozedAt: null, updatedAt: NOW } });
  });

  it("renames, but leaves any other meta update to the machine", () => {
    expect(
      aldoCommandPatch(command("thread.meta.update", { title: "New name" }), thread(), NOW),
    ).toEqual({ set: { title: "New name", updatedAt: NOW } });
    expect(
      aldoCommandPatch(
        command("thread.meta.update", { title: "New name" }),
        thread({ titleRegeneration: { requestId: "r", startedAt: BEFORE } }),
        NOW,
      ),
    ).toEqual({ set: { title: "New name", titleRegeneration: null, updatedAt: NOW } });
    expect(
      aldoCommandPatch(command("thread.meta.update", { regenerateTitle: true }), thread(), NOW),
    ).toBeNull();
    expect(
      aldoCommandPatch(command("thread.meta.update", { branch: "main" }), thread(), NOW),
    ).toBeNull();
  });

  it("has nothing to stop on a sleeping machine, and leaves the rest to it", () => {
    expect(aldoCommandPatch(command("thread.session.stop"), thread(), NOW)).toBe("nothing");
    expect(aldoCommandPatch(command("thread.turn.start"), thread(), NOW)).toBeNull();
    expect(aldoCommandPatch(command("thread.unarchive"), null, NOW)).toBeNull();
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
