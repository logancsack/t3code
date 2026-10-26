/**
 * Offboarding (Aldo's src/lib/org-departures.ts): what becomes of the
 * organization's threads someone had when they leave it or are removed. Each
 * is copied (its conversation and files, their vault's values out) for a
 * colleague to read, download and carry on, kept 30 days for the admins to
 * hand on, or deleted. An account at one of the organization's verified
 * domains is closed, and deleted after 30 days unless an admin restores it.
 * An Aldo without it answers none of these, and the sheets say what they
 * said before.
 */

import { aldoOrgDay, aldoOrgKeeps, type AldoOrg } from "./organization.logic";
import { formatMailSize } from "./mail.logic";

export type AldoWork = "hand" | "keep" | "delete";

/** What leaving, or removing someone, would do: the sheet that asks reads it first. */
export interface AldoLeaving {
  /** The organization's threads they have, how many run now, and their routines and live share links. */
  readonly threads: number;
  readonly running: number;
  readonly routines: number;
  readonly shares: number;
  /** The organization manages their account (its address is at a verified domain): removing it closes it. */
  readonly managed: boolean;
  readonly closesOn: string | null;
  /** Who the threads could go to, the user first. */
  readonly colleagues: ReadonlyArray<{ readonly id: string; readonly email: string }>;
  /** Whether the user chooses what becomes of them (removing someone); leaving keeps them for the admins. */
  readonly choose: boolean;
}

export interface AldoRemoveChoice {
  readonly work: AldoWork;
  readonly to: string | null;
  readonly keepLinks: boolean;
}

export type AldoHandoverState = "copying" | "copied" | "failed" | "deleted";

/** One of a former member's threads, as its copy stands. */
export interface AldoHandoverLine {
  readonly id: string;
  readonly title: string;
  readonly state: AldoHandoverState;
  readonly error: string | null;
  readonly to: { readonly id: string; readonly email: string } | null;
  readonly copiedAt: string | null;
  readonly expiresAt: string | null;
  readonly bytes: number;
  readonly files: number;
  readonly conversations: number;
  readonly continued: boolean;
}

/** Someone who left or was removed, for owners and admins. */
export interface AldoDeparture {
  readonly id: string;
  readonly userId: string | null;
  readonly email: string;
  /** Who removed them; null when they left. */
  readonly by: string | null;
  readonly at: string;
  readonly work: AldoWork;
  readonly to: string | null;
  readonly keepLinks: boolean;
  readonly managed: boolean;
  readonly closesAt: string | null;
  readonly closed: boolean;
  readonly restoredAt: string | null;
  readonly deletedAt: string | null;
  readonly handovers: ReadonlyArray<AldoHandoverLine>;
}

export interface AldoThreadTarget {
  readonly environmentId: string;
  readonly threadId: string;
}

/** A copy handed to the user. */
export interface AldoReceived {
  readonly id: string;
  readonly title: string;
  readonly from: string;
  readonly state: "copying" | "copied";
  readonly at: string;
  readonly copiedAt: string | null;
  readonly bytes: number;
  readonly files: number;
  readonly conversations: number;
  readonly continued: AldoThreadTarget | null;
  readonly seen: boolean;
}

export interface AldoHandoverMessage {
  /** Its place in its conversation, to tell it from the others. */
  readonly key: string;
  readonly role: string;
  readonly text: string;
  readonly createdAt: string;
  readonly attachments: ReadonlyArray<string>;
}

export interface AldoHandoverConversation {
  readonly id: string;
  readonly title: string;
  readonly archived: boolean;
  readonly messages: ReadonlyArray<AldoHandoverMessage>;
}

/** A copy to read: its conversations, the files it holds and left out, and the routines it ran. */
export interface AldoHandoverView {
  readonly id: string;
  readonly title: string;
  readonly from: string;
  readonly org: string;
  readonly copiedAt: string | null;
  readonly repos: ReadonlyArray<string>;
  readonly branch: string | null;
  readonly conversations: ReadonlyArray<AldoHandoverConversation>;
  readonly files: ReadonlyArray<{ readonly name: string; readonly bytes: number }>;
  readonly fileCount: number;
  readonly bytes: number;
  readonly left: ReadonlyArray<{ readonly name: string; readonly why: string }>;
  /** Files past the most a copy holds, not copied. */
  readonly more: number;
  readonly routines: ReadonlyArray<{
    readonly key: string;
    readonly title: string;
    readonly instruction: string;
  }>;
  readonly continued: AldoThreadTarget | null;
}

/** How long a copy nobody was handed is kept, and a closed account before it's deleted. */
export const ALDO_KEPT_DAYS = 30;

const str = (value: unknown) => (typeof value === "string" ? value : null);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const rec = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const isWork = (value: unknown): value is AldoWork =>
  value === "hand" || value === "keep" || value === "delete";
const isState = (value: unknown): value is AldoHandoverState =>
  value === "copying" || value === "copied" || value === "failed" || value === "deleted";
const list = <T>(value: unknown, of: (item: unknown) => T | null): T[] =>
  Array.isArray(value) ? value.flatMap((item) => of(item) ?? []) : [];

function personOf(value: unknown): { id: string; email: string } | null {
  const r = rec(value);
  const [id, email] = [str(r?.id), str(r?.email)];
  return id && email ? { id, email } : null;
}

function targetOf(value: unknown): AldoThreadTarget | null {
  const r = rec(value);
  const [environmentId, threadId] = [str(r?.environmentId), str(r?.threadId)];
  return environmentId && threadId ? { environmentId, threadId } : null;
}

/** Aldo's `{ leaving }`, or null from an Aldo without it (which answers the member's page instead). */
export function parseAldoLeaving(body: unknown): AldoLeaving | null {
  const r = rec(rec(body)?.leaving);
  if (!r || typeof r.threads !== "number" || typeof r.managed !== "boolean") return null;
  return {
    threads: num(r.threads),
    running: num(r.running),
    routines: num(r.routines),
    shares: num(r.shares),
    managed: r.managed,
    closesOn: str(r.closesOn),
    colleagues: list(r.colleagues, personOf),
    choose: r.choose === true,
  };
}

function lineOf(value: unknown): AldoHandoverLine | null {
  const r = rec(value);
  const [id, title] = [str(r?.id), str(r?.title)];
  if (!r || !id || title === null || !isState(r.state)) return null;
  return {
    id,
    title,
    state: r.state,
    error: str(r.error),
    to: personOf(r.to),
    copiedAt: str(r.copiedAt),
    expiresAt: str(r.expiresAt),
    bytes: num(r.bytes),
    files: num(r.files),
    conversations: num(r.conversations),
    continued: r.continued === true,
  };
}

/** One line from an action on a copy (`{ handover }`), or null. */
export function parseAldoHandoverLine(body: unknown): AldoHandoverLine | null {
  return lineOf(rec(body)?.handover);
}

function departureOf(value: unknown): AldoDeparture | null {
  const r = rec(value);
  const [id, email, at] = [str(r?.id), str(r?.email), str(r?.at)];
  if (!r || !id || !email || !at || !isWork(r.work)) return null;
  return {
    id,
    userId: str(r.userId),
    email,
    by: str(r.by),
    at,
    work: r.work,
    to: str(r.to),
    keepLinks: r.keepLinks !== false,
    managed: r.managed === true,
    closesAt: str(r.closesAt),
    closed: r.closed === true,
    restoredAt: str(r.restoredAt),
    deletedAt: str(r.deletedAt),
    handovers: list(r.handovers, lineOf),
  };
}

/** Aldo's `{ departures }`, or null for an answer that isn't one. */
export function parseAldoDepartures(body: unknown): ReadonlyArray<AldoDeparture> | null {
  const departures = rec(body)?.departures;
  return Array.isArray(departures) ? list(departures, departureOf) : null;
}

function receivedOf(value: unknown): AldoReceived | null {
  const r = rec(value);
  const [id, title, from, at] = [str(r?.id), str(r?.title), str(r?.from), str(r?.at)];
  if (!r || !id || title === null || !from || !at) return null;
  if (r.state !== "copying" && r.state !== "copied") return null;
  return {
    id,
    title,
    from,
    state: r.state,
    at,
    copiedAt: str(r.copiedAt),
    bytes: num(r.bytes),
    files: num(r.files),
    conversations: num(r.conversations),
    continued: targetOf(r.continued),
    seen: r.seen === true,
  };
}

/** Aldo's `{ handovers }`, or null for an answer that isn't one. */
export function parseAldoReceived(body: unknown): ReadonlyArray<AldoReceived> | null {
  const handovers = rec(body)?.handovers;
  return Array.isArray(handovers) ? list(handovers, receivedOf) : null;
}

function messageOf(value: unknown, key: string): AldoHandoverMessage | null {
  const r = rec(value);
  const [role, text] = [str(r?.role), str(r?.text)];
  if (!r || !role || text === null) return null;
  return {
    key,
    role,
    text,
    createdAt: str(r.createdAt) ?? "",
    attachments: Array.isArray(r.attachments)
      ? r.attachments.filter((a): a is string => typeof a === "string")
      : [],
  };
}

function conversationOf(value: unknown): AldoHandoverConversation | null {
  const r = rec(value);
  const id = str(r?.id);
  if (!r || !id) return null;
  return {
    id,
    title: str(r.title) ?? "",
    archived: r.archived === true,
    messages: Array.isArray(r.messages)
      ? r.messages.flatMap((m, n) => messageOf(m, `${id}:${n}`) ?? [])
      : [],
  };
}

/** Aldo's `{ handover }` to read, or null. */
export function parseAldoHandoverView(body: unknown): AldoHandoverView | null {
  const r = rec(rec(body)?.handover);
  const [id, title, from, org] = [str(r?.id), str(r?.title), str(r?.from), str(r?.org)];
  if (!r || !id || title === null || !from || !org) return null;
  return {
    id,
    title,
    from,
    org,
    copiedAt: str(r.copiedAt),
    repos: list(r.repos, str),
    branch: str(r.branch),
    conversations: list(r.conversations, conversationOf),
    files: list(r.files, (f) => {
      const file = rec(f);
      const name = str(file?.name);
      return name ? { name, bytes: num(file?.bytes) } : null;
    }),
    fileCount: num(r.fileCount),
    bytes: num(r.bytes),
    left: list(r.left, (l) => {
      const left = rec(l);
      const [name, why] = [str(left?.name), str(left?.why)];
      return name && why ? { name, why } : null;
    }),
    more: num(r.more),
    routines: Array.isArray(r.routines)
      ? r.routines.flatMap((x, n) => {
          const routine = rec(x);
          const [t, instruction] = [str(routine?.title), str(routine?.instruction)];
          return t !== null && instruction !== null
            ? [{ key: `routine:${n}`, title: t, instruction }]
            : [];
        })
      : [],
    continued: targetOf(r.continued),
  };
}

// ---- Words.

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What removing someone does to their threads and account, before the choices. */
export function aldoRemoveSummary(org: AldoOrg, leaving: AldoLeaving): string {
  const routines = leaving.routines
    ? ` ${leaving.routines === 1 ? "Their routine stops" : `Their ${leaving.routines} routines stop`} too.`
    : "";
  const threads = leaving.threads
    ? `Their ${count(leaving.threads, "thread")} in ${org.name} ${leaving.threads === 1 ? "leaves" : "leave"} their account now, and their computers stop.${routines}`
    : `They have no threads in ${org.name}.`;
  const rest = leaving.managed
    ? ""
    : ` Everything else stays theirs: their own threads, computers and vault${org.plan ? ", though their seat on its plan ends" : ""}.`;
  return `${threads}${rest}`;
}

/** Why removing them closes their account, and how long it can be restored. */
export function aldoClosesLine(org: AldoOrg, leaving: AldoLeaving): string {
  const on = leaving.closesOn ? aldoOrgDay(leaving.closesOn) : "";
  return `${org.name} manages their address, so removing them closes their account: they can’t sign in, and it’s deleted${on ? ` on ${on}` : ` after ${ALDO_KEPT_DAYS} days`}. Until then, an admin can restore it under Former members.`;
}

export const ALDO_WORK_LABELS: Readonly<Record<AldoWork, string>> = {
  hand: "Hand them to a colleague",
  keep: `Keep them for ${ALDO_KEPT_DAYS} days`,
  delete: "Delete them",
};

/** What each choice does, under it. */
export function aldoWorkHelp(work: AldoWork, threads: number): string {
  const them = threads === 1 ? "it" : "them";
  if (work === "hand")
    return `A copy of ${threads === 1 ? "its" : "each one’s"} conversation and files, to read, download and carry on. Values from their vault are taken out.`;
  if (work === "keep")
    return `An admin can hand ${them} on from Former members. After ${ALDO_KEPT_DAYS} days, ${threads === 1 ? "it’s" : "they’re"} deleted.`;
  return `${threads === 1 ? "Its" : "Their"} conversations and files are gone for good.`;
}

/** The share links they made from these threads: kept working, or stopped. */
export function aldoLinksLine(shares: number): string {
  return `${shares === 1 ? "1 link" : `${shares} links`} they shared from these threads. Off, ${shares === 1 ? "it stops" : "they stop"} working now.`;
}

/** What the remove button says for the choice: deleting says so. */
export function aldoRemoveAction(leaving: AldoLeaving | null, choice: AldoRemoveChoice): string {
  return leaving?.threads && choice.work === "delete" ? "Remove and delete" : "Remove";
}

/** The choice to start from: hand them to the user (first of the colleagues), or keep them when there's no one. */
export function aldoDefaultChoice(leaving: AldoLeaving): AldoRemoveChoice {
  const to = leaving.colleagues[0]?.id ?? null;
  return { work: to ? "hand" : "keep", to, keepLinks: true };
}

/** What the request sends, or nothing when there are no threads to decide about. */
export function aldoRemoveBody(
  leaving: AldoLeaving | null,
  choice: AldoRemoveChoice,
): AldoRemoveChoice | undefined {
  if (!leaving?.choose || !leaving.threads) return undefined;
  return choice.work === "hand" ? choice : { ...choice, to: null };
}

/** What the toast after removing someone adds: where their threads went, and their account. */
export function aldoRemovedNote(
  leaving: AldoLeaving | null,
  choice: AldoRemoveChoice,
  you: string,
): string | undefined {
  const closed = leaving?.managed ? "Their account is closed." : "";
  if (!leaving?.threads) return closed || undefined;
  const to = leaving.colleagues.find((c) => c.id === choice.to);
  const threads =
    choice.work === "hand"
      ? `Copying their threads for ${to && to.id !== you ? to.email : "you"}. You’ll hear when they’re ready.`
      : choice.work === "keep"
        ? `Their threads are kept for ${ALDO_KEPT_DAYS} days, under Former members.`
        : "Their threads are being deleted.";
  return closed ? `${threads} ${closed}` : threads;
}

/** What leaving does, in its yes: the organization's threads stay with it, the rest with the user. */
export function aldoLeaveLine(org: AldoOrg, leaving: AldoLeaving | null): string {
  const back = "To come back, you’ll need a new invite.";
  // An Aldo without offboarding: everything stays theirs, as it did.
  if (!leaving || !leaving.threads) return `${aldoOrgKeeps(org, "yours")} ${back}`;
  const n = leaving.threads;
  const them = n === 1 ? "it" : "them";
  const seat = org.plan ? ", and your seat on its plan ends" : "";
  return `Your ${count(n, "thread")} in ${org.name} ${n === 1 ? "stays" : "stay"} with it: ${n === 1 ? "it leaves" : "they leave"} your account now, and its admins can hand ${them} to a colleague. Your other threads, computers and vault stay yours${seat}. ${back}`;
}

/** Why the user can't leave: the organization manages their account. */
export function aldoManagedLeaveLine(org: AldoOrg): string {
  return `${org.name} manages your account, so an admin there removes you.`;
}

// ---- Former members.

/** Who took them out and when: "Removed by maya@linden.com · Oct 26", "Left Oct 26". */
export function aldoDepartureWhen(departure: AldoDeparture, you: string | null): string {
  const day = aldoOrgDay(departure.at);
  if (!departure.by) return `Left ${day}`;
  return `Removed by ${you && departure.by === you ? "you" : departure.by} · ${day}`;
}

/** Their threads as they stand, in a line. */
export function aldoDepartureWork(departure: AldoDeparture, now = Date.now()): string {
  const lines = departure.handovers;
  if (!lines.length) return "No threads";
  const n = count(lines.length, "thread");
  const copying = lines.filter((l) => l.state === "copying").length;
  const failed = lines.filter((l) => l.state === "failed").length;
  if (copying) return `Copying ${copying === lines.length ? n : `${copying} of ${n}`}…`;
  if (failed) return `${failed === 1 ? "1 couldn’t" : `${failed} couldn’t`} be copied`;
  const live = lines.filter((l) => l.state === "copied");
  if (!live.length) return `${n} deleted`;
  const kept = live.filter((l) => !l.to);
  if (kept.length) {
    const until = kept
      .map((l) => (l.expiresAt ? Date.parse(l.expiresAt) : Number.NaN))
      .filter((t) => Number.isFinite(t) && t > now)
      .sort((a, b) => a - b)[0];
    const what = kept.length === lines.length ? n : `${kept.length} of ${n}`;
    return until
      ? `${what} kept until ${aldoOrgDay(new Date(until).toISOString())}`
      : `${what} kept`;
  }
  const to = [...new Set(live.map((l) => l.to?.email))];
  return to.length === 1 && to[0] ? `${n} handed to ${to[0]}` : `${n} handed on`;
}

/** A closed account's state, when the organization manages it; null otherwise. */
export function aldoAccountState(departure: AldoDeparture): {
  readonly badge: string;
  readonly line: string;
  readonly restorable: boolean;
} | null {
  if (!departure.managed) return null;
  if (departure.deletedAt)
    return {
      badge: "Deleted",
      line: `Their account was deleted ${aldoOrgDay(departure.deletedAt)}.`,
      restorable: false,
    };
  if (departure.restoredAt)
    return {
      badge: "Restored",
      line: `Their account was restored ${aldoOrgDay(departure.restoredAt)}, back in the organization as a member.`,
      restorable: false,
    };
  const on = departure.closesAt ? ` It’s deleted ${aldoOrgDay(departure.closesAt)}.` : "";
  return departure.closed
    ? {
        badge: "Closed",
        line: `Their account is closed, so they can’t sign in.${on}`,
        restorable: Boolean(departure.userId),
      }
    : { badge: "Closing", line: `Their account is being closed.${on}`, restorable: false };
}

/** A copy's line in its former member's sheet. */
export function aldoHandoverLineText(line: AldoHandoverLine, you: string | null): string {
  const size = line.files ? ` · ${count(line.files, "file")}, ${formatMailSize(line.bytes)}` : "";
  switch (line.state) {
    case "copying":
      return "Copying…";
    case "failed":
      return line.error ? `Couldn’t copy it: ${line.error}` : "Couldn’t copy it.";
    case "deleted":
      return line.error ? `Not copied: ${line.error}` : "Deleted";
    case "copied": {
      if (!line.to)
        return `Kept${line.expiresAt ? ` until ${aldoOrgDay(line.expiresAt)}` : ""}${size}`;
      const who = you && line.to.id === you ? "you" : line.to.email;
      return `Handed to ${who}${line.continued ? " · carried on" : ""}${size}`;
    }
  }
}

/**
 * What an admin can do about a copy: open one handed to them, try a failed
 * one again, hand on one nobody has, delete one nobody has (one handed to
 * someone is theirs to delete).
 */
export function aldoHandoverActions(
  line: AldoHandoverLine,
  you: string | null,
): {
  readonly open: boolean;
  readonly retry: boolean;
  readonly hand: boolean;
  readonly delete: boolean;
} {
  const live = line.state === "copied" || line.state === "failed";
  return {
    open: line.state === "copied" && Boolean(you) && line.to?.id === you,
    retry: line.state === "failed",
    hand: live && !line.to,
    delete: live && (!line.to || line.to.id === you),
  };
}

/** Whether any copy is still being made, so the list reads again until it's done. */
export function aldoDeparturesCopying(departures: ReadonlyArray<AldoDeparture>): boolean {
  return departures.some((d) => d.handovers.some((l) => l.state === "copying"));
}

// ---- Handed to you.

/** A copy's line in the Library: who it's from, when, and what it holds. */
export function aldoReceivedLine(received: AldoReceived): string {
  if (received.state === "copying")
    return `From ${received.from} · being copied, ready in a few minutes`;
  const parts = [`From ${received.from}`, aldoOrgDay(received.copiedAt ?? received.at)];
  if (received.files)
    parts.push(`${count(received.files, "file")}, ${formatMailSize(received.bytes)}`);
  return parts.join(" · ");
}

/** Under a copy's title: whose it was, where, and when it was copied. */
export function aldoHandoverAbout(view: AldoHandoverView): string {
  const when = view.copiedAt ? ` · copied ${aldoOrgDay(view.copiedAt)}` : "";
  return `From ${view.from} in ${view.org}${when}`;
}

/** Where its code was: "Its code is on branch aldo/x of acme/web." */
export function aldoHandoverCode(view: AldoHandoverView): string | null {
  if (!view.repos.length) return null;
  const repos =
    view.repos.length === 1
      ? view.repos[0]
      : `${view.repos.slice(0, -1).join(", ")} and ${view.repos.at(-1)}`;
  return view.branch
    ? `Its code was on branch ${view.branch} of ${repos}: what was pushed is there.`
    : `It worked in ${repos}.`;
}

/** What a copy's file list says past what it shows. */
export function aldoHandoverFilesMore(view: AldoHandoverView): string | null {
  const unlisted = Math.max(0, view.fileCount - view.files.length);
  const parts: string[] = [];
  if (unlisted) parts.push(`and ${count(unlisted, "more file")}, in the download`);
  if (view.more)
    parts.push(`${count(view.more, "file")} past the 10,000 a copy holds weren’t copied`);
  return parts.length ? `${parts.join("; ")}.` : null;
}

/** The first message carrying a copy on says this unless the user writes their own. */
export const ALDO_CARRY_ON_DEFAULT = "Tell me where it stands and what’s left to do.";

/** A conversation's heading: its title, or the thread's when it has none. */
export function aldoConversationTitle(
  conversation: AldoHandoverConversation,
  thread: string,
): string {
  return conversation.title.trim() || thread.trim() || "Untitled";
}
