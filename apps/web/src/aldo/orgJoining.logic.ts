/**
 * Who can join an organization (Aldo's GET /api/org/joining and the routes
 * beside it), for its owners and admins: the domains it proves with a DNS
 * record, what people at them may do, its invite link, and requests to join.
 * An Aldo without it answers 404, so Settings shows none of it. The server
 * (src/lib/org-doors.ts in Aldo) decides; this says what it answered.
 */

import { aldoOrgDay } from "./organization.logic";
import { aldoWhen } from "./orgAdmin.logic";

export type AldoJoinPolicy = "invite" | "ask" | "join";
export type AldoDomainState = "waiting" | "verified" | "lost";
export type AldoRequestVia = "domain" | "link" | "expired";

export interface AldoOrgDomain {
  readonly id: string;
  readonly domain: string;
  readonly state: AldoDomainState;
  /** The TXT record that proves it: its name under the domain, and its value. */
  readonly record: { readonly name: string; readonly value: string };
  readonly addedAt: string;
  readonly checkedAt: string | null;
  readonly verifiedAt: string | null;
  readonly lostAt: string | null;
  /** Aldo looks every 10 minutes until then; null when it doesn't. */
  readonly checkingUntil: string | null;
  /** Another organization verified it first. */
  readonly taken: boolean;
  /** Members whose address is at it. */
  readonly members: number;
}

export interface AldoOrgLink {
  readonly url: string;
  readonly expiresAt: string;
  readonly anyAddress: boolean;
  readonly createdAt: string;
  /** Invites it gave since it was turned on. */
  readonly used: number;
}

export interface AldoOrgRequest {
  readonly id: string;
  readonly email: string;
  readonly note: string | null;
  readonly via: AldoRequestVia;
  readonly createdAt: string;
}

export interface AldoJoining {
  readonly policy: AldoJoinPolicy;
  readonly domains: ReadonlyArray<AldoOrgDomain>;
  /** Null while it's off. */
  readonly link: AldoOrgLink | null;
  readonly requests: ReadonlyArray<AldoOrgRequest>;
  /** Seats neither members nor open invites take. */
  readonly free: number;
}

/** What Check now's lookup saw: the record, none, or no answer from DNS. */
export type AldoDomainFound = "found" | "missing" | "unknown";

export const ALDO_JOIN_POLICIES: ReadonlyArray<AldoJoinPolicy> = ["invite", "ask", "join"];

export const ALDO_JOIN_POLICY_LABELS: Readonly<Record<AldoJoinPolicy, string>> = {
  invite: "Invite only",
  ask: "Ask an admin",
  join: "Join right away",
};

export const ALDO_JOIN_POLICY_HELP: Readonly<Record<AldoJoinPolicy, string>> = {
  invite: "They need an invite from an admin.",
  ask: "They can ask; an admin approves in Requests.",
  join: "They get an invite at once while seats are free.",
};

/** How long the invite link works, as an admin picks it. */
export const ALDO_LINK_DAYS: ReadonlyArray<1 | 7 | 30> = [1, 7, 30];

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : null;
const str = (value: unknown) => (typeof value === "string" ? value : null);
const num = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const list = <T>(value: unknown, of: (item: unknown) => T | null): T[] =>
  Array.isArray(value) ? value.map(of).filter((item): item is T => item !== null) : [];
const isPolicy = (value: unknown): value is AldoJoinPolicy =>
  value === "invite" || value === "ask" || value === "join";
const isState = (value: unknown): value is AldoDomainState =>
  value === "waiting" || value === "verified" || value === "lost";
const isVia = (value: unknown): value is AldoRequestVia =>
  value === "domain" || value === "link" || value === "expired";

/** When, inside a sentence: "2h ago", "yesterday", "on Oct 17". */
function when(iso: string, now: number): string {
  const said = aldoWhen(iso, now);
  if (said === "Yesterday") return "yesterday";
  return /^[A-Z][a-z]{2} \d{1,2}$/.test(said) ? `on ${said}` : said;
}

function domainOf(value: unknown): AldoOrgDomain | null {
  const o = obj(value);
  const record = obj(o?.record);
  const [id, domain, addedAt, name, recordValue] = [
    str(o?.id),
    str(o?.domain),
    str(o?.addedAt),
    str(record?.name),
    str(record?.value),
  ];
  if (!o || !id || !domain || !addedAt || !name || !recordValue || !isState(o.state)) return null;
  return {
    id,
    domain,
    state: o.state,
    record: { name, value: recordValue },
    addedAt,
    checkedAt: str(o.checkedAt),
    verifiedAt: str(o.verifiedAt),
    lostAt: str(o.lostAt),
    checkingUntil: str(o.checkingUntil),
    taken: o.taken === true,
    members: num(o.members) ?? 0,
  };
}

function linkOf(value: unknown): AldoOrgLink | null {
  const o = obj(value);
  const [url, expiresAt, createdAt] = [str(o?.url), str(o?.expiresAt), str(o?.createdAt)];
  if (!o || !url || !expiresAt || !createdAt) return null;
  return { url, expiresAt, createdAt, anyAddress: o.anyAddress === true, used: num(o.used) ?? 0 };
}

function requestOf(value: unknown): AldoOrgRequest | null {
  const o = obj(value);
  const [id, email, createdAt] = [str(o?.id), str(o?.email), str(o?.createdAt)];
  if (!o || !id || !email || !createdAt || !isVia(o.via)) return null;
  return { id, email, note: str(o.note), via: o.via, createdAt };
}

/** Who can join, from any of its routes' answers ({ joining }); null for an answer that isn't one. */
export function parseAldoJoining(body: unknown): AldoJoining | null {
  const o = obj(obj(body)?.joining);
  const free = num(o?.free);
  if (!o || !isPolicy(o.policy) || free === null || !Array.isArray(o.domains)) return null;
  return {
    policy: o.policy,
    domains: list(o.domains, domainOf),
    link: linkOf(o.link),
    requests: list(o.requests, requestOf),
    free,
  };
}

/** Check now's answer: who can join after it, and what the lookup saw. */
export function parseAldoDomainCheck(
  body: unknown,
): { readonly joining: AldoJoining; readonly found: AldoDomainFound } | null {
  const joining = parseAldoJoining(body);
  const found = obj(body)?.found;
  if (!joining || (found !== "found" && found !== "missing" && found !== "unknown")) return null;
  return { joining, found };
}

/** Domains that let people in now: verified, with their record still there. */
export function aldoVerifiedDomains(joining: AldoJoining): ReadonlyArray<string> {
  return joining.domains.filter((d) => d.state === "verified").map((d) => d.domain);
}

/** Who can join, for its row on Organization: the policy once a domain is verified, else invite only. */
export function aldoJoiningSummary(joining: AldoJoining): string {
  return aldoVerifiedDomains(joining).length
    ? ALDO_JOIN_POLICY_LABELS[joining.policy]
    : ALDO_JOIN_POLICY_LABELS.invite;
}

/** The record's full name, as DNS hosts that want it whole take it: "_aldo-verify.linden.co". */
export function aldoRecordHost(domain: AldoOrgDomain): string {
  return `${domain.record.name}.${domain.domain}`;
}

/** A domain's line in the list: "Verified · since Oct 3", "Waiting · add the DNS record to finish". */
export function aldoDomainLine(domain: AldoOrgDomain): string {
  if (domain.taken) return "Another organization verified it";
  if (domain.state === "verified") {
    const since = domain.verifiedAt ? ` · since ${aldoOrgDay(domain.verifiedAt)}` : "";
    const checked = domain.checkedAt ? ` · checked ${aldoOrgDay(domain.checkedAt)}` : "";
    return `Verified${since}${checked}`;
  }
  if (domain.state === "lost") return "Record gone · joining by it is paused";
  return "Waiting · add the DNS record to finish";
}

/** What a domain's sheet says about where it stands, and what comes next. */
export function aldoDomainStatus(domain: AldoOrgDomain, now = Date.now()): string {
  const checked = domain.checkedAt
    ? `Aldo last looked ${when(domain.checkedAt, now)}.`
    : "Aldo hasn’t looked yet.";
  if (domain.taken) {
    return "Another organization verified this domain first, so it can’t be verified here. If that’s wrong, write to support@aldo.computer.";
  }
  if (domain.state === "verified") {
    const people = domain.members === 1 ? "1 member is" : `${domain.members} members are`;
    return `Verified. ${people} at ${domain.domain}. Aldo checks the record every week; keep it in place.`;
  }
  if (domain.state === "lost") {
    return `The record is gone, so joining by ${domain.domain} is paused. Nobody was removed. Put it back and it works again. ${checked}`;
  }
  const until = domain.checkingUntil
    ? " Aldo looks every 10 minutes for a day, so you can close this."
    : " Tap Check now once the record is in.";
  return `Add this record where ${domain.domain}’s DNS is managed. It can take a few minutes to show up.${until} ${checked}`;
}

/** What Check now found, for its toast. */
export function aldoFoundLine(domain: string, found: AldoDomainFound, state: AldoDomainState) {
  if (found === "found" && state === "verified") return `${domain} is verified`;
  if (found === "unknown") return "DNS didn’t answer. Aldo will look again in 10 minutes.";
  return "No record yet. Aldo will look again in 10 minutes.";
}

/** The steps for whoever runs the domain's DNS, to send them. */
export function aldoDomainSteps(org: string, domain: AldoOrgDomain): string {
  return [
    `${org} is verifying ${domain.domain} on Aldo. Please add this DNS record:`,
    "",
    "Type: TXT",
    `Name: ${domain.record.name}  (the full name is ${aldoRecordHost(domain)})`,
    `Value: ${domain.record.value}`,
    "",
    "Keep it in place afterwards: Aldo checks it every week.",
  ].join("\n");
}

/** The invite link's row: "On until Nov 1", or "Off". */
export function aldoLinkSummary(link: AldoOrgLink | null): string {
  return link ? `On until ${aldoOrgDay(link.expiresAt)}` : "Off";
}

/** When it stops working: "Nov 1, in 7 days". */
export function aldoLinkExpires(link: AldoOrgLink, now = Date.now()): string {
  const day = aldoOrgDay(link.expiresAt);
  const days = Math.ceil((Date.parse(link.expiresAt) - now) / 86_400_000);
  return days <= 1 ? `${day}, within a day` : `${day}, in ${days} days`;
}

/** Whom it works for: "Only linden.co", "Only linden.co and lp.com", or anyone. */
export function aldoLinkFor(link: Pick<AldoOrgLink, "anyAddress">, domains: ReadonlyArray<string>) {
  if (link.anyAddress || !domains.length) return "Any address";
  if (domains.length === 1) return `Only ${domains[0]}`;
  return `Only ${domains.slice(0, -1).join(", ")} and ${domains.at(-1)}`;
}

/** How much it's been used. */
export function aldoLinkUsed(link: AldoOrgLink): string {
  const people = link.used === 1 ? "1 person" : `${link.used} people`;
  return link.used ? `${people} since ${aldoOrgDay(link.createdAt)}` : "Nobody yet";
}

/** A request's line: "Asked 2h ago", "Asked with the invite link yesterday". */
export function aldoRequestLine(request: AldoOrgRequest, now = Date.now()): string {
  const at = when(request.createdAt, now);
  if (request.via === "link") return `Asked with the invite link ${at}`;
  if (request.via === "expired") return `Asked ${at}, when their invite had expired`;
  return `Asked ${at}`;
}

/** Why approving can't go now, or null: it needs a free seat. */
export function aldoApproveBlocked(joining: AldoJoining): string | null {
  return joining.free > 0
    ? null
    : "No free seats. Revoke an invite or ask Aldo for more seats, then approve.";
}
