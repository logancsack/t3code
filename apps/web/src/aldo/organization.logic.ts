/**
 * The user's organization (Aldo's GET /api/org and the routes beside it): its
 * people, their roles, its seats and, for owners and admins, its open
 * invites. Someone in none, and an Aldo without organizations, answers 404,
 * so Settings shows nothing of them. What each role may do mirrors the
 * server's checks (src/lib/orgs.ts in Aldo), which decide.
 */

export type AldoOrgRole = "owner" | "admin" | "member";

export interface AldoOrgMember {
  readonly id: string;
  readonly email: string;
  readonly role: AldoOrgRole;
  readonly joinedAt: string;
}

export interface AldoOrgInvite {
  readonly id: string;
  readonly email: string;
  readonly role: AldoOrgRole;
  readonly expiresAt: string;
  readonly sentAt: string;
  /** Who sent it last, by address; null for Aldo. */
  readonly sentBy: string | null;
  readonly expired: boolean;
}

export interface AldoOrg {
  readonly id: string;
  readonly name: string;
  readonly seats: number;
  /** Seats taken: members, and invites still open. */
  readonly used: number;
  /** The user's own id and role in it. */
  readonly you: string;
  readonly role: AldoOrgRole;
  readonly members: ReadonlyArray<AldoOrgMember>;
  /** Null for members, who don't see invites. */
  readonly invites: ReadonlyArray<AldoOrgInvite> | null;
}

export const ALDO_ORG_ROLES: ReadonlyArray<AldoOrgRole> = ["member", "admin", "owner"];

export const ALDO_ORG_ROLE_LABELS: Readonly<Record<AldoOrgRole, string>> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

/** What each role can do, in a line, where it's chosen. */
export const ALDO_ORG_ROLE_HELP: Readonly<Record<AldoOrgRole, string>> = {
  member: "Uses Aldo with their own account. Sees who’s in the organization.",
  admin: "Invites people and manages members and admins. Can’t change owners.",
  owner: "Everything an admin can do, plus the name and other owners.",
};

/** Why the last owner can't step down or leave, and the way out. */
export function aldoOrgLastOwner(org: AldoOrg): string {
  return `You’re the only owner of ${org.name}, so you can’t step down, leave or be removed. Make another person an owner first.`;
}

const isRole = (value: unknown): value is AldoOrgRole =>
  value === "owner" || value === "admin" || value === "member";
const str = (value: unknown) => (typeof value === "string" ? value : null);

function memberOf(value: unknown): AldoOrgMember | null {
  if (!value || typeof value !== "object") return null;
  const { id, email, role, joinedAt } = value as Record<string, unknown>;
  const [i, e, j] = [str(id), str(email), str(joinedAt)];
  return i && e && j && isRole(role) ? { id: i, email: e, role, joinedAt: j } : null;
}

function inviteOf(value: unknown): AldoOrgInvite | null {
  if (!value || typeof value !== "object") return null;
  const { id, email, role, expiresAt, sentAt, sentBy, expired } = value as Record<string, unknown>;
  const [i, e, x, s] = [str(id), str(email), str(expiresAt), str(sentAt)];
  return i && e && x && s && isRole(role) && typeof expired === "boolean"
    ? { id: i, email: e, role, expiresAt: x, sentAt: s, sentBy: str(sentBy), expired }
    : null;
}

/** Aldo's answer, or null for one that isn't (an older Aldo's page, an error, a half answer). */
export function parseAldoOrg(body: unknown): AldoOrg | null {
  if (!body || typeof body !== "object") return null;
  const { id, name, seats, used, you, role, members, invites } = body as Record<string, unknown>;
  const [i, n, y] = [str(id), str(name), str(you)];
  if (!i || !n || !y || !isRole(role) || typeof seats !== "number" || typeof used !== "number")
    return null;
  if (!Array.isArray(members)) return null;
  return {
    id: i,
    name: n,
    seats,
    used,
    you: y,
    role,
    members: members.flatMap((m) => memberOf(m) ?? []),
    invites: Array.isArray(invites) ? invites.flatMap((m) => inviteOf(m) ?? []) : null,
  };
}

/** Whether the user invites people and manages members: owners and admins. */
export function aldoOrgManages(org: AldoOrg): boolean {
  return org.role !== "member";
}

/** Whether the user may change this person's role or remove them: someone else, and admins never owners. */
export function aldoOrgCanManage(org: AldoOrg, member: AldoOrgMember): boolean {
  if (member.id === org.you) return false;
  return org.role === "owner" || (org.role === "admin" && member.role !== "owner");
}

/** The roles the user may give someone, or invite them as: owners any, admins admin or member. */
export function aldoOrgRolesToGive(org: AldoOrg): ReadonlyArray<AldoOrgRole> {
  if (org.role === "owner") return ALDO_ORG_ROLES;
  if (org.role === "admin") return ["member", "admin"];
  return [];
}

/** Whether the user may resend or revoke this invite: admins don't handle owners' invites. */
export function aldoOrgCanHandleInvite(org: AldoOrg, invite: AldoOrgInvite): boolean {
  return org.role === "owner" || (org.role === "admin" && invite.role !== "owner");
}

/**
 * What the user can do about their own place in it, at the foot of the page:
 * delete it when they're the only one in it, step down a role, leave, or
 * neither while they're its last owner with others in it.
 */
export function aldoOrgOwnPlace(org: AldoOrg): {
  readonly delete: boolean;
  /** The role stepping down gives them, or null. */
  readonly stepDownTo: AldoOrgRole | null;
  readonly leave: boolean;
  /** Why they can't step down or leave, if they can't. */
  readonly blocked: string | null;
} {
  if (org.members.length <= 1 && org.role === "owner")
    return { delete: true, stepDownTo: null, leave: false, blocked: null };
  const owners = org.members.filter((member) => member.role === "owner").length;
  const lastOwner = org.role === "owner" && owners <= 1;
  const lower = org.role === "owner" ? "admin" : org.role === "admin" ? "member" : null;
  return {
    delete: false,
    stepDownTo: lower,
    leave: true,
    blocked: lastOwner ? aldoOrgLastOwner(org) : null,
  };
}

/** How many of the seats are taken: "3 of 10 used". */
export function aldoOrgSeatsLine(org: AldoOrg): string {
  return `${org.used} of ${org.seats} used`;
}

/** Whether every seat is taken, so no one more can be invited. */
export function aldoOrgFull(org: AldoOrg): boolean {
  return org.used >= org.seats;
}

/** Invites that hold a seat: open, not expired. */
export function aldoOrgOpenInvites(org: AldoOrg): number {
  return org.invites?.filter((invite) => !invite.expired).length ?? 0;
}

/** Members, and for owners and admins those invited: "7 · 1 invited". */
export function aldoOrgMembersSummary(org: AldoOrg): string {
  const invited = aldoOrgOpenInvites(org);
  return invited ? `${org.members.length} · ${invited} invited` : String(org.members.length);
}

/** Its owners, short enough for a row: "You", "maya@…", "You and 2 more", or "3 owners". */
export function aldoOrgOwnersLine(org: AldoOrg): string {
  const owners = org.members.filter((member) => member.role === "owner");
  const you = owners.some((owner) => owner.id === org.you);
  if (owners.length <= 1) return you ? "You" : (owners[0]?.email ?? "None");
  return you ? `You and ${owners.length - 1} more` : `${owners.length} owners`;
}

/** Up to two letters for a tile, from an address or a name: "maya.okafor@…" and "Linden Partners" are "MO" and "LP". */
export function aldoOrgInitials(text: string): string {
  const parts = (text.split("@")[0] ?? "").split(/[\s._+-]+/).filter(Boolean);
  const [first, second] = parts;
  return ((first?.[0] ?? "?") + (second?.[0] ?? "")).toUpperCase();
}

/** The user's place, in a line: "You’re an owner". */
export function aldoOrgYouLine(org: AldoOrg): string {
  return `You’re ${org.role === "member" ? "a member" : `an ${org.role}`}`;
}

/** Seats free for invites. */
export function aldoOrgFreeSeats(org: AldoOrg): number {
  return Math.max(0, org.seats - org.used);
}

export function aldoOrgFullLine(org: AldoOrg): string {
  return `All ${org.seats} ${org.seats === 1 ? "seat is" : "seats are"} in use. Revoke an invite or ask Aldo for more seats.`;
}

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** A day, as "Oct 3". */
export function aldoOrgDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : DAY.format(date);
}

/** An invite's line: its role, when it was sent and when it expires; or that it expired, and holds no seat. */
export function aldoOrgInviteLine(invite: AldoOrgInvite): string {
  const role = ALDO_ORG_ROLE_LABELS[invite.role];
  const day = aldoOrgDay(invite.expiresAt);
  return invite.expired
    ? `${role} · expired ${day} · holds no seat`
    : `${role} · sent ${aldoOrgDay(invite.sentAt)} · expires ${day}`;
}

/** When an invite expires, for its sheet: "Oct 30, in 5 days", or "Expired Oct 22". */
export function aldoOrgExpiresLine(invite: AldoOrgInvite, now = Date.now()): string {
  const day = aldoOrgDay(invite.expiresAt);
  if (invite.expired) return `Expired ${day}`;
  const days = Math.ceil((Date.parse(invite.expiresAt) - now) / 86_400_000);
  return days <= 1 ? `${day}, within a day` : `${day}, in ${days} days`;
}
