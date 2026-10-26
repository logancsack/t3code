/**
 * What an organization's owners and admins see of its members' work, and do
 * about it (Aldo's src/lib/org-admin.ts): each member's credits this month,
 * the titles, state and machines of threads started in the organization,
 * one private total for the rest, stopping machines, pausing someone's work,
 * their extra usage limit, and Activity. Never what's in a thread. Members
 * see their own Activity, and a note in a thread an admin stopped. Every
 * answer is read here as Aldo sent it, and anything else (an older Aldo, a
 * half answer) as none, so the pages show only what's there.
 */

import { ALDO_ORG_ROLE_LABELS, type AldoOrgRole } from "./organization.logic";

export type AldoMachineKind = "agent" | "windows" | "gpu";
export type AldoThreadState = "working" | "waiting" | "done" | "failed";

export interface AldoSeatMonth {
  /** The seat's credits this month; null for an unmetered one (Complimentary). */
  readonly included: number | null;
  readonly extraCents: number;
  readonly limitCents: number;
  /** Whether an admin set this member's limit, rather than it being the organization's default. */
  readonly ownLimit: boolean;
}

export interface AldoMemberUsage {
  readonly id: string;
  readonly credits: number;
  /** Null without a seat (the organization has no plan). */
  readonly seat: AldoSeatMonth | null;
  readonly paused: { readonly at: string; readonly by: string | null } | null;
  readonly running: number;
  readonly perHour: number;
}

export interface AldoOrgUsage {
  readonly members: ReadonlyArray<AldoMemberUsage>;
  readonly running: { readonly machines: number; readonly perHour: number };
  readonly updatedAt: string;
}

export interface AldoRunningMachine {
  readonly kind: AldoMachineKind;
  readonly since: string | null;
  readonly perHour: number;
}

export interface AldoRunningThread {
  readonly id: string;
  readonly title: string;
  readonly member: { readonly id: string; readonly email: string };
  readonly machines: ReadonlyArray<AldoRunningMachine>;
  readonly perHour: number;
  readonly canStop: boolean;
}

export interface AldoOrgThread {
  readonly id: string;
  readonly title: string;
  /** Its other conversations. */
  readonly more: number;
  readonly running: boolean;
  readonly state: AldoThreadState | null;
  readonly lastActiveAt: string;
  readonly credits: number;
}

export interface AldoMemberPage {
  readonly member: {
    readonly id: string;
    readonly email: string;
    readonly role: AldoOrgRole;
    readonly joinedAt: string;
  };
  readonly month: { readonly start: string; readonly end: string | null };
  readonly usage: AldoMemberUsage;
  readonly defaultLimitCents: number | null;
  readonly running: ReadonlyArray<AldoRunningThread>;
  readonly threads: ReadonlyArray<AldoOrgThread>;
  /** Their other threads: how many, and their credits this month. Titles stay private. */
  readonly personal: { readonly threads: number; readonly credits: number };
  /** Credits outside any thread: Home, builds. */
  readonly other: number;
  readonly can: { readonly stop: boolean; readonly limit: boolean; readonly pause: boolean };
}

export interface AldoThreadDays {
  readonly id: string;
  readonly title: string;
  readonly credits: number;
  readonly days: ReadonlyArray<{ readonly day: string; readonly credits: number }>;
}

export interface AldoActivityLine {
  readonly id: string;
  readonly at: string;
  /** Who did it; null for Aldo. */
  readonly actor: { readonly id: string | null; readonly email: string } | null;
  readonly action: string;
  readonly target: { readonly id: string | null; readonly email: string } | null;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly outcome: string | null;
}

export interface AldoActivity {
  readonly lines: ReadonlyArray<AldoActivityLine>;
  readonly more: boolean;
}

export interface AldoOrgNotes {
  readonly org: string;
  readonly paused: { readonly at: string; readonly by: string | null } | null;
  readonly stops: ReadonlyArray<{
    readonly environmentId: string;
    readonly at: string;
    readonly by: string | null;
    readonly note: string | null;
    /** It had a GPU computer, whose files went with it (false from an Aldo that doesn't say). */
    readonly gpu: boolean;
  }>;
}

// ---- Reading Aldo's answers.

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : null;
const str = (value: unknown) => (typeof value === "string" ? value : null);
const num = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const list = <T>(value: unknown, read: (item: unknown) => T | null): T[] =>
  Array.isArray(value) ? value.flatMap((item) => read(item) ?? []) : [];
const isRole = (value: unknown): value is AldoOrgRole =>
  value === "owner" || value === "admin" || value === "member";
const isKind = (value: unknown): value is AldoMachineKind =>
  value === "agent" || value === "windows" || value === "gpu";
const isState = (value: unknown): value is AldoThreadState =>
  value === "working" || value === "waiting" || value === "done" || value === "failed";

function person(value: unknown): { id: string; email: string } | null {
  const o = obj(value);
  const [id, email] = [str(o?.id), str(o?.email)];
  return id && email ? { id, email } : null;
}

function someone(value: unknown): { id: string | null; email: string } | null {
  const o = obj(value);
  const email = str(o?.email);
  return email ? { id: str(o?.id), email } : null;
}

function pausedOf(value: unknown): AldoMemberUsage["paused"] {
  const o = obj(value);
  const at = str(o?.at);
  return at ? { at, by: str(o?.by) } : null;
}

function seatOf(value: unknown): AldoSeatMonth | null {
  const o = obj(value);
  if (!o) return null;
  const [extraCents, limitCents] = [num(o.extraCents), num(o.limitCents)];
  if (extraCents === null || limitCents === null || typeof o.ownLimit !== "boolean") return null;
  if (o.included !== null && num(o.included) === null) return null;
  return { included: num(o.included), extraCents, limitCents, ownLimit: o.ownLimit };
}

function usageOf(value: unknown): AldoMemberUsage | null {
  const o = obj(value);
  const id = str(o?.id);
  const [credits, running, perHour] = [num(o?.credits), num(o?.running), num(o?.perHour)];
  if (!o || !id || credits === null || running === null || perHour === null) return null;
  return { id, credits, seat: seatOf(o.seat), paused: pausedOf(o.paused), running, perHour };
}

function machineOf(value: unknown): AldoRunningMachine | null {
  const o = obj(value);
  const perHour = num(o?.perHour);
  return o && isKind(o.kind) && perHour !== null
    ? { kind: o.kind, since: str(o.since), perHour }
    : null;
}

function runningOf(value: unknown): AldoRunningThread | null {
  const o = obj(value);
  const [id, title, perHour] = [str(o?.id), str(o?.title), num(o?.perHour)];
  const member = person(o?.member);
  if (!o || !id || title === null || perHour === null || !member) return null;
  return {
    id,
    title,
    member,
    machines: list(o.machines, machineOf),
    perHour,
    canStop: o.canStop === true,
  };
}

function threadOf(value: unknown): AldoOrgThread | null {
  const o = obj(value);
  const [id, title, lastActiveAt] = [str(o?.id), str(o?.title), str(o?.lastActiveAt)];
  const credits = num(o?.credits);
  if (!o || !id || title === null || !lastActiveAt || credits === null) return null;
  return {
    id,
    title,
    more: num(o.more) ?? 0,
    running: o.running === true,
    state: isState(o.state) ? o.state : null,
    lastActiveAt,
    credits,
  };
}

/** GET /api/org/usage's answer. */
export function parseAldoOrgUsage(body: unknown): AldoOrgUsage | null {
  const o = obj(obj(body)?.usage);
  const running = obj(o?.running);
  const [machines, perHour] = [num(running?.machines), num(running?.perHour)];
  if (!o || !Array.isArray(o.members) || machines === null || perHour === null) return null;
  return {
    members: list(o.members, usageOf),
    running: { machines, perHour },
    updatedAt: str(o.updatedAt) ?? new Date().toISOString(),
  };
}

/** GET /api/org/machines's answer. */
export function parseAldoOrgMachines(
  body: unknown,
): { readonly threads: ReadonlyArray<AldoRunningThread>; readonly updatedAt: string } | null {
  const o = obj(body);
  if (!o || !Array.isArray(o.threads)) return null;
  return {
    threads: list(o.threads, runningOf),
    updatedAt: str(o.updatedAt) ?? new Date().toISOString(),
  };
}

/** A member's page, from GET or PATCH /api/org/members/:id. */
export function parseAldoMemberPage(body: unknown): AldoMemberPage | null {
  const o = obj(obj(body)?.member);
  const m = obj(o?.member);
  const [id, email, joinedAt] = [str(m?.id), str(m?.email), str(m?.joinedAt)];
  const month = obj(o?.month);
  const start = str(month?.start);
  const usage = usageOf(o?.usage);
  const personal = obj(o?.personal);
  const [threads, credits, other] = [num(personal?.threads), num(personal?.credits), num(o?.other)];
  const can = obj(o?.can);
  if (!o || !m || !id || !email || !joinedAt || !isRole(m.role) || !start || !usage || !can)
    return null;
  if (threads === null || credits === null || other === null) return null;
  return {
    member: { id, email, role: m.role, joinedAt },
    month: { start, end: str(month?.end) },
    usage,
    defaultLimitCents: num(o.defaultLimitCents),
    running: list(o.running, runningOf),
    threads: list(o.threads, threadOf),
    personal: { threads, credits },
    other,
    can: { stop: can.stop === true, limit: can.limit === true, pause: can.pause === true },
  };
}

/** GET /api/org/threads/:id's answer. */
export function parseAldoThreadDays(body: unknown): AldoThreadDays | null {
  const o = obj(obj(body)?.thread);
  const [id, title, credits] = [str(o?.id), str(o?.title), num(o?.credits)];
  if (!o || !id || title === null || credits === null) return null;
  const days = list(o.days, (value) => {
    const d = obj(value);
    const [day, c] = [str(d?.day), num(d?.credits)];
    return day && c !== null ? { day, credits: c } : null;
  });
  return { id, title, credits, days };
}

/** GET /api/org/activity's answer. */
export function parseAldoActivity(body: unknown): AldoActivity | null {
  const o = obj(body);
  if (!o || !Array.isArray(o.lines)) return null;
  const lines = list(o.lines, (value): AldoActivityLine | null => {
    const l = obj(value);
    const [id, at, action] = [str(l?.id), str(l?.at), str(l?.action)];
    if (!l || !id || !at || !action) return null;
    return {
      id,
      at,
      actor: someone(l.actor),
      action,
      target: someone(l.target),
      detail: obj(l.detail) ?? {},
      outcome: str(l.outcome),
    };
  });
  return { lines, more: o.more === true };
}

/** GET /api/org/notes's answer. */
export function parseAldoOrgNotes(body: unknown): AldoOrgNotes | null {
  const o = obj(obj(body)?.notes);
  const org = str(o?.org);
  if (!o || !org) return null;
  const stops = list(o.stops, (value) => {
    const s = obj(value);
    const [environmentId, at] = [str(s?.environmentId), str(s?.at)];
    return environmentId && at
      ? { environmentId, at, by: str(s?.by), note: str(s?.note), gpu: s?.gpu === true }
      : null;
  });
  return { org, paused: pausedOf(o.paused), stops };
}

// ---- Their words.

const CREDITS = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });
const UTC_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

export const aldoCredits = (credits: number) => CREDITS.format(credits);

/** Cents as dollars: "$20", "$12.40". */
export function aldoDollars(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars)
    ? `$${CREDITS.format(dollars)}`
    : `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const day = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : DAY.format(date);
};

/** The top of Members: "3 machines running · 150 credits an hour", or that nothing is. */
export function aldoRunningLine(running: { machines: number; perHour: number }): string {
  if (!running.machines) return "Nothing running now";
  const machines = running.machines === 1 ? "1 machine" : `${running.machines} machines`;
  return `${machines} running · ${aldoCredits(running.perHour)} credits an hour`;
}

/** The month a member's page counts: "October", or "Oct 5 – Nov 5" for a seat's month that isn't a calendar one. */
export function aldoMonthLabel(month: AldoMemberPage["month"]): string {
  const start = new Date(month.start);
  if (Number.isNaN(start.getTime())) return "This month";
  const calendar =
    start.getUTCDate() === 1 && start.getUTCHours() === 0 && start.getUTCMinutes() === 0;
  if (calendar || !month.end) return MONTH.format(start);
  return `${day(month.start)} – ${day(month.end)}`;
}

/** A seat's credits: "6,840 of 10,500", unmetered, or the credits alone without a seat. */
export function aldoSeatCredits(usage: AldoMemberUsage): string {
  if (!usage.seat) return `${aldoCredits(usage.credits)} credits`;
  if (usage.seat.included === null) return `${aldoCredits(usage.credits)} · unmetered`;
  return `${aldoCredits(usage.credits)} of ${aldoCredits(usage.seat.included)}`;
}

/** A seat's extra usage against its limit: "$0 of $20", or "Off". */
export function aldoExtraLine(seat: AldoSeatMonth): string {
  if (seat.limitCents === 0 && seat.extraCents === 0) return "Off";
  return `${aldoDollars(seat.extraCents)} of ${aldoDollars(seat.limitCents)}`;
}

/** A seat's limit for its row: "$50", "$20 · default", "Off · default". */
export function aldoLimitLine(seat: AldoSeatMonth): string {
  const amount = seat.limitCents === 0 ? "Off" : aldoDollars(seat.limitCents);
  return seat.ownLimit ? amount : `${amount} · default`;
}

const KINDS: Readonly<Record<AldoMachineKind, string>> = {
  agent: "Agent’s computer",
  windows: "Windows computer",
  gpu: "GPU computer",
};

/** "Agent’s computer + Windows computer". */
export function aldoMachinesName(machines: ReadonlyArray<AldoRunningMachine>): string {
  return machines.map((m) => KINDS[m.kind]).join(" + ") || "Nothing";
}

/** The same in a sentence: "Its Agent’s computer and Windows computer". */
export function aldoMachinesPhrase(machines: ReadonlyArray<AldoRunningMachine>): string {
  const names = machines.map((m) => KINDS[m.kind]);
  if (names.length <= 1) return names[0] ?? "Nothing";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** How long, from `since`: "1h 12m", "40m", "just started". */
export function aldoRunningFor(since: string | null, now = Date.now()): string | null {
  if (!since) return null;
  const minutes = Math.floor((now - Date.parse(since)) / 60_000);
  if (!Number.isFinite(minutes)) return null;
  if (minutes < 1) return "just started";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  return `${Math.floor(hours / 24)} days`;
}

/** A running thread's line: "Agent’s computer + Windows computer · 40m · 120 an hour". */
export function aldoRunningDetail(thread: AldoRunningThread, now = Date.now()): string {
  const first = thread.machines
    .map((m) => m.since)
    .filter((s): s is string => Boolean(s))
    .sort()[0];
  const longest = aldoRunningFor(first ?? null, now);
  return [aldoMachinesName(thread.machines), longest, `${aldoCredits(thread.perHour)} an hour`]
    .filter(Boolean)
    .join(" · ");
}

const STATES: Readonly<Record<AldoThreadState, string>> = {
  working: "Working",
  waiting: "Waiting for an answer",
  done: "Done",
  failed: "Stopped on an error",
};

/** When, short: "2h ago", "Yesterday", "Oct 17". */
export function aldoWhen(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 48 * 60) return "Yesterday";
  return day(iso);
}

/** A thread's line on a member's page: "Working · Running" or "Done · Oct 20", and its other conversations. */
export function aldoThreadLine(thread: AldoOrgThread, now = Date.now()): string {
  const parts = [
    thread.state ? STATES[thread.state] : null,
    thread.running ? "Running" : aldoWhen(thread.lastActiveAt, now),
    thread.more ? `${thread.more + 1} conversations` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

/** The line for everything else of theirs: "Before Acme: 4 threads · titles private". */
export function aldoPersonalLine(org: string, personal: AldoMemberPage["personal"]): string {
  const threads = personal.threads === 1 ? "1 thread" : `${personal.threads} threads`;
  return `Before ${org}: ${threads} · titles private`;
}

/** A day Aldo counts credits in (UTC), "2026-10-24", as "Oct 24". */
export function aldoCreditDay(isoDay: string): string {
  const date = new Date(`${isoDay.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? isoDay : UTC_DAY.format(date);
}

/** What admins see, said at the foot of a member's page. */
export function aldoWhatAdminsSee(email: string, you: boolean): string {
  return you
    ? "Your admins see what you see here: titles, credits and machines. What’s in your threads stays yours."
    : `You see titles, credits and machines. What’s in ${email}’s threads stays theirs.`;
}

/** What stopping a thread's machines does, before it's done. */
export function aldoStopSentence(thread: AldoRunningThread, yours: boolean): string {
  const machines = aldoMachinesPhrase(thread.machines);
  const verb = thread.machines.length === 1 ? "goes" : "go";
  const saving = thread.perHour ? `, saving ${aldoCredits(thread.perHour)} credits an hour` : "";
  const after = yours
    ? "Open the thread to carry on."
    : `${thread.member.email} opens the thread to carry on, and gets a note saying you stopped it.`;
  return `Its ${machines} ${verb} to sleep now${saving}. Files and memory are kept. ${after}`;
}

/** Stopping everything the user may stop, before it's done. */
export function aldoStopAllSentence(threads: ReadonlyArray<AldoRunningThread>): string {
  const stoppable = threads.filter((t) => t.canStop);
  const perHour = stoppable.reduce((sum, t) => sum + t.perHour, 0);
  const left = threads.length - stoppable.length;
  const owners = left
    ? ` ${left === 1 ? "1 thread of an owner’s keeps running" : `${left} threads of owners keep running`}; only owners stop those.`
    : "";
  return `Every machine in ${stoppable.length === 1 ? "1 thread" : `${stoppable.length} threads`} goes to sleep now, saving ${aldoCredits(perHour)} credits an hour. Files and memory are kept, and each member gets a note in their thread.${owners}`;
}

/**
 * A member's limit choices beside the organization's default (its own choice):
 * Off and the usual amounts, lowest first, and which is theirs now.
 */
export function aldoLimitChoices(
  seat: { readonly limitCents: number; readonly ownLimit: boolean },
  defaultCents: number | null,
): { amounts: ReadonlyArray<number>; chosen: "default" | "custom" | number } {
  // A limit of their own that equals the default stays theirs (it won't follow the
  // organization's), so it shows as itself and can be set back to the default.
  const pinned = seat.ownLimit && seat.limitCents === defaultCents;
  const amounts = [0, 1000, 2000, 5000, 10000].filter((cents) => cents !== defaultCents || pinned);
  if (pinned && !amounts.includes(seat.limitCents)) amounts.push(seat.limitCents);
  amounts.sort((a, b) => a - b);
  const chosen = !seat.ownLimit
    ? "default"
    : amounts.includes(seat.limitCents)
      ? seat.limitCents
      : "custom";
  return { amounts, chosen };
}

/** What a limit means for a member, over its choices. */
export function aldoLimitHelp(page: AldoMemberPage, you: boolean): string {
  const seat = page.usage.seat;
  const included = seat?.included ?? null;
  const used = aldoDollars(seat?.extraCents ?? 0);
  const whose = you ? "your" : "their";
  const past =
    included === null
      ? `Extra usage is what ${you ? "you use" : "they use"} past ${whose} seat’s credits`
      : `Extra usage is what ${you ? "you use" : "they use"} past ${whose} seat’s ${aldoCredits(included)} credits`;
  return `${past}, at 1.25¢ a credit. ${you ? "You’ve" : "They’ve"} used ${used} this month. At the limit, ${whose} agents can’t start until next month or a higher limit, as for anyone at theirs.`;
}

/** Pausing someone's work, before it's done. */
export function aldoPauseSentence(page: AldoMemberPage, org: string): string {
  const running = page.usage.running;
  const stops = running
    ? `${running === 1 ? "Their 1 running machine stops" : `Their ${running} running machines stop`} now, and nothing`
    : "Nothing";
  return `${stops} of theirs starts until you resume it: threads, routines and Home, in ${org} or from before. They can still sign in, read their threads and download files, and they’re told you paused it.`;
}

export function aldoRoleLine(role: AldoOrgRole, joinedAt: string): string {
  return `${ALDO_ORG_ROLE_LABELS[role]} · joined ${day(joinedAt)}`;
}

// ---- Activity.

const AN: Readonly<Record<AldoOrgRole, string>> = {
  owner: "an owner",
  admin: "an admin",
  member: "a member",
};
const PLANS: Readonly<Record<string, string>> = {
  plus: "Plus",
  pro: "Pro",
  max: "Max",
  complimentary: "Complimentary",
};
const roleOf = (value: unknown) => (isRole(value) ? AN[value] : "a member");

/** An Activity line as a sentence, from the user's side: "You", "your". */
export function aldoActivitySentence(line: AldoActivityLine, you: string): string {
  const actor = line.actor ? (line.actor.id === you ? "You" : line.actor.email) : "Aldo";
  const isYou = line.target?.id === you;
  const self =
    line.target && line.actor && line.target.id !== null && line.target.id === line.actor.id;
  const target = isYou ? (self ? "yourself" : "you") : (line.target?.email ?? "someone");
  const whose = isYou ? "your" : self ? "their own" : `${line.target?.email ?? "someone"}’s`;
  const d = line.detail;
  const title = typeof d.title === "string" && d.title ? `“${d.title}”` : "a thread";
  switch (line.action) {
    case "joined":
      return `${actor} joined as ${roleOf(d.role)}`;
    case "left":
      return d.deleting
        ? `${actor} left, deleting ${actor === "You" ? "your" : "their"} account`
        : `${actor} left`;
    case "removed":
      return `${actor} removed ${target}`;
    case "role_changed":
      return `${actor} made ${target} ${roleOf(d.to)}`;
    case "renamed":
      return typeof d.to === "string"
        ? `${actor} renamed the organization ${d.to}`
        : `${actor} renamed the organization`;
    case "invited":
      return `${actor} invited ${line.target?.email ?? "someone"} as ${roleOf(d.role)}`;
    case "invite_resent":
      return `${actor} sent ${line.target?.email ?? "someone"}’s invite again`;
    case "invite_revoked":
      return `${actor} revoked the invite for ${line.target?.email ?? "someone"}`;
    case "stopped":
      return `${actor} stopped ${title}, ${isYou ? "your" : self ? "their own" : `${line.target?.email ?? "someone"}’s`} thread`;
    case "paused":
      return `${actor} paused ${whose} work`;
    case "resumed":
      return `${actor} resumed ${whose} work`;
    case "limit_set": {
      const cents = typeof d.cents === "number" ? d.cents : null;
      const amount = cents === null ? "" : cents === 0 ? " off" : ` to ${aldoDollars(cents)}`;
      return d.default === true
        ? `${actor} set ${whose} extra usage limit back to the default${cents === null ? "" : `, ${cents === 0 ? "off" : aldoDollars(cents)}`}`
        : `${actor} set ${whose} extra usage limit${amount}`;
    }
    case "seats_set":
      return typeof d.to === "number"
        ? `${actor} set the seats to ${d.to}`
        : `${actor} changed the seats`;
    case "plan_set": {
      const to = typeof d.to === "string" ? (PLANS[d.to] ?? d.to) : null;
      const limit = typeof d.limitCents === "number" ? d.limitCents : null;
      if (!to) return `${actor} ended the organization’s plan`;
      if (d.from === d.to && limit !== null)
        return `${actor} set each seat’s extra usage limit to ${limit === 0 ? "off" : aldoDollars(limit)}`;
      return `${actor} put the organization on ${to}`;
    }
    default:
      return `${actor} made a change`;
  }
}

/** A note an admin left with a stop, to show under its line. */
export function aldoActivityNote(line: AldoActivityLine): string | null {
  return line.action === "stopped" && typeof line.detail.note === "string" && line.detail.note
    ? `“${line.detail.note}”`
    : null;
}

/** Activity's lines under their days: "Today", "Yesterday", "Oct 24". */
export function aldoActivityDays(
  lines: ReadonlyArray<AldoActivityLine>,
  now = new Date(),
): ReadonlyArray<{ readonly day: string; readonly lines: ReadonlyArray<AldoActivityLine> }> {
  const key = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const today = key(now);
  const yesterday = key(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const days: { day: string; lines: AldoActivityLine[] }[] = [];
  for (const line of lines) {
    const at = new Date(line.at);
    const k = key(at);
    const label = k === today ? "Today" : k === yesterday ? "Yesterday" : DAY.format(at);
    // One heading a day, even for a line written a moment out of order.
    const same = days.find((d) => d.day === label);
    if (same) same.lines.push(line);
    else days.push({ day: label, lines: [line] });
  }
  return days;
}

export const aldoClock = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : TIME.format(date);
};

// ---- What a member sees in their threads.

/** When, for a note: "3:42 PM" today, else "Oct 25, 3:42 PM". */
function noteTime(iso: string, now = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toDateString() === now.toDateString()
    ? `at ${TIME.format(at)}`
    : `on ${DAY.format(at)} at ${TIME.format(at)}`;
}

/** A member's page while their work is paused: who paused it and when. */
export function aldoPausedLine(
  paused: { readonly at: string; readonly by: string | null },
  you: boolean,
  now = new Date(),
): string {
  const whose = you ? "your" : "their";
  const who = paused.by ? `${paused.by} paused ${whose} work` : `An admin paused ${whose} work`;
  return `${who} ${noteTime(paused.at, now)}. Nothing of ${you ? "yours" : "theirs"} starts until it’s resumed.`;
}

/** The note in a thread for its member: their work paused, or this thread stopped by an admin. */
export function aldoOrgNoteFor(
  notes: AldoOrgNotes | null | undefined,
  environmentId: string,
  now = new Date(),
): {
  readonly kind: "paused" | "stopped";
  readonly text: string;
  readonly quote: string | null;
} | null {
  if (!notes) return null;
  if (notes.paused) {
    const by = notes.paused.by ?? "An admin";
    return {
      kind: "paused",
      text: `${by}, an admin of ${notes.org}, paused your work ${noteTime(notes.paused.at, now)}. Nothing starts until an admin resumes it; you can still read your threads and download files.`,
      quote: null,
    };
  }
  const stop = notes.stops.find((s) => s.environmentId === environmentId);
  if (!stop) return null;
  return {
    kind: "stopped",
    text: `Stopped by ${stop.by ?? "an admin"}, an admin of ${notes.org}, ${noteTime(stop.at, now)}. ${stop.gpu ? "Your files are kept, but for the GPU computer’s, which went with it" : "Your files are kept"}; send a message to carry on.`,
    quote: stop.note ? `“${stop.note}”` : null,
  };
}
