import { describe, expect, it } from "vite-plus/test";

import {
  aldoApproveBlocked,
  aldoDomainLine,
  aldoDomainStatus,
  aldoDomainSteps,
  aldoFoundLine,
  aldoJoiningSummary,
  aldoLinkExpires,
  aldoLinkFor,
  aldoLinkSummary,
  aldoLinkUsed,
  aldoRecordHost,
  aldoRequestLine,
  aldoVerifiedDomains,
  parseAldoDomainCheck,
  parseAldoJoining,
  type AldoJoining,
  type AldoOrgDomain,
} from "./orgJoining.logic";

const now = Date.parse("2026-10-26T15:00:00.000Z");

const domain = (over: Partial<AldoOrgDomain> = {}): AldoOrgDomain => ({
  id: "d1",
  domain: "linden.co",
  state: "verified",
  record: { name: "_aldo-verify", value: "aldo-verify=abc123" },
  addedAt: "2026-10-03T12:00:00.000Z",
  checkedAt: "2026-10-24T12:00:00.000Z",
  verifiedAt: "2026-10-03T12:30:00.000Z",
  lostAt: null,
  checkingUntil: null,
  taken: false,
  members: 3,
  ...over,
});

const joining = (over: Partial<AldoJoining> = {}): AldoJoining => ({
  policy: "ask",
  domains: [domain()],
  link: {
    url: "https://aldo.computer/j/tok",
    expiresAt: "2026-11-01T12:00:00.000Z",
    anyAddress: false,
    createdAt: "2026-10-25T12:00:00.000Z",
    used: 2,
  },
  requests: [
    {
      id: "r1",
      email: "ira@linden.co",
      note: "On Dana's team",
      via: "domain",
      createdAt: "2026-10-26T13:00:00.000Z",
    },
  ],
  free: 2,
  ...over,
});

describe("who can join", () => {
  it("reads Aldo's answer, and nothing else as one", () => {
    const answer = joining();
    expect(parseAldoJoining(JSON.parse(JSON.stringify({ joining: answer })))).toEqual(answer);
    // An older Aldo's page, an error, a half answer: none.
    expect(parseAldoJoining("<!doctype html>")).toBeNull();
    expect(parseAldoJoining({ error: "Only an owner or admin can do that." })).toBeNull();
    expect(parseAldoJoining({ joining: { ...answer, policy: "anyone" } })).toBeNull();
    expect(parseAldoJoining({ joining: { ...answer, free: undefined } })).toBeNull();
    // A part it can't read drops out, and the rest still shows.
    const odd = parseAldoJoining({
      joining: {
        ...answer,
        domains: [{ ...domain(), state: "pending" }, domain({ id: "d2", domain: "lp.com" })],
        link: { url: "x" },
        requests: [
          { id: "r2", email: "x@y.z", via: "phone", createdAt: answer.requests[0]!.createdAt },
        ],
      },
    });
    expect(odd?.domains.map((d) => d.domain)).toEqual(["lp.com"]);
    expect(odd?.link).toBeNull();
    expect(odd?.requests).toEqual([]);
  });

  it("reads Check now's answer with what it saw", () => {
    const body = { joining: joining(), found: "missing" };
    expect(parseAldoDomainCheck(body)?.found).toBe("missing");
    expect(parseAldoDomainCheck({ joining: joining() })).toBeNull();
    expect(parseAldoDomainCheck({ found: "found" })).toBeNull();
  });

  it("says invite only until a domain is verified", () => {
    expect(aldoJoiningSummary(joining())).toBe("Ask an admin");
    expect(aldoJoiningSummary(joining({ policy: "join" }))).toBe("Join right away");
    const waiting = joining({
      policy: "join",
      domains: [domain({ state: "waiting", verifiedAt: null })],
    });
    expect(aldoVerifiedDomains(waiting)).toEqual([]);
    expect(aldoJoiningSummary(waiting)).toBe("Invite only");
    expect(aldoJoiningSummary(joining({ domains: [domain({ state: "lost" })] }))).toBe(
      "Invite only",
    );
  });

  it("describes a domain where it stands", () => {
    expect(aldoRecordHost(domain())).toBe("_aldo-verify.linden.co");
    expect(aldoDomainLine(domain())).toBe("Verified · since Oct 3 · checked Oct 24");
    expect(aldoDomainLine(domain({ state: "waiting", verifiedAt: null, checkedAt: null }))).toBe(
      "Waiting · add the DNS record to finish",
    );
    expect(aldoDomainLine(domain({ state: "lost" }))).toBe("Record gone · joining by it is paused");
    expect(aldoDomainLine(domain({ state: "waiting", taken: true }))).toBe(
      "Another organization verified it",
    );
    expect(aldoDomainStatus(domain(), now)).toBe(
      "Verified. 3 members are at linden.co. Aldo checks the record every week; keep it in place.",
    );
    expect(
      aldoDomainStatus(
        domain({
          state: "waiting",
          verifiedAt: null,
          checkedAt: "2026-10-26T14:50:00.000Z",
          checkingUntil: "2026-10-27T14:00:00.000Z",
        }),
        now,
      ),
    ).toBe(
      "Add this record where linden.co’s DNS is managed. It can take a few minutes to show up. Aldo looks every 10 minutes for a day, so you can close this. Aldo last looked 10m ago.",
    );
    expect(
      aldoDomainStatus(domain({ state: "lost", checkedAt: "2026-10-25T12:00:00.000Z" }), now),
    ).toBe(
      "The record is gone, so joining by linden.co is paused. Nobody was removed. Put it back and it works again. Aldo last looked yesterday.",
    );
    expect(aldoDomainStatus(domain({ state: "waiting", checkedAt: null }), now)).toMatch(
      /Tap Check now once the record is in\. Aldo hasn’t looked yet\.$/,
    );
  });

  it("says what Check now found", () => {
    expect(aldoFoundLine("linden.co", "found", "verified")).toBe("linden.co is verified");
    expect(aldoFoundLine("linden.co", "missing", "waiting")).toBe(
      "No record yet. Aldo will look again in 10 minutes.",
    );
    expect(aldoFoundLine("linden.co", "unknown", "waiting")).toBe(
      "DNS didn’t answer. Aldo will look again in 10 minutes.",
    );
  });

  it("writes the steps for whoever runs the DNS", () => {
    const steps = aldoDomainSteps("Linden Partners", domain({ state: "waiting" }));
    expect(steps).toContain("Linden Partners is verifying linden.co on Aldo.");
    expect(steps).toContain("Type: TXT");
    expect(steps).toContain("Name: _aldo-verify  (the full name is _aldo-verify.linden.co)");
    expect(steps).toContain("Value: aldo-verify=abc123");
  });

  it("describes the invite link", () => {
    const link = joining().link!;
    expect(aldoLinkSummary(link)).toBe("On until Nov 1");
    expect(aldoLinkSummary(null)).toBe("Off");
    expect(aldoLinkExpires(link, now)).toBe("Nov 1, in 6 days");
    expect(aldoLinkExpires({ ...link, expiresAt: "2026-10-27T01:00:00.000Z" }, now)).toBe(
      "Oct 27, within a day",
    );
    expect(aldoLinkFor(link, ["linden.co"])).toBe("Only linden.co");
    expect(aldoLinkFor(link, ["linden.co", "lp.com", "lp.co.uk"])).toBe(
      "Only linden.co, lp.com and lp.co.uk",
    );
    expect(aldoLinkFor({ anyAddress: true }, ["linden.co"])).toBe("Any address");
    expect(aldoLinkUsed(link)).toBe("2 people since Oct 25");
    expect(aldoLinkUsed({ ...link, used: 1 })).toBe("1 person since Oct 25");
    expect(aldoLinkUsed({ ...link, used: 0 })).toBe("Nobody yet");
  });

  it("describes requests, and approving without a seat", () => {
    const [request] = joining().requests;
    expect(aldoRequestLine(request!, now)).toBe("Asked 2h ago");
    expect(aldoRequestLine({ ...request!, via: "link" }, now)).toBe(
      "Asked with the invite link 2h ago",
    );
    expect(
      aldoRequestLine({ ...request!, via: "expired", createdAt: "2026-10-17T12:00:00.000Z" }, now),
    ).toBe("Asked on Oct 17, when their invite had expired");
    expect(aldoApproveBlocked(joining())).toBeNull();
    expect(aldoApproveBlocked(joining({ free: 0 }))).toMatch(/^No free seats\./);
  });
});
