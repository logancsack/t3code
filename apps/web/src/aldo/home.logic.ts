// The pure parts of the home screen (AldoHome.tsx): how Aldo's read of the
// user's work (cloud.ts AldoHome) sorts into what needs them, what's working,
// what shipped and what's coming, and the words for each.

import { ACTION_LABELS, REVERSE_LABELS } from "./assistant.logic";
import type {
  AldoHome,
  AldoHomeAction,
  AldoHomeConversation,
  AldoHomeDelivery,
  AldoHomePullRequest,
  AldoHomeUsage,
  AldoPolicy,
} from "./cloud";

/** A turn that hasn't moved in this long is stuck (Aldo's sweep counts it as idle). */
export const STUCK_MS = 60 * 60 * 1000;
/** How long finished work and shipped pull requests stay on the board. */
const DONE_WINDOW_MS = 48 * 60 * 60 * 1000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type NeedsYouKind = "question" | "approval" | "plan" | "waiting" | "failed";

export const NEEDS_YOU_LABEL: Record<NeedsYouKind, string> = {
  question: "Question",
  approval: "Approval",
  plan: "Plan to approve",
  waiting: "Waiting on you",
  failed: "Stopped with an error",
};

/** Why a conversation needs the user, or null if it doesn't. */
export function needsYouKind(c: AldoHomeConversation): NeedsYouKind | null {
  if (c.state === "failed") return "failed";
  if (c.state !== "waiting") return null;
  if (c.pending?.kind === "question") return "question";
  if (c.pending?.kind === "approval") return "approval";
  if (c.plan) return "plan";
  return "waiting";
}

export const WORKING_STATES = new Set(["working", "starting", "queued", "retrying"]);

export function isStuck(c: AldoHomeConversation, now: number): boolean {
  return c.state === "working" && now - Date.parse(c.at) > STUCK_MS;
}

export interface HomeBoard {
  /** Waited longest first. */
  readonly needsYou: ReadonlyArray<AldoHomeConversation>;
  /** Newest first. */
  readonly working: ReadonlyArray<AldoHomeConversation>;
  /** Finished in the last two days, newest first. */
  readonly done: ReadonlyArray<AldoHomeConversation>;
}

const byAt = (a: { at: string }, b: { at: string }) => b.at.localeCompare(a.at);

/** The conversations sorted into the board's sections (those with nothing sent yet are left out). */
export function boardFor(
  conversations: ReadonlyArray<AldoHomeConversation>,
  now: number,
): HomeBoard {
  return {
    needsYou: conversations
      .filter((c) => needsYouKind(c) !== null)
      .sort((a, b) => a.at.localeCompare(b.at)),
    working: conversations.filter((c) => WORKING_STATES.has(c.state)).sort(byAt),
    done: conversations
      .filter((c) => c.state === "done" && now - Date.parse(c.at) < DONE_WINDOW_MS)
      .sort(byAt),
  };
}

/** How long since, in a word or two: "just now", "4 min", "2 h", "3 d". */
export function elapsed(iso: string, now: number): string {
  const ms = Math.max(0, now - Date.parse(iso));
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min`;
  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    const minutes = Math.floor((ms % HOUR) / MINUTE);
    return hours < 6 && minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  }
  return `${Math.floor(ms / DAY)} d`;
}

/** When something happened, as a reader expects it: "just now", "5 min ago", "yesterday", "Mon". */
export function relativeTime(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`;
  if (ms < 2 * DAY) return "yesterday";
  if (ms < 7 * DAY) return new Date(iso).toLocaleDateString(undefined, { weekday: "short" });
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** When something is due: "now", "in 20 min", "in 2 h", "tomorrow 9:00 AM", "Mon 9:00 AM". */
export function dueIn(iso: string, now: number): string {
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return "now";
  if (ms < MINUTE) return "in a moment";
  if (ms < HOUR) return `in ${Math.ceil(ms / MINUTE)} min`;
  if (ms < 12 * HOUR) return `in ${Math.round(ms / HOUR)} h`;
  const at = new Date(iso);
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const today = new Date(now);
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const dayAfter = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2);
  if (at >= tomorrow && at < dayAfter) return `tomorrow ${time}`;
  if (at < tomorrow) return time;
  return `${at.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
}

/** The merge Aldo will make on its own, as a countdown, or null if it won't. */
export function mergeCountdown(pr: AldoHomePullRequest, now: number): string | null {
  if (!pr.mergesAt || pr.stage !== "green" || pr.status !== "watching") return null;
  const ms = Date.parse(pr.mergesAt) - now;
  if (ms <= 0) return "Aldo is merging it";
  const minutes = Math.ceil(ms / MINUTE);
  return `Aldo merges in ${minutes} min`;
}

export type ShipLane = "open" | "shipping" | "shipped";

/** Where a pull request is on its way out, or null once it's closed or no longer followed. */
export function shipLaneOf(pr: AldoHomePullRequest, now: number): ShipLane | null {
  switch (pr.stage) {
    case "draft":
    case "checks-running":
    case "checks-failing":
    case "green":
      return pr.status === "watching" ? "open" : null;
    case "deploying":
    case "deploy-failed":
      return "shipping";
    case "deployed":
    case "merged":
      return now - Date.parse(pr.updatedAt) < DONE_WINDOW_MS ? "shipped" : null;
    default:
      return null;
  }
}

export function shipLanes(
  pullRequests: ReadonlyArray<AldoHomePullRequest>,
  now: number,
): Record<ShipLane, ReadonlyArray<AldoHomePullRequest>> {
  const lanes: Record<ShipLane, AldoHomePullRequest[]> = { open: [], shipping: [], shipped: [] };
  for (const pr of pullRequests) {
    const lane = shipLaneOf(pr, now);
    if (lane) lanes[lane].push(pr);
  }
  lanes.shipped.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return lanes;
}

/** A pull request's stage in a few words, for the ship lane. */
export function stageLabel(pr: AldoHomePullRequest): string {
  switch (pr.stage) {
    case "draft":
      return "Draft";
    case "checks-running": {
      const total = pr.checks ? pr.checks.passed + pr.checks.failed + pr.checks.running : 0;
      return total ? `Checks ${pr.checks!.passed}/${total}` : "Checks running";
    }
    case "checks-failing":
      return `${pr.checks?.failed || 1} failing`;
    case "green":
      return "Green";
    case "deploying":
      return "Deploying";
    case "deployed":
      return "Deployed";
    case "deploy-failed":
      return "Deploy failed";
    case "merged":
      return "Merged";
    case "closed":
      return "Closed";
    default:
      return "Not followed";
  }
}

export type StageTone = "neutral" | "working" | "good" | "bad";

export function stageTone(pr: AldoHomePullRequest): StageTone {
  switch (pr.stage) {
    case "checks-failing":
    case "deploy-failed":
      return "bad";
    case "green":
    case "deployed":
      return "good";
    case "checks-running":
    case "deploying":
      return "working";
    default:
      return "neutral";
  }
}

/** Whether a conversation, pull request or action is news since the user last looked. */
export function isNewSince(at: string, lastSeen: string | null): boolean {
  return lastSeen !== null && at > lastSeen;
}

/** The repositories across the board, most worked in first, for the filter. */
export function repoChips(home: Pick<AldoHome, "conversations">): ReadonlyArray<string> {
  const counts = new Map<string, number>();
  for (const c of home.conversations) {
    for (const repo of c.repos) counts.set(repo, (counts.get(repo) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([repo]) => repo);
}

/** The repository's short name, with its owner only when two share a name. */
export function repoName(repo: string, all: ReadonlyArray<string>): string {
  const name = repo.split("/").at(-1) ?? repo;
  const sameName = all.filter((r) => (r.split("/").at(-1) ?? r) === name).length > 1;
  return sameName ? repo : name;
}

/** The board narrowed to one repository (every part of it). */
export function filterHome(home: AldoHome, repo: string | null): AldoHome {
  if (!repo) return home;
  const threads = new Set(
    home.conversations.filter((c) => c.repos.includes(repo)).map((c) => c.thread.environmentId),
  );
  return {
    ...home,
    conversations: home.conversations.filter((c) => c.repos.includes(repo)),
    pullRequests: home.pullRequests.filter(
      (pr) => pr.repo === repo || threads.has(pr.environmentId),
    ),
    upcoming: home.upcoming.filter((d) => threads.has(d.thread.environmentId)),
    actions: home.actions.filter((a) => !a.thread || threads.has(a.thread.environmentId)),
  };
}

/** The model a conversation runs on, short: "claude/claude-opus-4-1" reads as "claude-opus-4-1". */
export function modelName(model: string | undefined): string | null {
  if (!model) return null;
  const [, name] = model.split("/", 2);
  return name || model;
}

/** Where the selection goes on j, k, Home or End; null when the key isn't one of those. */
export function moveSelection(current: number | null, length: number, key: string): number | null {
  if (length === 0) return null;
  switch (key) {
    case "j":
    case "ArrowDown":
      return current === null ? 0 : Math.min(length - 1, current + 1);
    case "k":
    case "ArrowUp":
      return current === null ? length - 1 : Math.max(0, current - 1);
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return current;
  }
}

/** What Aldo couldn't do, when an action failed. */
const FAILED_LABELS: Record<string, string> = {
  start_thread: "Couldn't start a thread",
  message_thread: "Couldn't message a thread",
  answer_thread: "Couldn't answer a thread",
  approve_plan: "Couldn't approve a plan",
  interrupt_thread: "Couldn't stop a thread",
  rename_thread: "Couldn't rename a thread",
  archive_thread: "Couldn't archive a thread",
  unarchive_thread: "Couldn't bring a thread back",
  delete_thread: "Couldn't delete a thread",
  merge_pull_request: "Couldn't merge a pull request",
  open_pull_request: "Couldn't open a pull request",
  stop_following_pull_request: "Couldn't stop following a pull request",
  run_command: "Couldn't run a command",
  write_file: "Couldn't edit a file",
  revert_thread: "Couldn't revert a thread",
  pin_thread: "Couldn't pin a thread",
  snooze_thread: "Couldn't snooze a thread",
  settle_thread: "Couldn't settle a thread",
  answer_computer_request: "Couldn't answer a computer request",
  stop_computer: "Couldn't stop a computer",
  set_machine_size: "Couldn't change a machine's size",
  send_upcoming_now: "Couldn't send a queued message",
  cancel_upcoming: "Couldn't cancel a queued message",
};

/** What a call that undoes its tool's name couldn't do. */
const FAILED_REVERSE_LABELS: Record<string, string> = {
  pin_thread: "Couldn't unpin a thread",
  snooze_thread: "Couldn't bring back a snoozed thread",
  settle_thread: "Couldn't make a thread active again",
};

/** What Aldo did (or couldn't), in a few words, for its log: "Started a thread: Fix checkout". */
export function actionLabel(action: AldoHomeAction): string {
  const plain = action.tool.replace(/_/g, " ");
  const reverse = action.reverse === true;
  const label = action.failed
    ? ((reverse ? FAILED_REVERSE_LABELS[action.tool] : undefined) ??
      FAILED_LABELS[action.tool] ??
      `Couldn't ${plain}`)
    : ((reverse ? REVERSE_LABELS[action.tool] : undefined) ?? ACTION_LABELS[action.tool] ?? plain);
  return action.title ? `${label}: ${action.title}` : label;
}

export function deliveryLabel(delivery: AldoHomeDelivery): string {
  switch (delivery.kind) {
    case "reminder":
      return "Reminder";
    case "message":
      return "Your message";
    default:
      return "Notice";
  }
}

/** The capacity strip: agents running, credits, and what agents spent, each a few words. */
export function capacityLines(
  usage: AldoHomeUsage,
  spends: AldoHome["spends"],
): ReadonlyArray<{ readonly text: string; readonly tone: "neutral" | "warn" | "bad" }> {
  const lines: { text: string; tone: "neutral" | "warn" | "bad" }[] = [];
  const agents = usage.agents;
  lines.push({
    text:
      agents.limit !== null
        ? `${agents.running} of ${agents.limit} agent${agents.limit === 1 ? "" : "s"} running`
        : `${agents.running} agent${agents.running === 1 ? "" : "s"} running`,
    tone: agents.limit !== null && agents.running >= agents.limit ? "warn" : "neutral",
  });
  if (usage.metered && usage.credits && usage.plan) {
    const used = Math.round(usage.credits.used);
    const tone =
      usage.alert === "spend_reached" || usage.alert === "included_exhausted"
        ? "bad"
        : usage.alert === "spend_warning" || usage.alert === "included_warning"
          ? "warn"
          : "neutral";
    const projected =
      usage.credits.projected !== null && usage.credits.projected > usage.credits.included
        ? `, heading for ${Math.round(usage.credits.projected)}`
        : "";
    lines.push({
      text: `${used} of ${usage.credits.included} credits used${projected}`,
      tone,
    });
  } else if (usage.configured && !usage.metered) {
    lines.push({ text: "Complimentary plan", tone: "neutral" });
  } else if (!usage.configured) {
    lines.push({ text: "No plan yet", tone: "bad" });
  }
  if (spends.once > 0 || spends.monthly > 0) {
    const parts: string[] = [];
    if (spends.once > 0) parts.push(`$${trimMoney(spends.once)} this month`);
    if (spends.monthly > 0) parts.push(`$${trimMoney(spends.monthly)}/month`);
    lines.push({ text: `Agents spent ${parts.join(" and ")}`, tone: "neutral" });
  }
  return lines;
}

function trimMoney(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

export interface HealthIssue {
  readonly id: string;
  readonly text: string;
  readonly tone: "warn" | "bad";
  /** Where to fix it: a settings page. */
  readonly href?: string;
  /** Or something the page can do. */
  readonly action?: "enable-notifications";
}

/**
 * What's wrong with the setup, for the strip that shows only then: an agent's
 * sign-in that expired (as the user's machines report it), a plan that can't
 * run, an environment whose build failed, notifications off on this device.
 */
export function healthIssues(
  home: Pick<AldoHome, "health" | "usage">,
  notifications: "on" | "off" | "blocked" | "unavailable",
): ReadonlyArray<HealthIssue> {
  const issues: HealthIssue[] = [];
  for (const provider of home.health.providers) {
    if (!provider.signedIn) {
      issues.push({
        id: `provider-${provider.id}`,
        text: `${provider.name} is signed out on your cloud agents. Reconnect it.`,
        tone: "bad",
        href: "/settings/providers",
      });
    }
  }
  const period = home.usage.period?.status;
  if (period === "past_due") {
    issues.push({
      id: "plan",
      text: "Your last payment didn't go through, so cloud agents can't start.",
      tone: "bad",
      href: "/usage",
    });
  } else if (period === "canceled") {
    issues.push({
      id: "plan",
      text: "Your plan has ended, so cloud agents can't start.",
      tone: "bad",
      href: "/usage",
    });
  } else if (home.usage.alert === "spend_reached" || home.usage.alert === "included_exhausted") {
    issues.push({
      id: "credits",
      text: "This month's credits are used up. Raise the spending limit to keep going.",
      tone: "bad",
      href: "/usage",
    });
  } else if (home.usage.alert === "spend_warning" || home.usage.alert === "included_warning") {
    issues.push({
      id: "credits",
      text: "This month's credits are nearly used up.",
      tone: "warn",
      href: "/usage",
    });
  }
  for (const env of home.health.environments) {
    if (env.status === "failed") {
      issues.push({
        id: `env-${env.repos.join(",")}`,
        text: `The ready-to-go environment for ${env.repos.map((r) => r.split("/").at(-1) ?? r).join(" + ")} failed to build. New threads start without it.`,
        tone: "warn",
        href: "/settings/environments",
      });
    }
  }
  if (notifications === "off") {
    issues.push({
      id: "notifications",
      text: "Notifications are off on this device, so you'll only hear from agents here.",
      tone: "warn",
      action: "enable-notifications",
    });
  } else if (notifications === "blocked") {
    issues.push({
      id: "notifications",
      text: "Your browser blocks notifications for Aldo. Allow them in its site settings to hear from agents away from this tab.",
      tone: "warn",
    });
  }
  return issues;
}

/** How Aldo works for the user, from the policy agents follow, in a line each. */
export function policyLines(policy: AldoHome["policy"]): ReadonlyArray<string> {
  const lines: string[] = [];
  const everywhere = policy.everywhere;
  const describeMerge = (p: AldoPolicy) =>
    p.merge === "auto"
      ? "merges pull requests once they're green"
      : p.merge === "approve"
        ? "waits for you to merge"
        : null;
  const merge = describeMerge(everywhere);
  const perWorkspace = policy.workspaces
    .map((w) => ({ repos: w.repos, merge: describeMerge(w.policy) }))
    .filter((w) => w.merge && w.merge !== merge);
  if (merge)
    lines.push(`Aldo ${merge}${perWorkspace.length ? ", except where you said otherwise" : ""}.`);
  else if (perWorkspace.length) {
    lines.push(
      `Aldo ${perWorkspace[0]!.merge} in ${perWorkspace[0]!.repos.map((r) => r.split("/").at(-1) ?? r).join(" + ")}${
        perWorkspace.length > 1 ? " and more" : ""
      }.`,
    );
  } else
    lines.push(
      "Whether Aldo merges green pull requests itself hasn't come up yet: an agent asks the first time.",
    );
  const threshold =
    everywhere.spendThreshold ??
    policy.workspaces.find((w) => w.policy.spendThreshold !== undefined)?.policy.spendThreshold;
  if (threshold !== undefined) {
    lines.push(
      threshold > 0
        ? `Agents may spend up to $${trimMoney(threshold)} without asking.`
        : "Agents ask before spending anything.",
    );
  }
  const reviews =
    everywhere.reviews ?? policy.workspaces.find((w) => w.policy.reviews)?.policy.reviews;
  if (reviews === "all") lines.push("Agents address every automated review finding.");
  else if (reviews === "important")
    lines.push("Agents fix what matters from automated reviews and answer the rest.");
  return lines;
}

/** Things to say to Aldo, for a composer with nothing in it. */
export function composerChips(
  home: Pick<AldoHome, "conversations"> | null,
  options: { readonly conversationEmpty: boolean; readonly lastSeen: string | null },
): ReadonlyArray<string> {
  const chips: string[] = [];
  const board = home ? boardFor(home.conversations, Date.now()) : null;
  if (board && board.needsYou.length > 0) chips.push("What needs me?");
  if (options.lastSeen && home && home.conversations.length > 0) chips.push("Catch me up");
  if (board && (board.done.length > 0 || board.working.length > 0))
    chips.push("What shipped today?");
  const repo = repoChips(home ?? { conversations: [] })[0];
  if (repo) chips.push(`Start something in ${repo.split("/").at(-1) ?? repo}`);
  if (options.conversationEmpty && chips.length < 2) chips.push("What can you do?");
  return chips.slice(0, 4);
}

/** The words a chip sends: most say themselves; the catch-up names when. */
export function chipPrompt(chip: string, lastSeen: string | null, now: number): string {
  if (chip === "Catch me up") {
    const since = lastSeen ? ` since ${relativeTime(lastSeen, now)}` : "";
    return `Catch me up on what happened${since}: what finished, what shipped, and what needs me.`;
  }
  if (chip.startsWith("Start something in ")) return `${chip}: `;
  return chip;
}
