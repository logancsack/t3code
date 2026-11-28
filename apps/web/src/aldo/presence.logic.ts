// The Home presence: the label and A-frame state under Aldo's mark, and what its
// drop-down holds (needs you, moved since you looked, working, coming up). One
// board is derived from Aldo's home read and the header and every count come
// from it, so they can't disagree.
import type { AldoAssistantPhase } from "./assistant.logic";
import { aldoComputerQueueLabel } from "./computer.logic";
import { aldoHiddenFromChat, putAway } from "./decisions.logic";
import {
  boardFor,
  deliveryLabel,
  dueIn,
  elapsed,
  isStuck,
  queuedComputer,
  relativeTime,
  sameTarget,
} from "./home.logic";
import type {
  AldoChatDecision,
  AldoHome,
  AldoHomeConversation,
  AldoHomePullRequest,
  AldoHomeTarget,
} from "./homeApi";
import { dismissedNeedsYou, hiddenNeedsYou, needsYouNow } from "./needsYou.logic";
import { parseAldoPlans, planPutOff } from "./plans.logic";

export type AldoPresenceState =
  | "idle"
  | "connecting"
  | "working"
  | "thinking"
  | "listening"
  | "speaking"
  | "reading"
  | "success"
  | "acknowledgement"
  | "needs-you"
  | "error";

export function presenceState(
  state: AldoPresenceState,
  reactions: { readonly reading: boolean; readonly success: boolean },
): AldoPresenceState {
  if (["connecting", "listening", "speaking", "thinking", "error"].includes(state)) return state;
  if (reactions.success) return "success";
  if (reactions.reading) return "reading";
  return state;
}

export function voicePresenceState(phase: AldoAssistantPhase): AldoPresenceState {
  return phase === "hearing" ? "listening" : phase;
}

/** A read older than this can't say it's all caught up. */
export const FRESH_MS = 90_000;
/** What moved is news for a day. */
const MOVED_FOR_MS = 24 * 60 * 60_000;

export type PresenceTone = "good" | "bad" | "attention" | "live" | "quiet";

/** One line in a list: opens `target` when there is one. */
export interface PresenceRow {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly tone: PresenceTone;
  readonly target: AldoHomeTarget | null;
  /** What dismissing it from Needs you names; none from an Aldo that can't dismiss. */
  readonly decision?: AldoChatDecision;
  readonly retry?: AldoHomeConversation;
}

/** A list with the one line the index row says of it. */
export interface PresenceSection {
  readonly rows: ReadonlyArray<PresenceRow>;
  readonly preview: string;
}

export interface AldoPresenceBoard {
  readonly needsYou: PresenceSection;
  /** What they dismissed from Needs you: not counted anywhere, listed to restore. */
  readonly dismissed: ReadonlyArray<PresenceRow>;
  /** What they put off ("Not now", decisions and plans): still waiting, but not counted until it's back. */
  readonly putOff: number;
  /** What they hid from Aldo's conversation with no time to come back: still waiting, never counted, listed to show again. */
  readonly hidden: number;
  readonly moved: PresenceSection;
  readonly unfinished: PresenceSection;
  readonly working: PresenceSection;
  /** Of the working, how many have reported nothing for over an hour. */
  readonly stuck: number;
  readonly coming: PresenceSection;
}

type MoveKind = "failed" | "merged" | "green" | "finished" | "replied";
interface Move {
  readonly at: string;
  readonly text: string;
  readonly kind: MoveKind;
}

/** What a pull request's stage says moved, or null (a draft, checks running or failing, closed: not news). */
function pullRequestMove(pr: AldoHomePullRequest): Move | null {
  const n = `#${pr.number}`;
  switch (pr.stage) {
    // Green and waiting for a tap to merge is Needs you's; only one that merges itself is news.
    case "green":
      return pr.status === "watching" && pr.mergesAt !== null
        ? { at: pr.greenSince ?? pr.updatedAt, text: `${n} checks passed`, kind: "green" }
        : null;
    case "deploying":
      return { at: pr.mergedAt ?? pr.updatedAt, text: `${n} merged, deploying`, kind: "merged" };
    case "deployed":
      return { at: pr.updatedAt, text: `${n} merged and live`, kind: "merged" };
    case "merged":
      return { at: pr.mergedAt ?? pr.updatedAt, text: `${n} merged`, kind: "merged" };
    case "deploy-failed":
      return { at: pr.updatedAt, text: `${n} deploy failed`, kind: "failed" };
    default:
      return null;
  }
}

/**
 * What moved in finished threads since `seenAt` (and within a day): each thread's
 * latest milestone, newest first. A thread that is working again or waits on
 * them has moved on, and shows there instead; a routine's runs count once.
 */
function movedRows(home: AldoHome, now: number, seenAt: number | null) {
  const latest = new Map<string, { c: AldoHomeConversation; move: Move }>();
  for (const c of home.conversations) {
    if (queuedComputer(c) || c.state !== "done" || putAway(c, now)) continue;
    const moves: Move[] = home.pullRequests
      .filter((pr) => sameTarget(pr.thread, c.thread))
      .flatMap((pr) => pullRequestMove(pr) ?? []);
    const reported = c.result?.state === "finished";
    moves.push({
      at: c.stateAt ?? c.at,
      text:
        c.progress?.label && !/^(?:Reported complete|Reply received)$/i.test(c.progress.label)
          ? c.progress.label
          : reported
            ? "Done"
            : "Updated",
      kind: reported ? "finished" : "replied",
    });
    // The latest wins; at the same time a pull request's word is the more telling.
    const move = moves.reduce((a, b) => (Date.parse(b.at) > Date.parse(a.at) ? b : a));
    const time = Date.parse(move.at);
    if (!(time > (seenAt ?? 0)) || now - time >= MOVED_FOR_MS) continue;
    const key = c.routine ?? c.ref;
    const kept = latest.get(key);
    if (!kept || Date.parse(kept.move.at) < time) latest.set(key, { c, move });
  }
  return [...latest.values()].sort((a, b) => b.move.at.localeCompare(a.move.at));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The drop-down's task lists. `seenAt`: when they last closed it, from which
 * what moved is counted; `answered`: decisions just made here that the read
 * hasn't caught up with.
 */
export function presenceBoard(
  home: AldoHome,
  options: {
    readonly now: number;
    readonly seenAt: number | null;
    readonly answered?: ReadonlyArray<string>;
    /** Dismissed ones being cleared (clearDismissed.ts): gone from Dismissed already. */
    readonly clearing?: ReadonlySet<string>;
  },
): AldoPresenceBoard {
  const { now } = options;

  // The one list behind every number on Home (needsYou.logic.ts needsYouNow).
  const waiting = needsYouNow(home, now, options.answered);
  const needs: PresenceRow[] = waiting.map((item) => ({
    key: item.key,
    title: item.title,
    detail: `${item.kind} · ${elapsed(item.at, now)}`,
    tone: "attention",
    target: item.thread ?? null,
    ...(item.decision ? { decision: item.decision } : {}),
  }));
  const dismissed: PresenceRow[] = dismissedNeedsYou(home, now, options.answered)
    .filter((item) => !item.decision || !options.clearing?.has(item.decision.id))
    .map((item) => ({
      key: item.key,
      title: item.title,
      detail: `${item.kind} · ${elapsed(item.at, now)}`,
      tone: "quiet",
      target: item.thread ?? null,
      ...(item.decision ? { decision: item.decision } : {}),
    }));
  const kinds = [...new Set(waiting.map((i) => i.kind))].slice(0, 2);
  const hiddenCount = hiddenNeedsYou(home, now, options.answered).filter(
    (item) => !item.hidden.until,
  ).length;
  // What the drop-down lists to bring back: put-off decisions and deferred plans.
  const putOff =
    aldoHiddenFromChat(home, now).filter((item) => item.chatDecision.until).length +
    parseAldoPlans(home.plans).filter((plan) => planPutOff(plan, now)).length;

  const moves = movedRows(home, now, options.seenAt);
  const moved: PresenceRow[] = moves.map(({ c, move }) => ({
    key: `moved:${c.ref}:${move.at}`,
    title: c.title,
    detail: `${move.text} · ${relativeTime(move.at, now)}`,
    tone: move.kind === "failed" ? "bad" : move.kind === "replied" ? "quiet" : "good",
    target: c.thread,
  }));
  const movedWords = (
    [
      ["failed", "deploy failed"],
      ["merged", "merged"],
      ["green", "checks passed"],
      ["finished", "done"],
      ["replied", "updated"],
    ] as const
  ).flatMap(([kind, words]) => {
    const n = moves.filter((m) => m.move.kind === kind).length;
    return n > 0 ? [`${n} ${words}`] : [];
  });

  const tasks = boardFor(home.conversations, now);
  const unfinished: PresenceRow[] = tasks.unfinished.map((c) => ({
    key: `unfinished:${c.ref}`,
    title: c.title,
    detail:
      c.progress?.execution === "failed"
        ? c.progress.detail
        : (c.result?.doneWhen.find((line) => !line.met && line.evidence.trim())?.evidence ??
          (c.summary && !/agent reports|task is unfinished/i.test(c.summary)
            ? c.summary
            : "The last attempt left work incomplete. Continue to try again.")),
    retry: c,
    tone: "quiet",
    target: c.thread,
  }));
  const live = tasks.working;
  const stuck = live.filter((c) => isStuck(c, now)).length;
  const working: PresenceRow[] = live.map((c) => {
    const queue = queuedComputer(c);
    const quiet = isStuck(c, now);
    const since = elapsed(quiet ? c.at : (c.stateAt ?? c.at), now);
    return {
      key: `working:${c.ref}`,
      title: c.title,
      detail: queue
        ? aldoComputerQueueLabel(queue.computer, queue.position, queue.concurrentLimit)
        : quiet
          ? `No word for ${since}`
          : `${c.summary ? `${c.summary} · ` : ""}for ${since}`,
      tone: queue || quiet ? "quiet" : "live",
      target: c.thread,
    };
  });

  const soon = [
    ...home.upcoming.map((d) => ({
      key: `delivery:${d.id}`,
      at: d.dueAt,
      title: d.message,
      detail: `${deliveryLabel(d)} · ${d.threadTitle}`,
      target: d.thread,
    })),
    ...(home.routines ?? []).flatMap((r) =>
      r.enabled && r.nextRunAt
        ? [
            {
              key: `routine:${r.id}`,
              at: r.nextRunAt,
              title: r.title,
              detail: r.when,
              target: r.thread,
            },
          ]
        : [],
    ),
  ]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map(({ at, detail, ...rest }) => ({
      when: dueIn(at, now),
      row: {
        ...rest,
        detail: `${detail} · ${dueIn(at, now)}`,
        tone: "quiet",
      } satisfies PresenceRow,
    }));

  // Retained work stays discoverable without claiming an agent is running.
  const retained: PresenceRow[] = tasks.waiting
    .filter(
      (c) =>
        !soon.some(
          (s) =>
            s.row.target &&
            s.row.target.environmentId === c.thread.environmentId &&
            s.row.target.threadId === c.thread.threadId,
        ),
    )
    .map((c) => {
      const queue = queuedComputer(c);
      return {
        key: `scheduled:${c.ref}`,
        title: c.title,
        target: c.thread,
        tone: "quiet",
        detail: queue
          ? aldoComputerQueueLabel(queue.computer, queue.position)
          : (c.progress?.detail ?? "Aldo will continue when capacity is available."),
      };
    });

  return {
    needsYou: {
      rows: needs,
      preview:
        needs.length > 0
          ? [kinds.join(" · "), hiddenCount > 0 ? `${hiddenCount} hidden from chat` : ""]
              .filter(Boolean)
              .join(" · ")
          : putOff + hiddenCount + dismissed.length > 0
            ? [
                "Nothing now",
                putOff > 0 ? `${putOff} put off` : "",
                hiddenCount > 0 ? `${hiddenCount} hidden from chat` : "",
                dismissed.length > 0 ? `${dismissed.length} dismissed` : "",
              ]
                .filter(Boolean)
                .join(" · ")
            : "Nothing waiting on you",
    },
    dismissed,
    putOff,
    hidden: hiddenCount,
    moved: {
      rows: moved,
      preview: movedWords.length > 0 ? movedWords.join(" · ") : "Nothing new since you looked",
    },
    unfinished: {
      rows: unfinished,
      preview: unfinished[0]?.title ?? "Nothing stopped",
    },
    working: {
      rows: working,
      preview:
        stuck > 0
          ? `${stuck} with no word for over an hour`
          : working.length > 0
            ? `${working[0]!.title}${working.length > 1 ? ` + ${working.length - 1} more` : ""}`
            : "Nothing running",
    },
    stuck,
    coming: {
      rows: [...soon.map((s) => s.row), ...retained],
      preview: soon[0]
        ? `${soon[0].row.title} · ${soon[0].when}`
        : (retained[0]?.detail ?? "Nothing scheduled"),
    },
  };
}

/** The header says it's all caught up only after a read this recent; before then it's checking. */
export function readIsFresh(readAt: number, now: number): boolean {
  return readAt > 0 && now - readAt < FRESH_MS;
}

export function presenceLine(input: {
  readonly phase: AldoAssistantPhase;
  readonly replying: boolean;
  /** What's working now, newest first, but for those that have reported nothing for an hour (`stuck`, counted). */
  readonly working: ReadonlyArray<Pick<AldoHomeConversation, "title" | "browsing">>;
  readonly stuck: number;
  readonly unfinished?: number;
  readonly waiting: number;
  /** Moved since they last looked. */
  readonly moved: number;
  readonly upcoming?: number;
  /** The read is recent (readIsFresh). */
  readonly fresh: boolean;
  /** Nothing's been read: what's waiting and working isn't known. */
  readonly unread?: boolean;
}): {
  readonly text: string;
  readonly state: AldoPresenceState;
  /** Which small dot leads the text. */
  readonly dot: "needs-you" | "moved" | null;
  /** Not known yet: shown quieter. */
  readonly dim?: true;
} {
  const { phase } = input;
  const none = { dot: null } as const;
  if (phase === "listening" || phase === "hearing")
    return { text: "Listening…", state: "listening", ...none };
  if (phase === "speaking") return { text: "Talking", state: "speaking", ...none };
  if (phase === "connecting") return { text: "Connecting…", state: "connecting", ...none };
  if (phase === "thinking" || input.replying)
    return { text: "Typing…", state: "thinking", ...none };
  if (phase === "error") return { text: "Tap to talk again", state: "error", ...none };
  if (input.unread) return { text: "Couldn't check on your agents", state: "error", ...none };
  const { waiting, stuck, unfinished = 0 } = input;
  const live = input.working.length;
  const [first] = input.working;
  const dot = waiting > 0 ? "needs-you" : null;
  // Show only what needs attention or is actively running now.
  const tiers = [
    waiting > 0 ? `${waiting} need${waiting === 1 ? "s" : ""} you` : null,
    unfinished > 0 ? `${unfinished} stopped` : null,
    live > 0 ? `${live} working` : null,
    stuck > 0 ? `${stuck} with no word` : null,
  ].filter((tier) => tier !== null);
  const state = waiting > 0 ? "needs-you" : live > 0 ? "working" : "idle";
  if (tiers.length > 1) return { text: tiers.slice(0, 2).join(" · "), state, dot };
  // One alone is said in full: a single task by its name (a title would hide a count).
  if (waiting > 0)
    return {
      text: waiting === 1 ? "1 thing needs you" : `${waiting} things need you`,
      state,
      dot,
    };
  if (unfinished > 0) return { text: `${plural(unfinished, "job", "jobs")} stopped`, state, dot };
  if (live > 1) return { text: `${live} working`, state, dot };
  if (live === 1 && first)
    return { text: first.browsing ? `On ${first.browsing.site}` : first.title, state, dot };
  if (stuck > 0) return { text: `${stuck} with no word`, state, dot };
  if (input.upcoming) return { text: `${input.upcoming} scheduled`, state, dot };
  return input.fresh
    ? { text: "All caught up", state: "idle", dot: null }
    : { text: "Checking…", state: "idle", dot: null, dim: true };
}
