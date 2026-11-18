import { describe, expect, it } from "vite-plus/test";

import {
  aldoActivityDays,
  aldoActivityNote,
  aldoActivitySentence,
  aldoCreditDay,
  aldoDollars,
  aldoExtraLine,
  aldoLimitChoices,
  aldoLimitLine,
  aldoMonthLabel,
  aldoOrgNoteFor,
  aldoRestLine,
  aldoPausedLine,
  aldoPersonalLine,
  aldoRunningDetail,
  aldoRunningFor,
  aldoRunningLine,
  aldoSeatCredits,
  aldoStopAllSentence,
  aldoStopSentence,
  aldoThreadLine,
  parseAldoActivity,
  parseAldoMemberPage,
  parseAldoOrgMachines,
  parseAldoOrgNotes,
  parseAldoOrgUsage,
  parseAldoThreadDays,
  type AldoActivityLine,
  type AldoMemberUsage,
  type AldoRunningThread,
} from "./orgAdmin.logic";
import { aldoSettingsNavActive, aldoSettingsPage, aldoSettingsParent } from "./settings.logic";

const NOW = Date.parse("2026-10-26T15:00:00.000Z");

const running = (over: Partial<AldoRunningThread> = {}): AldoRunningThread => ({
  id: "t_board",
  title: "Board deck",
  member: { id: "dana", email: "dana@linden.com" },
  machines: [
    { kind: "agent", since: "2026-10-26T14:20:00.000Z", perHour: 30 },
    { kind: "windows", since: "2026-10-26T14:48:00.000Z", perHour: 90 },
  ],
  perHour: 120,
  canStop: true,
  ...over,
});

const usage = (over: Partial<AldoMemberUsage> = {}): AldoMemberUsage => ({
  id: "dana",
  credits: 6840,
  seat: { included: 10500, extraCents: 0, limitCents: 2000, ownLimit: false },
  paused: null,
  running: 2,
  perHour: 120,
  ...over,
});

const line = (over: Partial<AldoActivityLine>): AldoActivityLine => ({
  id: "1",
  at: "2026-10-26T14:00:00.000Z",
  actor: { id: "sam", email: "sam@linden.com" },
  action: "stopped",
  target: { id: "dana", email: "dana@linden.com" },
  detail: {},
  outcome: null,
  ...over,
});

describe("reading Aldo's answers", () => {
  it("reads members' month, and anything else as none", () => {
    const body = {
      usage: {
        members: [
          {
            id: "dana",
            credits: 6840,
            seat: { included: 10500, extraCents: 0, limitCents: 2000, ownLimit: false },
            paused: null,
            running: 2,
            perHour: 120,
          },
          {
            id: "lee",
            credits: 12,
            seat: null,
            paused: { at: "2026-10-25T10:00:00.000Z", by: "sam@linden.com" },
            running: 0,
            perHour: 0,
          },
          { id: "broken" },
        ],
        running: { machines: 2, perHour: 120 },
        totals: { credits: 6852, included: null, extraCents: 0, limitsCents: 2000 },
        updatedAt: "2026-10-26T15:00:00.000Z",
      },
    };
    const parsed = parseAldoOrgUsage(body);
    expect(parsed?.members.map((m) => m.id)).toEqual(["dana", "lee"]);
    expect(parsed?.members[1]?.paused).toEqual({
      at: "2026-10-25T10:00:00.000Z",
      by: "sam@linden.com",
    });
    expect(parsed?.running).toEqual({ machines: 2, perHour: 120 });
    expect(parseAldoOrgUsage({})).toBeNull();
    expect(parseAldoOrgUsage({ usage: { members: [] } })).toBeNull();
    expect(parseAldoOrgUsage(null)).toBeNull();
  });

  it("reads a seat's unmetered credits as null, and a malformed seat as none", () => {
    const seat = (s: unknown) =>
      parseAldoOrgUsage({
        usage: {
          members: [{ id: "a", credits: 1, seat: s, running: 0, perHour: 0 }],
          running: { machines: 0, perHour: 0 },
        },
      })?.members[0]?.seat;
    expect(seat({ included: null, extraCents: 0, limitCents: 0, ownLimit: false })).toEqual({
      included: null,
      extraCents: 0,
      limitCents: 0,
      ownLimit: false,
    });
    expect(seat({ included: "lots", extraCents: 0, limitCents: 0, ownLimit: false })).toBeNull();
    expect(seat({ extraCents: 0, limitCents: 0 })).toBeNull();
  });

  it("reads running machines, dropping a thread that's half there", () => {
    const parsed = parseAldoOrgMachines({
      threads: [
        {
          id: "t1",
          title: "",
          member: { id: "dana", email: "dana@linden.com" },
          machines: [
            { kind: "gpu", since: null, perHour: 310 },
            { kind: "toaster", perHour: 1 },
          ],
          perHour: 310,
          canStop: true,
        },
        { id: "t2", title: "No member", perHour: 30 },
      ],
      updatedAt: "2026-10-26T15:00:00.000Z",
    });
    expect(parsed?.threads).toHaveLength(1);
    expect(parsed?.threads[0]?.machines).toEqual([{ kind: "gpu", since: null, perHour: 310 }]);
    expect(parseAldoOrgMachines({ machines: [] })).toBeNull();
  });

  it("reads a member's page whole, or not at all", () => {
    const page = {
      member: {
        member: {
          id: "dana",
          email: "dana@linden.com",
          role: "member",
          joinedAt: "2026-09-01T00:00:00.000Z",
        },
        month: { start: "2026-10-05T09:00:00.000Z", end: "2026-11-05T09:00:00.000Z" },
        usage: usage(),
        defaultLimitCents: 2000,
        running: [running()],
        threads: [
          {
            id: "t_board",
            title: "Board deck",
            more: 1,
            running: true,
            state: "working",
            lastActiveAt: "2026-10-26T14:59:00.000Z",
            credits: 900,
          },
        ],
        personal: { threads: 4, credits: 210 },
        other: 30,
        can: { stop: true, limit: true, pause: true },
      },
    };
    const parsed = parseAldoMemberPage(page);
    expect(parsed?.member.role).toBe("member");
    expect(parsed?.threads[0]?.state).toBe("working");
    expect(parsed?.can).toEqual({ stop: true, limit: true, pause: true });
    expect(parsed?.rest).toBeNull();
    expect(
      parseAldoMemberPage({ member: { ...page.member, rest: { threads: 216, credits: 340 } } })
        ?.rest,
    ).toEqual({ threads: 216, credits: 340 });
    expect(aldoRestLine("Linden Partners", { threads: 216, credits: 340 })).toBe(
      "And 216 more threads in Linden Partners",
    );
    expect(parseAldoMemberPage({ member: { ...page.member, personal: undefined } })).toBeNull();
    expect(
      parseAldoMemberPage({
        member: { ...page.member, member: { ...page.member.member, role: "boss" } },
      }),
    ).toBeNull();
  });

  it("reads a thread's days, Activity and notes", () => {
    expect(
      parseAldoThreadDays({
        thread: {
          id: "t",
          title: "T",
          credits: 5,
          days: [{ day: "2026-10-24", credits: 5 }, { day: 3 }],
        },
      })?.days,
    ).toEqual([{ day: "2026-10-24", credits: 5 }]);
    const activity = parseAldoActivity({
      lines: [
        {
          id: "9",
          at: "2026-10-26T14:00:00.000Z",
          actor: null,
          action: "plan_set",
          target: null,
          detail: { to: "plus" },
          outcome: null,
        },
        { id: "8", at: "2026-10-26T13:00:00.000Z", action: "" },
      ],
      more: true,
    });
    expect(activity?.lines.map((l) => [l.id, l.actor])).toEqual([["9", null]]);
    expect(activity?.more).toBe(true);
    expect(
      parseAldoOrgNotes({
        notes: {
          org: "Linden",
          paused: null,
          stops: [
            {
              environmentId: "aldo-t1",
              at: "2026-10-26T14:00:00.000Z",
              by: "sam@linden.com",
              note: null,
            },
          ],
        },
      })?.stops,
    ).toHaveLength(1);
    expect(parseAldoOrgNotes({ notes: {} })).toBeNull();
  });
});

describe("their words", () => {
  it("says what's running and for how long", () => {
    expect(aldoRunningLine({ machines: 0, perHour: 0 })).toBe("Nothing running now");
    expect(aldoRunningLine({ machines: 1, perHour: 30 })).toBe(
      "1 machine running · 30 credits an hour",
    );
    expect(aldoRunningLine({ machines: 5, perHour: 1550 })).toBe(
      "5 machines running · 1,550 credits an hour",
    );
    expect(aldoRunningFor("2026-10-26T14:59:40.000Z", NOW)).toBe("just started");
    expect(aldoRunningFor("2026-10-26T14:20:00.000Z", NOW)).toBe("40m");
    expect(aldoRunningFor("2026-10-26T13:00:00.000Z", NOW)).toBe("2h");
    expect(aldoRunningFor("2026-10-22T13:00:00.000Z", NOW)).toBe("4 days");
    expect(aldoRunningFor(null, NOW)).toBeNull();
    expect(aldoRunningDetail(running(), NOW)).toBe(
      "Agent’s computer + Windows computer · 40m · 120 an hour",
    );
  });

  it("counts a seat's month against what it includes", () => {
    expect(aldoSeatCredits(usage())).toBe("6,840 of 10,500");
    expect(
      aldoSeatCredits(
        usage({ seat: { included: null, extraCents: 0, limitCents: 0, ownLimit: false } }),
      ),
    ).toBe("6,840 · unmetered");
    expect(aldoSeatCredits(usage({ seat: null }))).toBe("6,840 credits");
    expect(aldoExtraLine({ included: 1, extraCents: 0, limitCents: 0, ownLimit: false })).toBe(
      "Off",
    );
    expect(
      aldoExtraLine({ included: 1, extraCents: 1240, limitCents: 2000, ownLimit: false }),
    ).toBe("$12.40 of $20");
    expect(aldoLimitLine({ included: 1, extraCents: 0, limitCents: 2000, ownLimit: false })).toBe(
      "$20 · default",
    );
    expect(aldoLimitLine({ included: 1, extraCents: 0, limitCents: 5000, ownLimit: true })).toBe(
      "$50",
    );
    expect(aldoLimitLine({ included: 1, extraCents: 0, limitCents: 0, ownLimit: false })).toBe(
      "Off · default",
    );
    expect(aldoDollars(100_000)).toBe("$1,000");
  });

  it("names the month a seat counts", () => {
    expect(
      aldoMonthLabel({ start: "2026-10-01T00:00:00.000Z", end: "2026-11-01T00:00:00.000Z" }),
    ).toBe("October");
    expect(
      aldoMonthLabel({ start: "2026-10-05T09:00:00.000Z", end: "2026-11-05T09:00:00.000Z" }),
    ).toMatch(/^Oct 5 – Nov 5$/);
    expect(aldoMonthLabel({ start: "nope", end: null })).toBe("This month");
  });

  it("offers the usual limits beside the organization's default, and keeps an own limit equal to it apart", () => {
    const inherits = { limitCents: 2000, ownLimit: false };
    expect(aldoLimitChoices(inherits, 2000)).toEqual({
      amounts: [0, 1000, 5000, 10000],
      chosen: "default",
    });
    expect(aldoLimitChoices({ limitCents: 5000, ownLimit: true }, 2000)).toEqual({
      amounts: [0, 1000, 5000, 10000],
      chosen: 5000,
    });
    // Their own $20 while the default is $20: it shows as theirs, so going back to the default changes something.
    expect(aldoLimitChoices({ limitCents: 2000, ownLimit: true }, 2000)).toEqual({
      amounts: [0, 1000, 2000, 5000, 10000],
      chosen: 2000,
    });
    expect(aldoLimitChoices({ limitCents: 3000, ownLimit: true }, 3000)).toEqual({
      amounts: [0, 1000, 2000, 3000, 5000, 10000],
      chosen: 3000,
    });
    expect(aldoLimitChoices({ limitCents: 4200, ownLimit: true }, 2000).chosen).toBe("custom");
    expect(aldoLimitChoices({ limitCents: 0, ownLimit: true }, null)).toEqual({
      amounts: [0, 1000, 2000, 5000, 10000],
      chosen: 0,
    });
    expect(aldoCreditDay("2026-10-24")).toBe("Oct 24");
  });

  it("describes a thread by its state and keeps personal titles private", () => {
    const thread = {
      id: "t",
      title: "T",
      more: 0,
      running: false,
      state: "done" as const,
      lastActiveAt: "2026-10-26T13:00:00.000Z",
      credits: 1,
    };
    expect(aldoThreadLine(thread, NOW)).toBe("Done · 2h ago");
    expect(aldoThreadLine({ ...thread, running: true, state: "working", more: 2 }, NOW)).toBe(
      "Working · Running · 3 conversations",
    );
    expect(aldoPersonalLine("Linden", { threads: 4, credits: 210 })).toBe(
      "Before Linden: 4 threads · titles private",
    );
    expect(aldoPersonalLine("Linden", { threads: 1, credits: 0 })).toBe(
      "Before Linden: 1 thread · titles private",
    );
  });

  it("says what stopping does before it's done", () => {
    expect(aldoStopSentence(running(), false)).toBe(
      "Its Agent’s computer and Windows computer go to sleep now, saving 120 credits an hour. Files and memory are kept. dana@linden.com opens the thread to carry on, and gets a note saying you stopped it.",
    );
    expect(
      aldoStopSentence(
        running({ machines: [{ kind: "gpu", since: null, perHour: 310 }], perHour: 310 }),
        true,
      ),
    ).toBe(
      "Its GPU computer goes to sleep now, saving 310 credits an hour. Files and memory are kept. Open the thread to carry on.",
    );
    expect(aldoStopAllSentence([running(), running({ id: "t2", canStop: false })])).toMatch(
      /^Every machine in 1 thread goes to sleep now, saving 120 credits an hour\..* 1 thread of an owner’s keeps running; only owners stop those\.$/,
    );
  });

  it("writes Activity from the reader's side", () => {
    expect(aldoActivitySentence(line({ detail: { title: "Board deck" } }), "dana")).toBe(
      "sam@linden.com stopped “Board deck”, your thread",
    );
    expect(aldoActivitySentence(line({ detail: { title: "Board deck" } }), "sam")).toBe(
      "You stopped “Board deck”, dana@linden.com’s thread",
    );
    expect(aldoActivitySentence(line({ action: "paused" }), "sam")).toBe(
      "You paused dana@linden.com’s work",
    );
    expect(aldoActivitySentence(line({ action: "resumed" }), "dana")).toBe(
      "sam@linden.com resumed your work",
    );
    expect(
      aldoActivitySentence(line({ action: "limit_set", detail: { cents: 5000 } }), "dana"),
    ).toBe("sam@linden.com set your extra usage limit to $50");
    expect(
      aldoActivitySentence(
        line({ action: "limit_set", detail: { cents: 2000, default: true } }),
        "sam",
      ),
    ).toBe("You set dana@linden.com’s extra usage limit back to the default, $20");
    expect(
      aldoActivitySentence(line({ action: "role_changed", detail: { to: "admin" } }), "x"),
    ).toBe("sam@linden.com made dana@linden.com an admin");
    expect(
      aldoActivitySentence(
        line({ action: "plan_set", actor: null, target: null, detail: { from: null, to: "plus" } }),
        "x",
      ),
    ).toBe("Aldo put the organization on Plus");
    expect(
      aldoActivitySentence(
        line({
          action: "left",
          actor: { id: "dana", email: "dana@linden.com" },
          target: { id: "dana", email: "dana@linden.com" },
        }),
        "dana",
      ),
    ).toBe("You left");
    expect(aldoActivitySentence(line({ action: "something_new" }), "x")).toBe(
      "sam@linden.com made a change",
    );
    // Offboarding: where the organization's threads went, a closed account, and kept copies.
    expect(
      aldoActivitySentence(
        line({ action: "removed", detail: { work: "hand", threads: 3, to: "jo@linden.com" } }),
        "x",
      ),
    ).toBe("sam@linden.com removed dana@linden.com, handing their 3 threads to jo@linden.com");
    expect(
      aldoActivitySentence(
        line({ action: "removed", detail: { work: "delete", threads: 1, managed: true } }),
        "dana",
      ),
    ).toBe("sam@linden.com removed you and closed your account, deleting your thread");
    expect(
      aldoActivitySentence(line({ action: "removed", detail: { work: "keep", threads: 0 } }), "x"),
    ).toBe("sam@linden.com removed dana@linden.com");
    expect(
      aldoActivitySentence(
        line({
          action: "left",
          actor: { id: "dana", email: "dana@linden.com" },
          target: { id: "dana", email: "dana@linden.com" },
          detail: { work: "keep", threads: 2 },
        }),
        "x",
      ),
    ).toBe("dana@linden.com left; their 2 threads are kept for 30 days");
    expect(
      aldoActivitySentence(
        line({
          action: "kept_handed",
          target: { id: "jo", email: "jo@linden.com" },
          detail: { title: "Forecast", from: "pia@linden.com" },
        }),
        "jo",
      ),
    ).toBe("sam@linden.com handed “Forecast”, pia@linden.com’s thread, to you");
    expect(
      aldoActivitySentence(
        line({
          action: "kept_deleted",
          target: { id: null, email: "pia@linden.com" },
          detail: { title: "Forecast" },
        }),
        "sam",
      ),
    ).toBe("You deleted the kept copy of “Forecast”, pia@linden.com’s thread");
    expect(
      aldoActivitySentence(
        line({
          action: "handover_retried",
          target: { id: null, email: "pia@linden.com" },
          detail: { title: "Forecast" },
        }),
        "x",
      ),
    ).toBe("sam@linden.com tried copying “Forecast” again, pia@linden.com’s thread");
    expect(
      aldoActivitySentence(
        line({ action: "account_restored", target: { id: "pia", email: "pia@linden.com" } }),
        "x",
      ),
    ).toBe("sam@linden.com restored pia@linden.com’s account");
    expect(
      aldoActivitySentence(
        line({
          action: "account_deleted",
          actor: null,
          target: { id: null, email: "pia@linden.com" },
        }),
        "x",
      ),
    ).toBe("pia@linden.com’s account was deleted, 30 days after it was closed");
    // Who can join: the domains, the invite link, requests, and invites nobody typed.
    const domain = { detail: { domain: "linden.co" }, target: null };
    expect(
      aldoActivitySentence(line({ action: "join_policy_set", detail: { to: "join" } }), "x"),
    ).toBe("sam@linden.com set who can join to Join right away");
    expect(aldoActivitySentence(line({ action: "domain_added", ...domain }), "sam")).toBe(
      "You added linden.co",
    );
    expect(
      aldoActivitySentence(line({ action: "domain_verified", ...domain, actor: null }), "x"),
    ).toBe("Aldo verified linden.co");
    expect(aldoActivitySentence(line({ action: "domain_lost", ...domain, actor: null }), "x")).toBe(
      "Aldo couldn’t find linden.co’s record, so joining by it is paused",
    );
    expect(
      aldoActivitySentence(
        line({ action: "link_on", target: null, detail: { days: 7, anyAddress: false } }),
        "x",
      ),
    ).toBe("sam@linden.com turned on the invite link, for 7 days");
    expect(
      aldoActivitySentence(
        line({ action: "link_on", target: null, detail: { days: 1, anyAddress: true } }),
        "x",
      ),
    ).toBe("sam@linden.com turned on the invite link, for 1 day, for any address");
    expect(
      aldoActivitySentence(
        line({ action: "link_changed", target: null, detail: { anyAddress: false } }),
        "x",
      ),
    ).toBe("sam@linden.com limited the invite link to your domains");
    expect(
      aldoActivitySentence(
        line({ action: "link_changed", target: null, detail: { days: 30 } }),
        "x",
      ),
    ).toBe("sam@linden.com set the invite link to work for 30 days");
    const asker = { actor: null, target: { id: null, email: "ira@linden.co" } };
    expect(
      aldoActivitySentence(line({ action: "requested", ...asker, detail: { via: "link" } }), "x"),
    ).toBe("ira@linden.co asked to join with the invite link");
    expect(
      aldoActivitySentence(
        line({ action: "requested", ...asker, detail: { via: "expired" } }),
        "x",
      ),
    ).toBe("ira@linden.co asked for a new invite");
    expect(
      aldoActivitySentence(line({ action: "request_approved", target: asker.target }), "sam"),
    ).toBe("You approved ira@linden.co’s request");
    expect(
      aldoActivitySentence(
        line({ action: "invited", ...asker, detail: { role: "member", via: "link" } }),
        "x",
      ),
    ).toBe("The invite link sent ira@linden.co an invite");
    expect(
      aldoActivitySentence(
        line({
          action: "invited",
          ...asker,
          detail: { role: "member", via: "domain", domain: "linden.co" },
        }),
        "x",
      ),
    ).toBe("ira@linden.co got an invite at once, from linden.co");
    expect(
      aldoActivitySentence(
        line({ action: "invited", target: asker.target, detail: { role: "admin" } }),
        "x",
      ),
    ).toBe("sam@linden.com invited ira@linden.co as an admin");
    expect(aldoActivityNote(line({ detail: { note: "Back Monday" } }))).toBe("“Back Monday”");
    expect(aldoActivityNote(line({ action: "paused", detail: { note: "x" } }))).toBeNull();
  });

  it("groups Activity under its days", () => {
    const now = new Date(2026, 9, 26, 15, 0);
    const at = (d: number, h: number) => new Date(2026, 9, d, h).toISOString();
    const days = aldoActivityDays(
      [
        line({ id: "3", at: at(26, 14) }),
        line({ id: "2", at: at(25, 9) }),
        line({ id: "1", at: at(20, 9) }),
      ],
      now,
    );
    expect(days.map((d) => [d.day, d.lines.map((l) => l.id)])).toEqual([
      ["Today", ["3"]],
      ["Yesterday", ["2"]],
      ["Oct 20", ["1"]],
    ]);
    const late = aldoActivityDays(
      [
        line({ id: "3", at: at(26, 14) }),
        line({ id: "2", at: at(25, 9) }),
        line({ id: "1", at: at(26, 9) }),
      ],
      now,
    );
    expect(late.map((d) => [d.day, d.lines.map((l) => l.id)])).toEqual([
      ["Today", ["3", "1"]],
      ["Yesterday", ["2"]],
    ]);
  });
});

describe("what a member sees in their threads", () => {
  const notes = {
    org: "Linden Partners",
    paused: null,
    stops: [
      {
        environmentId: "aldo-t_board",
        at: "2026-10-26T14:00:00.000Z",
        by: "sam@linden.com",
        note: "Back Monday",
        gpu: false,
      },
    ],
  };

  it("notes a stop in the thread it touched, and nowhere else", () => {
    const note = aldoOrgNoteFor(notes, "aldo-t_board", new Date(NOW));
    expect(note?.kind).toBe("stopped");
    expect(note?.text).toMatch(
      /^Stopped by sam@linden\.com, an admin of Linden Partners, at .+\. Your files are kept; send a message to carry on\.$/,
    );
    expect(note?.quote).toBe("“Back Monday”");
    expect(aldoOrgNoteFor(notes, "aldo-t_other", new Date(NOW))).toBeNull();
    expect(aldoOrgNoteFor(null, "aldo-t_board")).toBeNull();
  });

  it("doesn't promise a GPU computer's files", () => {
    const gpu = { ...notes, stops: [{ ...notes.stops[0]!, gpu: true }] };
    expect(aldoOrgNoteFor(gpu, "aldo-t_board", new Date(NOW))?.text).toMatch(
      /Your files are kept, but for the GPU computer’s, which went with it; send a message to carry on\.$/,
    );
  });

  it("notes a pause in every thread, before any stop", () => {
    const paused = { ...notes, paused: { at: "2026-10-24T14:00:00.000Z", by: "sam@linden.com" } };
    const note = aldoOrgNoteFor(paused, "aldo-t_other", new Date(NOW));
    expect(note?.kind).toBe("paused");
    expect(note?.text).toMatch(
      /^sam@linden\.com, an admin of Linden Partners, paused your work on Oct 24 at .+\. Nothing starts until an admin resumes it/,
    );
    expect(aldoPausedLine(paused.paused, false, new Date(NOW))).toMatch(
      /^sam@linden\.com paused their work on Oct 24 at .+\. Nothing of theirs starts until it’s resumed\.$/,
    );
  });
});

describe("member pages in Settings", () => {
  it("sit under Members, with their way back", () => {
    expect(aldoSettingsParent("/settings/members/user_01")).toEqual({
      to: "/settings/members",
      label: "Members",
    });
    expect(aldoSettingsParent("/settings/running/")).toEqual({
      to: "/settings/members",
      label: "Members",
    });
    expect(aldoSettingsParent("/settings/members")).toBeNull();
    expect(aldoSettingsParent("/settings/activity")).toBeNull();
    expect(aldoSettingsPage("/settings/members/user_01")?.title).toBe("Member");
    expect(aldoSettingsPage("/settings/running")?.title).toBe("Running now");
    const members = { to: "/settings/members", also: ["/settings/running"] };
    expect(aldoSettingsNavActive(members, "/settings/members/user_01")).toBe(true);
    expect(aldoSettingsNavActive(members, "/settings/running")).toBe(true);
    expect(aldoSettingsNavActive(members, "/settings/activity")).toBe(false);
  });
});
