import { describe, expect, it } from "vite-plus/test";

import {
  aldoAccountState,
  aldoClosesLine,
  aldoDefaultChoice,
  aldoDeparturesCopying,
  aldoDepartureWhen,
  aldoDepartureWork,
  aldoHandoverActions,
  aldoHandoverCode,
  aldoHandoverFilesMore,
  aldoHandoverLineText,
  aldoLeaveLine,
  aldoManagedLeaveLine,
  aldoReceivedLine,
  aldoRemoveAction,
  aldoRemoveBody,
  aldoRemovedNote,
  aldoRemoveSummary,
  aldoWorkHelp,
  parseAldoDepartures,
  parseAldoHandoverLine,
  parseAldoHandoverView,
  parseAldoLeaving,
  parseAldoReceived,
  type AldoDeparture,
  type AldoHandoverLine,
  type AldoLeaving,
} from "./offboarding.logic";
import type { AldoOrg } from "./organization.logic";

const org = (plan = false): AldoOrg => ({
  id: "o1",
  name: "Linden Partners",
  seats: 5,
  used: 3,
  you: "maya",
  role: "owner",
  members: [
    { id: "maya", email: "maya@linden.com", role: "owner", joinedAt: "2026-10-01T00:00:00.000Z" },
    { id: "jo", email: "jo@linden.com", role: "member", joinedAt: "2026-10-01T00:00:00.000Z" },
  ],
  invites: [],
  plan: plan
    ? {
        id: "plus",
        name: "Plus",
        credits: 2000,
        renewsAt: "2026-11-01T00:00:00.000Z",
        spendLimitCents: 0,
      }
    : null,
});

const leaving = (over: Partial<AldoLeaving> = {}): AldoLeaving => ({
  threads: 3,
  running: 1,
  routines: 2,
  shares: 4,
  managed: false,
  closesOn: null,
  colleagues: [
    { id: "maya", email: "maya@linden.com" },
    { id: "jo", email: "jo@linden.com" },
  ],
  choose: true,
  ...over,
});

const handover = (over: Partial<AldoHandoverLine> = {}): AldoHandoverLine => ({
  id: "h1",
  title: "Forecast",
  state: "copied",
  error: null,
  to: { id: "jo", email: "jo@linden.com" },
  copiedAt: "2026-10-26T12:00:00.000Z",
  expiresAt: null,
  bytes: 3 * 1024 * 1024,
  files: 12,
  conversations: 1,
  continued: false,
  ...over,
});

const departure = (over: Partial<AldoDeparture> = {}): AldoDeparture => ({
  id: "d1",
  userId: "pia",
  email: "pia@linden.com",
  by: "maya@linden.com",
  at: "2026-10-26T12:00:00.000Z",
  work: "hand",
  to: "jo@linden.com",
  keepLinks: true,
  managed: false,
  closesAt: null,
  closed: false,
  restoredAt: null,
  deletedAt: null,
  handovers: [handover()],
  ...over,
});

describe("reading Aldo's answers", () => {
  it("reads what leaving would do, and an older Aldo's member page as none", () => {
    const body = {
      leaving: {
        threads: 3,
        running: 1,
        routines: 2,
        shares: 4,
        managed: true,
        closesOn: "2026-11-25T12:00:00.000Z",
        colleagues: [{ id: "maya", email: "maya@linden.com" }, { id: 7 }],
        choose: true,
      },
    };
    expect(parseAldoLeaving(body)).toEqual({
      ...body.leaving,
      colleagues: [{ id: "maya", email: "maya@linden.com" }],
    });
    expect(parseAldoLeaving({ member: { id: "pia" } })).toBeNull();
    expect(parseAldoLeaving(null)).toBeNull();
  });

  it("reads former members, dropping what isn't one", () => {
    const parsed = parseAldoDepartures({
      departures: [
        { ...departure(), handovers: [handover(), { id: "x", state: "lost" }] },
        { id: "d2", email: "x@linden.com" },
      ],
    });
    expect(parsed).toEqual([departure()]);
    expect(parseAldoDepartures({ error: "Not found" })).toBeNull();
    expect(parseAldoHandoverLine({ handover: handover() })).toEqual(handover());
    expect(parseAldoHandoverLine({ handover: null })).toBeNull();
  });

  it("reads the copies handed to the user", () => {
    const received = {
      id: "h1",
      title: "Forecast",
      from: "pia@linden.com",
      state: "copied",
      at: "2026-10-26T12:00:00.000Z",
      copiedAt: "2026-10-26T12:05:00.000Z",
      bytes: 2048,
      files: 2,
      conversations: 1,
      continued: { environmentId: "aldo-t1", threadId: "x1" },
      seen: false,
    };
    expect(parseAldoReceived({ handovers: [received, { ...received, state: "failed" }] })).toEqual([
      received,
    ]);
    expect(
      parseAldoReceived({ handovers: [{ ...received, continued: null }] })?.[0]?.continued,
    ).toBeNull();
    expect(parseAldoReceived({})).toBeNull();
  });

  it("reads a copy to read, each message and routine told apart by its place", () => {
    const view = parseAldoHandoverView({
      handover: {
        id: "h1",
        title: "Forecast",
        from: "pia@linden.com",
        org: "Linden Partners",
        copiedAt: "2026-10-26T12:05:00.000Z",
        repos: ["linden/models"],
        branch: "aldo/abc",
        conversations: [
          {
            id: "c1",
            title: "Forecast",
            archived: false,
            messages: [
              { role: "user", text: "Model Q4", createdAt: "2026-10-20T10:00:00.000Z" },
              {
                role: "assistant",
                text: "Done.",
                createdAt: "2026-10-20T10:01:00.000Z",
                attachments: ["a.csv", 3],
              },
              { role: "user" },
            ],
            plans: [],
          },
        ],
        files: [{ name: "general/q4.xlsx", bytes: 2048 }, { bytes: 1 }],
        fileCount: 40,
        bytes: 4096,
        left: [{ name: "general/.env", why: "it’s hidden" }],
        more: 0,
        routines: [{ title: "Daily refresh", instruction: "Refresh it", schedule: "0 9 * * *" }],
        continued: null,
      },
    });
    expect(view?.conversations[0]?.messages.map((m) => [m.key, m.role, m.attachments])).toEqual([
      ["c1:0", "user", []],
      ["c1:1", "assistant", ["a.csv"]],
    ]);
    expect(view?.files).toEqual([{ name: "general/q4.xlsx", bytes: 2048 }]);
    expect(view?.routines).toEqual([
      { key: "routine:0", title: "Daily refresh", instruction: "Refresh it" },
    ]);
    expect(parseAldoHandoverView({ handover: { id: "h1" } })).toBeNull();
  });
});

describe("removing someone", () => {
  it("says what happens to their threads and account", () => {
    expect(aldoRemoveSummary(org(), leaving())).toBe(
      "Their 3 threads in Linden Partners leave their account now, and their computers stop. Their 2 routines stop too. Everything else stays theirs: their own threads, computers and vault.",
    );
    expect(aldoRemoveSummary(org(true), leaving({ threads: 1, routines: 1 }))).toBe(
      "Their 1 thread in Linden Partners leaves their account now, and their computers stop. Their routine stops too. Everything else stays theirs: their own threads, computers and vault, though their seat on its plan ends.",
    );
    // A managed account closes, so nothing else of it stays theirs to mention.
    expect(aldoRemoveSummary(org(), leaving({ threads: 0, routines: 0, managed: true }))).toBe(
      "They have no threads in Linden Partners.",
    );
    expect(
      aldoClosesLine(org(), leaving({ managed: true, closesOn: "2026-11-25T12:00:00.000Z" })),
    ).toBe(
      "Linden Partners manages their address, so removing them closes their account: they can’t sign in, and it’s deleted on Nov 25. Until then, an admin can restore it under Former members.",
    );
  });

  it("starts from handing them to the user, and sends a choice only when there are threads", () => {
    const choice = aldoDefaultChoice(leaving());
    expect(choice).toEqual({ work: "hand", to: "maya", keepLinks: true });
    expect(aldoDefaultChoice(leaving({ colleagues: [] }))).toEqual({
      work: "keep",
      to: null,
      keepLinks: true,
    });
    expect(aldoRemoveBody(leaving(), choice)).toEqual(choice);
    // Not handing: no one to hand to.
    expect(aldoRemoveBody(leaving(), { work: "keep", to: "maya", keepLinks: false })).toEqual({
      work: "keep",
      to: null,
      keepLinks: false,
    });
    expect(aldoRemoveBody(leaving({ threads: 0 }), choice)).toBeUndefined();
    expect(aldoRemoveBody(null, choice)).toBeUndefined();
    expect(aldoRemoveAction(leaving(), { ...choice, work: "delete" })).toBe("Remove and delete");
    expect(aldoRemoveAction(leaving({ threads: 0 }), { ...choice, work: "delete" })).toBe("Remove");
  });

  it("says what each choice does, and what happened after", () => {
    expect(aldoWorkHelp("keep", 1)).toBe(
      "An admin can hand it on from Former members. After 30 days, it’s deleted.",
    );
    expect(aldoWorkHelp("hand", 3)).toContain("Values from their vault are taken out.");
    expect(aldoRemovedNote(leaving(), aldoDefaultChoice(leaving()), "maya")).toBe(
      "Copying their threads for you. You’ll hear when they’re ready.",
    );
    expect(aldoRemovedNote(leaving(), { work: "hand", to: "jo", keepLinks: true }, "maya")).toBe(
      "Copying their threads for jo@linden.com. You’ll hear when they’re ready.",
    );
    expect(
      aldoRemovedNote(
        leaving({ managed: true }),
        { work: "delete", to: null, keepLinks: true },
        "maya",
      ),
    ).toBe("Their threads are being deleted. Their account is closed.");
    expect(
      aldoRemovedNote(leaving({ threads: 0 }), aldoDefaultChoice(leaving()), "maya"),
    ).toBeUndefined();
  });
});

describe("leaving", () => {
  it("says the organization's threads stay with it, and as before from an older Aldo", () => {
    expect(aldoLeaveLine(org(), leaving({ choose: false }))).toBe(
      "Your 3 threads in Linden Partners stay with it: they leave your account now, and its admins can hand them to a colleague. Your other threads, computers and vault stay yours. To come back, you’ll need a new invite.",
    );
    expect(aldoLeaveLine(org(true), leaving({ threads: 1 }))).toBe(
      "Your 1 thread in Linden Partners stays with it: it leaves your account now, and its admins can hand it to a colleague. Your other threads, computers and vault stay yours, and your seat on its plan ends. To come back, you’ll need a new invite.",
    );
    expect(aldoLeaveLine(org(), null)).toBe(
      "Your threads, computers, vault and plan stay yours. To come back, you’ll need a new invite.",
    );
    expect(aldoManagedLeaveLine(org())).toBe(
      "Linden Partners manages your account, so an admin there removes you.",
    );
  });
});

describe("former members", () => {
  const now = Date.parse("2026-10-27T12:00:00.000Z");

  it("says who took them out, and where their threads went", () => {
    expect(aldoDepartureWhen(departure(), "maya@linden.com")).toBe("Removed by you · Oct 26");
    expect(aldoDepartureWhen(departure({ by: null }), "maya@linden.com")).toBe("Left Oct 26");
    expect(aldoDepartureWork(departure(), now)).toBe("1 thread handed to jo@linden.com");
    expect(
      aldoDepartureWork(
        departure({ handovers: [handover({ state: "copying" }), handover({ id: "h2" })] }),
        now,
      ),
    ).toBe("Copying 1 of 2 threads…");
    expect(aldoDepartureWork(departure({ handovers: [handover({ state: "failed" })] }), now)).toBe(
      "1 couldn’t be copied",
    );
    expect(
      aldoDepartureWork(
        departure({
          handovers: [
            handover({ to: null, expiresAt: "2026-11-25T12:00:00.000Z" }),
            handover({ id: "h2", to: null, expiresAt: "2026-11-20T12:00:00.000Z" }),
          ],
        }),
        now,
      ),
    ).toBe("2 threads kept until Nov 20");
    expect(aldoDepartureWork(departure({ handovers: [handover({ state: "deleted" })] }), now)).toBe(
      "1 thread deleted",
    );
    expect(aldoDepartureWork(departure({ handovers: [] }), now)).toBe("No threads");
  });

  it("says where a closed account stands", () => {
    expect(aldoAccountState(departure())).toBeNull();
    expect(
      aldoAccountState(
        departure({ managed: true, closed: true, closesAt: "2026-11-25T12:00:00.000Z" }),
      ),
    ).toEqual({
      badge: "Closed",
      line: "Their account is closed, so they can’t sign in. It’s deleted Nov 25.",
      restorable: true,
    });
    expect(aldoAccountState(departure({ managed: true }))?.badge).toBe("Closing");
    expect(
      aldoAccountState(
        departure({ managed: true, closed: true, restoredAt: "2026-10-28T00:00:00.000Z" }),
      )?.restorable,
    ).toBe(false);
    expect(
      aldoAccountState(
        departure({ managed: true, closed: true, deletedAt: "2026-11-25T12:00:00.000Z" }),
      ),
    ).toMatchObject({ badge: "Deleted", restorable: false });
  });

  it("says where each copy stands, and offers what an admin can do about it", () => {
    expect(aldoHandoverLineText(handover(), "maya")).toBe(
      "Handed to jo@linden.com · 12 files, 3 MB",
    );
    expect(
      aldoHandoverLineText(
        handover({ to: { id: "maya", email: "m" }, continued: true, files: 0 }),
        "maya",
      ),
    ).toBe("Handed to you · carried on");
    expect(
      aldoHandoverLineText(
        handover({ to: null, expiresAt: "2026-11-25T12:00:00.000Z", files: 0 }),
        "maya",
      ),
    ).toBe("Kept until Nov 25");
    expect(
      aldoHandoverLineText(handover({ state: "failed", error: "Its computer is gone." }), null),
    ).toBe("Couldn’t copy it: Its computer is gone.");
    // Handed to someone: theirs to delete, not the admin's.
    expect(
      aldoHandoverLineText(
        handover({ state: "deleted", to: null, error: "Its computer never started." }),
        null,
      ),
    ).toBe("Not copied: Its computer never started.");
    expect(aldoHandoverLineText(handover({ state: "deleted", to: null }), null)).toBe("Deleted");
    expect(aldoHandoverActions(handover(), "maya")).toEqual({
      open: false,
      retry: false,
      hand: false,
      delete: false,
    });
    expect(aldoHandoverActions(handover({ to: null }), "maya")).toEqual({
      open: false,
      retry: false,
      hand: true,
      delete: true,
    });
    expect(aldoHandoverActions(handover({ state: "failed" }), "maya")).toEqual({
      open: false,
      retry: true,
      hand: false,
      delete: false,
    });
    expect(aldoHandoverActions(handover({ state: "failed", to: null }), "maya")).toEqual({
      open: false,
      retry: true,
      hand: true,
      delete: true,
    });
    expect(aldoHandoverActions(handover({ state: "deleted", to: null }), "maya")).toEqual({
      open: false,
      retry: false,
      hand: false,
      delete: false,
    });
    // Handed to the admin: theirs to open and delete.
    expect(aldoHandoverActions(handover({ to: { id: "maya", email: "m" } }), "maya")).toEqual({
      open: true,
      retry: false,
      hand: false,
      delete: true,
    });
    expect(aldoDeparturesCopying([departure()])).toBe(false);
    expect(
      aldoDeparturesCopying([departure({ handovers: [handover({ state: "copying" })] })]),
    ).toBe(true);
  });
});

describe("handed to you", () => {
  it("says who it's from and what it holds", () => {
    const received = {
      id: "h1",
      title: "Forecast",
      from: "pia@linden.com",
      state: "copied" as const,
      at: "2026-10-26T12:00:00.000Z",
      copiedAt: "2026-10-26T12:05:00.000Z",
      bytes: 2048,
      files: 2,
      conversations: 1,
      continued: null,
      seen: true,
    };
    expect(aldoReceivedLine(received)).toBe("From pia@linden.com · Oct 26 · 2 files, 2 KB");
    expect(aldoReceivedLine({ ...received, state: "copying" })).toBe(
      "From pia@linden.com · being copied, ready in a few minutes",
    );
  });

  it("says where its code was, and what its list leaves out", () => {
    const view = parseAldoHandoverView({
      handover: {
        id: "h1",
        title: "Forecast",
        from: "pia@linden.com",
        org: "Linden Partners",
        copiedAt: null,
        repos: ["linden/models", "linden/web"],
        branch: "aldo/abc",
        conversations: [],
        files: [{ name: "a", bytes: 1 }],
        fileCount: 3,
        bytes: 3,
        left: [],
        more: 2,
        routines: [],
        continued: null,
      },
    })!;
    expect(aldoHandoverCode(view)).toBe(
      "Its code was on branch aldo/abc of linden/models and linden/web: what was pushed is there.",
    );
    expect(aldoHandoverFilesMore(view)).toBe(
      "and 2 more files, in the download; 2 files past the 10,000 a copy holds weren’t copied.",
    );
    expect(aldoHandoverCode({ ...view, repos: [] })).toBeNull();
  });
});
