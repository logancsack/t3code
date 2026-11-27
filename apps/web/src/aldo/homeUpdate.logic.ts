import type { AldoConversationEntry } from "./assistantSession";
import type { AldoHomeConversation } from "./homeApi";
import { closingThread } from "./assistant.logic";
import { linkRows } from "./artifacts.logic";
import type { AldoAssistantMessage, AldoOpenTarget } from "./assistant.logic";

/** Immutable presentation of one outcome; never authorizes a task action. */
export interface AldoHomeUpdate {
  readonly id: string;
  readonly title: string;
  readonly thread: AldoOpenTarget | null;
  readonly state:
    | "done"
    | "needs-you"
    | "working"
    | "scheduled"
    | "unfinished"
    | "failed"
    | "update";
  readonly summary: string;
  readonly checked: ReadonlyArray<string>;
  readonly notChecked: ReadonlyArray<string>;
  readonly notes?: ReadonlyArray<string>;
  readonly links: ReadonlyArray<{ readonly label: string; readonly url: string }>;
  /** The agent's own final answer (Markdown), when it says more than the summary. */
  readonly answer?: string;
  /** Every link the answer gave, when there are more than `links`. */
  readonly sources?: ReadonlyArray<{ readonly label: string; readonly url: string }>;
  /** It failed after making what's linked: that's what it made before, not the result. */
  readonly partial?: boolean;
  readonly next?: {
    readonly owner: "aldo" | "you" | "none";
    readonly kind: string;
    readonly at?: string;
  };
}

const states = new Set([
  "done",
  "needs-you",
  "working",
  "scheduled",
  "unfinished",
  "failed",
  "update",
]);
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= 12 && v.every((s) => typeof s === "string" && s.length <= 800);
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
/** The most of an answer and of its sources a Home update carries (src/lib/assistant/results.ts in Aldo). */
const ANSWER_CHARS = 20_000;
const MAX_SOURCES = 40;

export function safeUpdateUrl(v: unknown): v is string {
  if (typeof v !== "string" || /[\s\\]/.test(v)) return false;
  if (/^\/(?!\/)/.test(v)) return true;
  try {
    const url = new URL(v);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function homeUpdateOf(value: unknown): AldoHomeUpdate | null {
  if (
    !record(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.summary !== "string" ||
    typeof value.state !== "string" ||
    !states.has(value.state) ||
    !strings(value.checked) ||
    !strings(value.notChecked) ||
    (value.notes !== undefined && !strings(value.notes)) ||
    !Array.isArray(value.links) ||
    value.links.length > 8 ||
    !value.links.every((l) => record(l) && typeof l.label === "string" && safeUpdateUrl(l.url))
  )
    return null;
  if (
    value.thread !== null &&
    (!record(value.thread) ||
      typeof value.thread.environmentId !== "string" ||
      typeof value.thread.threadId !== "string")
  )
    return null;
  const next =
    record(value.next) &&
    ["aldo", "you", "none"].includes(String(value.next.owner)) &&
    typeof value.next.kind === "string"
      ? {
          owner: value.next.owner as "aldo" | "you" | "none",
          kind: value.next.kind,
          ...(typeof value.next.at === "string" ? { at: value.next.at } : {}),
        }
      : undefined;
  return {
    id: value.id,
    title: value.title,
    thread: value.thread as AldoOpenTarget | null,
    state: value.state as AldoHomeUpdate["state"],
    summary: value.summary,
    checked: value.checked,
    notChecked: value.notChecked,
    ...(value.notes ? { notes: value.notes as string[] } : {}),
    links: value.links as { label: string; url: string }[],
    // Optional and newer than the rest: one that doesn't fit is left out, not the whole update.
    ...(typeof value.answer === "string" &&
    value.answer.trim() &&
    value.answer.length <= ANSWER_CHARS
      ? { answer: value.answer }
      : {}),
    ...(Array.isArray(value.sources) &&
    value.sources.length <= MAX_SOURCES &&
    value.sources.every((l) => record(l) && typeof l.label === "string" && safeUpdateUrl(l.url))
      ? { sources: value.sources as { label: string; url: string }[] }
      : {}),
    ...(value.partial === true ? { partial: true } : {}),
    ...(next ? { next } : {}),
  };
}

export const UPDATE_STATE_LABELS: Record<AldoHomeUpdate["state"], string> = {
  done: "Done",
  "needs-you": "Needs you",
  working: "Still working",
  scheduled: "Scheduled",
  unfinished: "More to do",
  failed: "Couldn’t finish",
  update: "Update",
};

/** Display-only compatibility for the old, explicit result envelope. Stored history is untouched. */
export function legacyHomeUpdate(text: string): AldoHomeUpdate | null {
  const closing = closingThread(text);
  if (!closing) return null;
  const { text: body, links } = linkRows(closing.text);
  const proofAt = body.indexOf("\n\nChecks reported with the task:");
  const summary = (proofAt >= 0 ? body.slice(0, proofAt) : body)
    .replace(/\n*The task is unfinished; its next step is saved\./g, "")
    .trim();
  const proof = proofAt >= 0 ? body.slice(proofAt) : "";
  const checks = /(?:^|\n)Checked:\n([\s\S]*?)(?=\n\nNot checked:|$)/.exec(proof)?.[1];
  const notChecked = /(?:^|\n)Not checked:\n([\s\S]*)/.exec(proof)?.[1];
  const state = /haven['’]t finished|task is unfinished|Work unfinished/i.test(summary)
    ? "unfinished"
    : /need your input|waiting for your input/i.test(summary)
      ? "needs-you"
      : /release checks|still being followed/i.test(summary)
        ? "scheduled"
        : /ran into trouble|couldn['’]t finish|could not finish/i.test(summary)
          ? "failed"
          : "update";
  const internal = internalHomeCopy(summary);
  const fallback =
    state === "unfinished"
      ? "I haven’t finished this work yet."
      : state === "needs-you"
        ? "I need your answer before I can continue."
        : state === "scheduled"
          ? "I’m checking the update before it goes live."
          : state === "failed"
            ? "I couldn’t finish this attempt."
            : "I have an update on this work.";
  return {
    id: `legacy:${closing.thread.environmentId}/${closing.thread.threadId}:${text}`,
    title: "Work update",
    thread: closing.thread,
    state,
    summary: internal ? fallback : summary || fallback,
    checked: checks ? [checks.trim()] : [],
    notChecked: notChecked ? [notChecked.trim()] : [],
    ...(internal ? { notes: [summary] } : {}),
    links: links.map((l) => ({ label: l.title, url: l.url })),
  };
}

/** A result card that can carry Home's live or release progress. Existing asks have their own cards. */
export function progressUpdate(
  message: Pick<AldoAssistantMessage, "text" | "update" | "call" | "source">,
): AldoHomeUpdate | null {
  if (message.call !== undefined || message.source === "brief") return null;
  const update = message.update ?? legacyHomeUpdate(message.text);
  return update?.state === "needs-you" ? null : update;
}

/** Source-code review links are evidence; documents and other deliverables stay visible. */
export const technicalUpdateLink = (url: string) =>
  /\/(?:pull|pull-requests|merge_requests)\/\d+|\/_git\/.+\/pullrequest\//i.test(url);

/** Old thread notes are evidence, never a voice example for Home. */
function internalHomeCopy(text: string): boolean {
  return /the agent|\blint\b|type[ -]?check|\bCI\b|\bPRs?\b|\d[\d,]* (?:(?:deterministic |reliability |focused )*(?:tests?|checks?)|passed\b)|\bdeploy(?:ed|ment)?\b|release checks|still being followed|https?:\/\//i.test(
    text,
  );
}

/** The saved report represented by a current decision, including older stored envelopes. */
export function currentDecisionReport(
  entries: ReadonlyArray<AldoConversationEntry>,
  conversation: Pick<AldoHomeConversation, "thread" | "stateAt" | "at">,
  state: "failed" | "needs-you",
) {
  const since = Date.parse(conversation.stateAt ?? conversation.at) - 2_000;
  return entries.findLast((e) => {
    if (e.kind !== "message" || e.role !== "assistant" || !(Date.parse(e.at) >= since))
      return false;
    const update = e.update ?? legacyHomeUpdate(e.text);
    return (
      update?.state === state &&
      update.thread?.environmentId === conversation.thread.environmentId &&
      update.thread?.threadId === conversation.thread.threadId
    );
  });
}
