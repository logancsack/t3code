import { describe, expect, it } from "vite-plus/test";

import {
  aldoOrgCanHandleInvite,
  aldoOrgCanManage,
  aldoOrgExpiresLine,
  aldoOrgFreeSeats,
  aldoOrgFull,
  aldoOrgFullLine,
  aldoOrgInitials,
  aldoOrgInviteLine,
  aldoOrgLastOwner,
  aldoOrgMembersSummary,
  aldoOrgOwnersLine,
  aldoOrgOwnPlace,
  aldoOrgRolesToGive,
  aldoOrgSeatsLine,
  aldoOrgYouLine,
  parseAldoOrg,
  type AldoOrg,
  type AldoOrgRole,
} from "./organization.logic";
import { ALDO_SETTINGS_NAV, aldoSettingsNav } from "./settings.logic";

const member = (id: string, role: AldoOrgRole) => ({
  id,
  email: `${id}@linden.com`,
  role,
  joinedAt: "2026-10-03T12:00:00.000Z",
});

const invite = (id: string, role: AldoOrgRole, expired = false) => ({
  id,
  email: `${id}@linden.com`,
  role,
  expiresAt: "2026-11-01T12:00:00.000Z",
  sentAt: "2026-10-25T12:00:00.000Z",
  sentBy: "maya@linden.com",
  expired,
});

function org(role: AldoOrgRole, others: AldoOrg["members"] = [], invites: AldoOrg["invites"] = []) {
  return {
    id: "o1",
    name: "Linden Partners",
    seats: 5,
    used: 1 + others.length + (invites?.filter((i) => !i.expired).length ?? 0),
    you: "me",
    role,
    members: [member("me", role), ...others],
    invites: role === "member" ? null : invites,
  } satisfies AldoOrg;
}

describe("organizations", () => {
  it("reads Aldo's answer, and nothing else as one", () => {
    const answer = org("admin", [member("maya", "owner")], [invite("sam", "member")]);
    expect(parseAldoOrg(JSON.parse(JSON.stringify(answer)))).toEqual(answer);
    // A member's answer has no invites; an invite Aldo sent itself has no sender.
    expect(parseAldoOrg({ ...org("member"), invites: null })?.invites).toBeNull();
    const fromAldo = parseAldoOrg({
      ...answer,
      invites: [{ ...invite("x", "owner"), sentBy: null }],
    });
    expect(fromAldo?.invites?.[0]?.sentBy).toBeNull();
    // An older Aldo's page, an error, a half answer: no organization.
    expect(parseAldoOrg("<!doctype html>")).toBeNull();
    expect(parseAldoOrg(null)).toBeNull();
    expect(parseAldoOrg({ error: "You're not in an organization." })).toBeNull();
    expect(parseAldoOrg({ ...answer, role: "boss" })).toBeNull();
    expect(parseAldoOrg({ ...answer, members: undefined })).toBeNull();
  });

  it("offers each role only what Aldo lets it do", () => {
    const people = [member("o", "owner"), member("a", "admin"), member("m", "member")];
    const can = (role: AldoOrgRole) => {
      const o = org(role, people);
      return people.filter((p) => aldoOrgCanManage(o, p)).map((p) => p.id);
    };
    expect(can("owner")).toEqual(["o", "a", "m"]);
    expect(can("admin")).toEqual(["a", "m"]);
    expect(can("member")).toEqual([]);
    // Never oneself: stepping down and leaving are their own.
    expect(aldoOrgCanManage(org("owner"), member("me", "owner"))).toBe(false);

    expect(aldoOrgRolesToGive(org("owner"))).toEqual(["member", "admin", "owner"]);
    expect(aldoOrgRolesToGive(org("admin"))).toEqual(["member", "admin"]);
    expect(aldoOrgRolesToGive(org("member"))).toEqual([]);

    expect(aldoOrgCanHandleInvite(org("admin"), invite("x", "owner"))).toBe(false);
    expect(aldoOrgCanHandleInvite(org("admin"), invite("x", "admin"))).toBe(true);
    expect(aldoOrgCanHandleInvite(org("owner"), invite("x", "owner"))).toBe(true);
  });

  it("keeps the last owner from stepping down or leaving, and lets one alone delete it", () => {
    expect(aldoOrgOwnPlace(org("owner"))).toEqual({
      delete: true,
      stepDownTo: null,
      leave: false,
      blocked: null,
    });
    const lastOwner = org("owner", [member("a", "admin")]);
    expect(aldoOrgOwnPlace(lastOwner)).toEqual({
      delete: false,
      stepDownTo: "admin",
      leave: true,
      blocked: aldoOrgLastOwner(lastOwner),
    });
    expect(aldoOrgLastOwner(lastOwner)).toBe(
      "You’re the only owner of Linden Partners, so you can’t step down, leave or be removed. Make another person an owner first.",
    );
    expect(aldoOrgOwnPlace(org("owner", [member("o", "owner")])).blocked).toBeNull();
    expect(aldoOrgOwnPlace(org("admin", [member("o", "owner")]))).toEqual({
      delete: false,
      stepDownTo: "member",
      leave: true,
      blocked: null,
    });
    expect(aldoOrgOwnPlace(org("member", [member("o", "owner")])).stepDownTo).toBeNull();
  });

  it("counts seats, members and invites", () => {
    expect(aldoOrgSeatsLine(org("owner"))).toBe("1 of 5 used");
    const two = org(
      "owner",
      [member("a", "admin")],
      [invite("b", "member"), invite("c", "member", true)],
    );
    expect(aldoOrgSeatsLine(two)).toBe("3 of 5 used");
    expect(aldoOrgFreeSeats(two)).toBe(2);
    // An expired invite holds no seat, and isn't counted as invited.
    expect(aldoOrgMembersSummary(two)).toBe("2 · 1 invited");
    expect(aldoOrgMembersSummary(org("member", [member("o", "owner")]))).toBe("2");
    const full = { ...org("owner", [], [invite("a", "member"), invite("b", "admin")]), seats: 3 };
    expect(aldoOrgFull(full)).toBe(true);
    expect(aldoOrgFreeSeats(full)).toBe(0);
    expect(aldoOrgFullLine(full)).toBe(
      "All 3 seats are in use. Revoke an invite or ask Aldo for more seats.",
    );
  });

  it("names people and the organization in a line", () => {
    expect(aldoOrgInitials("maya.okafor@linden.com")).toBe("MO");
    expect(aldoOrgInitials("sam@linden.com")).toBe("S");
    expect(aldoOrgInitials("Linden Partners")).toBe("LP");
    expect(aldoOrgYouLine(org("owner"))).toBe("You’re an owner");
    expect(aldoOrgYouLine(org("member", [member("o", "owner")]))).toBe("You’re a member");
    expect(aldoOrgOwnersLine(org("owner"))).toBe("You");
    expect(aldoOrgOwnersLine(org("owner", [member("o", "owner"), member("p", "owner")]))).toBe(
      "You and 2 more",
    );
    expect(aldoOrgOwnersLine(org("admin", [member("o", "owner")]))).toBe("o@linden.com");
    expect(aldoOrgOwnersLine(org("member", [member("o", "owner"), member("p", "owner")]))).toBe(
      "2 owners",
    );
  });

  it("says when an invite was sent and expires, or that it expired", () => {
    expect(aldoOrgInviteLine(invite("a", "member"))).toBe("Member · sent Oct 25 · expires Nov 1");
    expect(aldoOrgInviteLine(invite("a", "admin", true))).toBe(
      "Admin · expired Nov 1 · holds no seat",
    );
    const now = Date.parse("2026-10-27T12:00:00.000Z");
    expect(aldoOrgExpiresLine(invite("a", "member"), now)).toBe("Nov 1, in 5 days");
    expect(aldoOrgExpiresLine(invite("a", "member"), Date.parse("2026-11-01T01:00:00.000Z"))).toBe(
      "Nov 1, within a day",
    );
    expect(aldoOrgExpiresLine(invite("a", "member", true), now)).toBe("Expired Nov 1");
  });

  it("puts a group for the organization in the settings nav only for someone in one", () => {
    expect(aldoSettingsNav({ developer: true, organization: null })).toBe(ALDO_SETTINGS_NAV);
    const nav = aldoSettingsNav({ developer: true, organization: "Linden Partners" });
    expect(nav[0]).toEqual({
      group: "Linden Partners",
      items: [
        { to: "/settings/organization", label: "Organization" },
        { to: "/settings/members", label: "Members" },
      ],
    });
    expect(nav.slice(1)).toEqual(ALDO_SETTINGS_NAV);
    expect(
      aldoSettingsNav({ developer: false }).flatMap((group) => group.items.map((i) => i.to)),
    ).not.toContain("/settings/organization");
  });
});
