import { describe, expect, it } from "vite-plus/test";

import { aldoActivitySentence, type AldoActivityLine, type AldoOrgUsage } from "./orgAdmin.logic";
import { parseAldoOrg, type AldoOrg, type AldoOrgInvite } from "./organization.logic";
import { aldoSettingsNavActive, aldoSettingsPage, aldoSettingsParent } from "./settings.logic";
import {
  aldoDeleteTeamLine,
  aldoInviteTeams,
  aldoPersonLine,
  aldoSameIds,
  aldoTeamCredits,
  aldoTeamLine,
  aldoTeamName,
  aldoTeamNameProblem,
  aldoTeamOverlaps,
  aldoTeamsOf,
  aldoTeamsShort,
} from "./teams.logic";

const at = "2026-10-26T12:00:00.000Z";
const member = (id: string) => ({
  id,
  email: `${id}@linden.com`,
  role: "member" as const,
  joinedAt: at,
});
const invite = (id: string, teams: string[], expired = false): AldoOrgInvite => ({
  id,
  email: `${id}@linden.com`,
  role: "member",
  expiresAt: at,
  sentAt: at,
  sentBy: null,
  via: null,
  expired,
  teams,
});

const org = (over: Partial<AldoOrg> = {}): AldoOrg => ({
  id: "o1",
  name: "Linden",
  seats: 10,
  used: 4,
  you: "maya",
  role: "owner",
  members: [{ ...member("maya"), role: "owner" }, member("raj"), member("ana")],
  teams: [
    { id: "t_fin", name: "Finance", members: ["maya", "raj"] },
    { id: "t_ops", name: "Ops", members: ["raj"] },
    { id: "t_new", name: "Research", members: [] },
  ],
  invites: [invite("lee", ["t_fin"]), invite("kim", ["t_fin", "t_gone"], true)],
  plan: null,
  ...over,
});

const usage = (credits: Record<string, number>): AldoOrgUsage =>
  ({
    members: Object.entries(credits).map(([id, c]) => ({ id, credits: c })),
  }) as unknown as AldoOrgUsage;

describe("teams", () => {
  it("reads an organization's teams, and none from an Aldo without them", () => {
    const answer = org();
    expect(parseAldoOrg(JSON.parse(JSON.stringify(answer)))).toEqual(answer);
    const older = parseAldoOrg({ ...answer, teams: undefined, invites: [{ ...invite("x", []) }] });
    expect(older?.teams).toBeNull();
    // An invite from an older Aldo names no teams.
    const { teams: _gone, ...bare } = invite("y", ["t_fin"]);
    expect(parseAldoOrg({ ...answer, invites: [bare] })?.invites?.[0]?.teams).toEqual([]);
    // A team that isn't one is dropped, not the organization.
    const odd = parseAldoOrg({ ...answer, teams: [{ id: "t", name: "T" }, { id: 3 }] });
    expect(odd?.teams).toEqual([]);
  });

  it("says who's on what", () => {
    const o = org();
    expect(aldoTeamsOf(o, "raj").map((t) => t.name)).toEqual(["Finance", "Ops"]);
    expect(aldoTeamsOf(o, "ana")).toEqual([]);
    expect(aldoTeamsOf({ ...o, teams: null }, "raj")).toEqual([]);
    // A team deleted since the invite was sent isn't named.
    expect(aldoInviteTeams(o, o.invites![1]!)).toEqual(["Finance"]);
  });

  it("puts teams on a person's line under Members", () => {
    expect(aldoPersonLine(false, [], "Oct 3")).toBe("Joined Oct 3");
    expect(aldoPersonLine(true, [], "Oct 3")).toBe("You · joined Oct 3");
    expect(aldoPersonLine(false, ["Finance"], "Oct 3")).toBe("Finance · joined Oct 3");
    expect(aldoPersonLine(true, ["Finance", "Ops", "Sales", "beta"], "Oct 3")).toBe(
      "You · Finance, Ops +2 · joined Oct 3",
    );
    expect(aldoTeamsShort(["a", "b"])).toBe("a, b");
  });

  it("adds up a team's credits, counting someone on two teams in both", () => {
    const o = org();
    const month = usage({ maya: 1000, raj: 250.4, ana: 9 });
    const [fin, ops, research] = o.teams!;
    expect(aldoTeamCredits(fin!, month)).toBeCloseTo(1250.4);
    expect(aldoTeamCredits(ops!, month)).toBeCloseTo(250.4);
    expect(aldoTeamCredits(fin!, null)).toBeNull();
    expect(aldoTeamLine(o, fin!, month)).toBe("2 people, 2 invited · 1,250 credits");
    expect(aldoTeamLine(o, ops!, month)).toBe("1 person · 250 credits");
    expect(aldoTeamLine(o, research!, month)).toBe("No one yet");
    // A member sees no credits and no invites.
    expect(aldoTeamLine({ ...o, invites: null }, fin!, null)).toBe("2 people");
    expect(aldoTeamOverlaps(o, fin!)).toBe(true);
    expect(aldoTeamOverlaps(o, research!)).toBe(false);
  });

  it("checks a name as Aldo would", () => {
    const o = org();
    expect(aldoTeamName("  Data   science ")).toBe("Data science");
    expect(aldoTeamNameProblem(o, "   ")).toBe("Give it a name.");
    expect(aldoTeamNameProblem(o, "x".repeat(41))).toBe("Keep it to 40 characters.");
    expect(aldoTeamNameProblem(o, "x".repeat(40))).toBeNull();
    expect(aldoTeamNameProblem(o, " finance ")).toBe("There’s a team called Finance already.");
    // Renaming a team to itself, in another case, is fine.
    expect(aldoTeamNameProblem(o, "FINANCE", "t_fin")).toBeNull();
    expect(aldoSameIds(["a", "b"], ["b", "a"])).toBe(true);
    expect(aldoSameIds(["a"], ["a", "b"])).toBe(false);
  });

  it("says what deleting a team does", () => {
    const o = org();
    expect(aldoDeleteTeamLine(o, o.teams![0]!)).toBe(
      "The 2 people on it stay in Linden, with their threads and usage. 2 open invites won’t put anyone on it. Its lines in Activity stay.",
    );
    expect(aldoDeleteTeamLine(o, o.teams![1]!)).toBe(
      "The person on it stays in Linden, with their threads and usage. Its lines in Activity stay.",
    );
    expect(aldoDeleteTeamLine(o, o.teams![2]!)).toBe(
      "No one is on it. Its lines in Activity stay.",
    );
  });

  it("puts team changes in Activity as sentences", () => {
    const line = (action: string, detail: Record<string, unknown>, target = "raj") =>
      aldoActivitySentence(
        {
          id: "e",
          at,
          actor: { id: "maya", email: "maya@linden.com" },
          action,
          target: target ? { id: target, email: `${target}@linden.com` } : null,
          detail,
          outcome: null,
        } satisfies AldoActivityLine,
        "maya",
      );
    expect(line("team_created", { team: "Finance" }, "")).toBe("You made the team Finance");
    expect(line("team_renamed", { from: "Fin", to: "Finance" }, "")).toBe(
      "You renamed the team Fin to Finance",
    );
    expect(line("team_deleted", { team: "Finance", people: 2 }, "")).toBe(
      "You deleted the team Finance",
    );
    expect(line("team_added", { team: "Finance" })).toBe("You put raj@linden.com on Finance");
    expect(line("team_added", { team: "Finance" }, "maya")).toBe("You put yourself on Finance");
    expect(line("team_removed", { team: "Ops" })).toBe("You took raj@linden.com off Ops");
    expect(line("invited", { role: "member", teams: ["Finance", "Ops"] }, "lee")).toBe(
      "You invited lee@linden.com as a member, for Finance and Ops",
    );
    expect(line("invited", { role: "admin" }, "lee")).toBe(
      "You invited lee@linden.com as an admin",
    );
    expect(line("invite_changed", { teams: ["Finance"] }, "lee")).toBe(
      "You set lee@linden.com’s invite to put them on Finance",
    );
    expect(line("invite_changed", { teams: [] }, "lee")).toBe(
      "You took the teams off lee@linden.com’s invite",
    );
  });

  it("puts a team's page under Members", () => {
    expect(aldoSettingsParent("/settings/teams/t_fin")).toEqual({
      to: "/settings/members",
      label: "Members",
    });
    expect(aldoSettingsPage("/settings/teams/t_fin/")?.title).toBe("Team");
    expect(
      aldoSettingsNavActive(
        { to: "/settings/members", also: ["/settings/running", "/settings/teams"] },
        "/settings/teams/t_fin",
      ),
    ).toBe(true);
  });
});
