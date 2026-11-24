// What an organization's owners and admins read and change: members' work, offboarding and
// who can join. Apart from accountApi.ts so the home screen doesn't load their parsers.

import { memberPath } from "./accountApi";
import { api, AldoApiError } from "./api";
import {
  parseAldoDepartures,
  parseAldoHandoverLine,
  parseAldoHandoverView,
  parseAldoLeaving,
  parseAldoReceived,
} from "./offboarding.logic";
import {
  parseAldoDomainCheck,
  parseAldoJoining,
  type AldoJoining,
  type AldoJoinPolicy,
} from "./orgJoining.logic";
import {
  parseAldoActivity,
  parseAldoMemberPage,
  parseAldoOrgMachines,
  parseAldoOrgNotes,
  parseAldoOrgUsage,
  parseAldoThreadDays,
  type AldoMemberPage,
} from "./orgAdmin.logic";

/** A read of members' work; null from an Aldo without it (404, or 405 where the route only changes) or an answer that isn't one. */
async function orgRead<T>(path: string, parse: (body: unknown) => T | null): Promise<T | null> {
  try {
    return parse(await api<unknown>(path));
  } catch (cause) {
    if (cause instanceof AldoApiError && (cause.status === 404 || cause.status === 405))
      return null;
    throw cause;
  }
}

const memberChange = (id: string, body: unknown) =>
  api<unknown>(memberPath(id), { method: "PATCH", body: JSON.stringify(body) }).then(
    (answer): AldoMemberPage => {
      const page = parseAldoMemberPage(answer);
      if (!page) throw new Error("Aldo didn't say how it went. Reload to see.");
      return page;
    },
  );

const stopped = (answer: { stopped?: unknown }) =>
  typeof answer.stopped === "number" ? answer.stopped : 0;

/**
 * Owners' and admins' view of members' work, and what they do about it
 * (orgAdmin.logic.ts); a member reads only their own Activity and notes.
 */
export const aldoOrgAdmin = {
  usage: () => orgRead("/api/org/usage", parseAldoOrgUsage),
  machines: () => orgRead("/api/org/machines", parseAldoOrgMachines),
  /** A member's month; null once they're not in the organization, as for an Aldo without these pages. */
  member: (id: string) => orgRead(memberPath(id), parseAldoMemberPage),
  thread: (id: string) =>
    orgRead(`/api/org/threads/${encodeURIComponent(id)}`, parseAldoThreadDays),
  activity: (
    options: {
      readonly person?: string | null;
      readonly team?: string | null;
      readonly before?: string | null;
    } = {},
  ) => {
    const query = new URLSearchParams();
    if (options.person) query.set("person", options.person);
    if (options.team) query.set("team", options.team);
    if (options.before) query.set("before", options.before);
    const search = query.toString();
    return orgRead(`/api/org/activity${search ? `?${search}` : ""}`, parseAldoActivity);
  },
  notes: () => orgRead("/api/org/notes", parseAldoOrgNotes),
  /** Stops an organization thread's machines, with a note to its member; how many threads stopped. */
  stop: (threadId: string, note: string) =>
    api<{ stopped?: unknown }>(`/api/org/machines/${encodeURIComponent(threadId)}/stop`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }).then(stopped),
  /** Stops every machine the user may stop, or only one member's. */
  stopAll: (input: { readonly note?: string; readonly member?: string }) =>
    api<{ stopped?: unknown }>("/api/org/machines/stop-all", {
      method: "POST",
      body: JSON.stringify(input),
    }).then(stopped),
  /** Their extra usage limit in cents, or null for the organization's default. */
  setLimit: (id: string, cents: number | null) => memberChange(id, { limitCents: cents }),
  setPaused: (id: string, paused: boolean) => memberChange(id, { paused }),
};

const handoverPath = (id: string) => `/api/org/handovers/${encodeURIComponent(id)}`;

/** A read Aldo may refuse as only an older one does: null for 403 (an older Aldo's member page), 404 and 405. */
async function offboardingRead<T>(
  path: string,
  parse: (body: unknown) => T | null,
): Promise<T | null> {
  try {
    return parse(await api<unknown>(path));
  } catch (cause) {
    if (cause instanceof AldoApiError && [403, 404, 405].includes(cause.status)) return null;
    throw cause;
  }
}

const handoverChange = (id: string, body: unknown) =>
  api<unknown>(handoverPath(id), { method: "POST", body: JSON.stringify(body) }).then(
    parseAldoHandoverLine,
  );

/**
 * What leaving or being removed does to the organization's threads someone
 * had (offboarding.logic.ts): what it would do, the former members and their
 * copies for owners and admins, and the copies handed to the user. Reads
 * answer null from an Aldo without them.
 */
export const aldoOffboarding = {
  /** What removing `id` (or leaving, for the user's own) would do. */
  leaving: (id: string) => offboardingRead(`${memberPath(id)}?leaving`, parseAldoLeaving),
  departures: () => orgRead("/api/org/departures", parseAldoDepartures),
  /** Opens an account the organization closed, back in it as a member. */
  restore: (id: string) =>
    api<unknown>(`/api/org/departures/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify({ restore: true }),
    }).then(parseAldoDepartures),
  retry: (id: string) => handoverChange(id, { retry: true }),
  hand: (id: string, to: string) => handoverChange(id, { hand: to }),
  /** Deletes a copy: an admin's, of one nobody has; or the user's own. */
  delete: (id: string) => handoverChange(id, { delete: true }),
  /** The copies handed to the user; empty without organizations, null from an Aldo without them. */
  received: () => orgRead("/api/org/handovers", parseAldoReceived),
  /** A copy handed to the user, to read; null once it's gone. */
  view: (id: string) => orgRead(handoverPath(id), parseAldoHandoverView),
  filesUrl: (id: string) => `${handoverPath(id)}/files`,
  /** Carries a copy on in a thread of the user's own; the thread to open. */
  carryOn: (id: string, message: string) =>
    api<{ environmentId?: unknown; threadId?: unknown }>(`${handoverPath(id)}/continue`, {
      method: "POST",
      body: JSON.stringify(message.trim() ? { message: message.trim() } : {}),
    }).then((answer) => {
      if (typeof answer.environmentId !== "string" || typeof answer.threadId !== "string")
        throw new Error("Aldo didn't say which thread. Look in your threads.");
      return { environmentId: answer.environmentId, threadId: answer.threadId };
    }),
};

const joiningChange = (path: string, method: string, body?: unknown) =>
  api<unknown>(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).then((answer): AldoJoining => {
    const joining = parseAldoJoining(answer);
    if (!joining) throw new Error("Aldo didn't say how it went. Reload to see.");
    return joining;
  });

const domainPath = (id: string) => `/api/org/domains/${encodeURIComponent(id)}`;

/**
 * Who can join the organization (orgJoining.logic.ts), for its owners and
 * admins: each change answers it as it is after.
 */
export const aldoOrgJoining = {
  /** Null from an Aldo without it, or for someone in no organization. */
  get: () => orgRead("/api/org/joining", parseAldoJoining),
  setPolicy: (policy: AldoJoinPolicy) => joiningChange("/api/org/joining", "PATCH", { policy }),
  addDomain: (domain: string) => joiningChange("/api/org/domains", "POST", { domain }),
  /** Looks the domain's record up now; what it saw, too. */
  checkDomain: (id: string) =>
    api<unknown>(domainPath(id), { method: "POST" }).then((answer) => {
      const checked = parseAldoDomainCheck(answer);
      if (!checked) throw new Error("Aldo didn't say how it went. Reload to see.");
      return checked;
    }),
  removeDomain: (id: string) => joiningChange(domainPath(id), "DELETE"),
  /** Turns the invite link on, or changes it. */
  setLink: (input: {
    readonly days?: 1 | 7 | 30;
    readonly anyAddress?: boolean;
    readonly replace?: true;
  }) => joiningChange("/api/org/link", "PUT", input),
  linkOff: () => joiningChange("/api/org/link", "DELETE"),
  /** Approving sends an invite to the address that asked; declining tells it so. */
  decide: (id: string, approve: boolean) =>
    joiningChange(`/api/org/requests/${encodeURIComponent(id)}`, "POST", { approve }),
};
