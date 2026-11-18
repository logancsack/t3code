// Assistant conversation, voice, brief and memory APIs.

import { voiceReferencesOf, type AldoVoiceReference } from "./voiceReferences";
import { artifactsField, type AldoArtifact } from "./artifacts.logic";
import { type AldoHomeTarget } from "./homeApi";
import { api, AldoApiError } from "./api";
import type { AldoAssistantMessage, AldoCall, AldoCallEntry } from "./assistant.logic";
import { aldoOnboardingFrom, type AldoInterest, type AldoOnboarding } from "./onboarding.logic";
import { keptOf, resumedOf, type AldoKept, type AldoResumed } from "./planPicker.logic";

// ---------------------------------------------------------------------------
// Aldo, the assistant

/** A realtime session with Aldo: the short-lived key the browser connects to OpenAI with. */
export interface AldoVoiceSession {
  readonly sessionId: string;
  readonly key: string;
  readonly expiresAt: number;
  readonly model: string;
  /** How long the call may go on, the period's voice minutes left (an older Aldo doesn't say: no end). */
  readonly secondsLeft?: number;
}

/**
 * Whether this Aldo has the assistant: its tool list, as JSON. An older Aldo
 * answers a path it doesn't know with the web client's own page (200, HTML),
 * so the status alone doesn't tell.
 */
/** The images a written message to Aldo takes: how many, how large each, and of which types. */
export interface AldoImageLimits {
  readonly max: number;
  readonly maxBytes: number;
  readonly types: ReadonlyArray<string>;
}

/** The files (of any kind) a written message to Aldo takes: how many, and how large each. */
export interface AldoFileLimits {
  readonly max: number;
  readonly maxBytes: number;
}

/**
 * Whether this Aldo has the assistant, and the images and files its written
 * messages take (null: none, as on an older Aldo, or one that keeps no files).
 */
export async function aldoAssistantInfo(): Promise<{
  readonly available: boolean;
  readonly images: AldoImageLimits | null;
  readonly files: AldoFileLimits | null;
}> {
  const response = await fetch("/api/assistant/tools", { credentials: "same-origin" }).catch(
    () => null,
  );
  if (!response?.ok) return { available: false, images: null, files: null };
  const body = (await response.json().catch(() => null)) as {
    tools?: unknown;
    images?: { max?: unknown; maxBytes?: unknown; types?: unknown };
    files?: { max?: unknown; maxBytes?: unknown } | null;
  } | null;
  const images = body?.images;
  const files = body?.files;
  return {
    available: Array.isArray(body?.tools),
    images:
      typeof images?.max === "number" &&
      images.max > 0 &&
      typeof images.maxBytes === "number" &&
      Array.isArray(images.types)
        ? {
            max: images.max,
            maxBytes: images.maxBytes,
            types: images.types.filter((t): t is string => typeof t === "string"),
          }
        : null,
    files:
      typeof files?.max === "number" && files.max > 0 && typeof files.maxBytes === "number"
        ? { max: files.max, maxBytes: files.maxBytes }
        : null,
  };
}

/** An image to send with a written message, as Aldo takes it. */
export interface AldoImageUpload {
  readonly name: string;
  readonly dataUrl: string;
}

/** A file a written message names, uploaded first (uploadAldoHomeFile) under its `id`. */
export interface AldoFileUpload {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

/** A written turn with Aldo: its reply, and the tool calls it made with what came of each. */
export interface AldoChatTurn {
  readonly sessionId: string;
  readonly reply: string;
  /** What the reply shows under it (artifacts.logic.ts). */
  readonly artifacts?: ReadonlyArray<AldoArtifact>;
  readonly calls: ReadonlyArray<{
    readonly callId: string;
    readonly name: string;
    readonly arguments: Record<string, unknown>;
    readonly outcome: unknown;
  }>;
}

/** How long a written message waits to be taken in, and its answer to be asked for (which Aldo holds for 8 s), before the connection is taken as dead. */
const ALDO_SEND_ANSWERS_WITHIN_MS = 20_000;
const ALDO_TURN_ANSWERS_WITHIN_MS = 20_000;
const ALDO_LEGACY_SEND_ANSWERS_WITHIN_MS = 90_000;

/** What Aldo says to a message sent by id: it has it, or (an older Aldo) the whole turn. */
export type AldoSent =
  | { readonly kind: "taken"; readonly sessionId: string }
  | { readonly kind: "answered"; readonly turn: AldoChatTurn };

function turnOf(sessionId: string, reply: string, body: Partial<AldoChatTurn>): AldoChatTurn {
  return {
    sessionId,
    reply,
    calls: Array.isArray(body.calls) ? body.calls : [],
    ...artifactsField(body.artifacts),
  };
}

/** A call on GPT-Live: Aldo's session for it, and OpenAI's answer to the browser's WebRTC offer. */
export interface AldoLiveVoice {
  readonly sessionId: string;
  readonly sdp: string;
  readonly model: string;
  /** How long the call may go on, the period's voice minutes left (an older Aldo doesn't say: no end). */
  readonly secondsLeft?: number;
}

/** A call's `secondsLeft`, when Aldo says it. */
function secondsLeftOf(value: unknown): { readonly secondsLeft?: number } {
  return typeof value === "number" && Number.isFinite(value) ? { secondsLeft: value } : {};
}

/** What Aldo did with a request the voice handed over, and what the voice should say. */
export interface AldoDelegated {
  readonly references?: ReadonlyArray<AldoVoiceReference>;
  readonly say: string;
  readonly calls: AldoChatTurn["calls"];
}

/**
 * Something for a conversation to tell the user unprompted (Aldo's
 * src/lib/assistant/followups.ts): work it handed to a thread that came back
 * (done, waiting on the user, failed, or queued to start), or what an agent
 * told the user itself (notice). `say` is the line; it's claimed once
 * (claimFollowup) just before it's said.
 */
export interface AldoFollowupNews {
  readonly id: string;
  readonly outcome: string;
  readonly state: "done" | "waiting" | "failed" | "queued" | "notice";
  readonly title: string;
  readonly say: string;
  readonly thread: AldoHomeTarget;
}

/** What's back to tell, and how much is still working (for how soon to ask again). */
export interface AldoFollowups {
  readonly news: ReadonlyArray<AldoFollowupNews>;
  readonly following: number;
}

const FOLLOWUP_STATES = new Set(["done", "waiting", "failed", "queued", "notice"]);

function followupNewsOf(value: unknown): AldoFollowupNews | null {
  const n = value as Partial<Record<keyof AldoFollowupNews, unknown>> | null;
  const thread = n?.thread as Partial<AldoHomeTarget> | undefined;
  if (
    typeof n?.id !== "string" ||
    typeof n.outcome !== "string" ||
    typeof n.state !== "string" ||
    !FOLLOWUP_STATES.has(n.state) ||
    typeof n.say !== "string" ||
    typeof thread?.environmentId !== "string" ||
    typeof thread.threadId !== "string"
  )
    return null;
  return {
    id: n.id,
    outcome: n.outcome,
    state: n.state as AldoFollowupNews["state"],
    title: typeof n.title === "string" ? n.title : "",
    say: n.say,
    thread: { environmentId: thread.environmentId, threadId: thread.threadId },
  };
}

/** The cards the page on screen shows in Aldo's conversation (AldoConversationPage.tsx: a plan). */
let shownCards: ReadonlyArray<string> = [];

/**
 * Tells Aldo, with each written turn, which cards the page on screen shows:
 * what it would show as one is said in words where none is (the summon bar's
 * answer, say). Returns what puts it back.
 */
export function showAldoCards(cards: ReadonlyArray<string>): () => void {
  shownCards = cards;
  return () => {
    if (shownCards === cards) shownCards = [];
  };
}

/**
 * The cards a written turn says the page shows: the page's, and what any
 * reply shows under it (AldoArtifacts.tsx), with every type of chart
 * (AldoChart.tsx: "charts"; an older page draws bars and lines alone).
 */
const cardsShown = () => [...new Set([...shownCards, "artifacts", "charts"])];

/**
 * The conversation as Aldo keeps it (`history`): messages, and with an Aldo that draws calls as cards
 * (`calls`) each voice call as one `call` item where it began.
 */
export type AldoHistory = ReadonlyArray<AldoAssistantMessage | AldoCallEntry> & {
  readonly calls?: boolean;
};

function withArtifacts<T extends { artifacts?: unknown }>({ artifacts, ...rest }: T) {
  return { ...rest, ...artifactsField(artifacts) };
}

export const aldoAssistant = {
  /** A realtime session, for an Aldo from before GPT-Live (startLive returned null). */
  startSession: async (): Promise<AldoVoiceSession> => {
    const { secondsLeft, ...session } = await api<AldoVoiceSession>("/api/assistant/session", {
      method: "POST",
    });
    return { ...session, ...secondsLeftOf(secondsLeft) };
  },
  /**
   * A call on GPT-Live, made by Aldo from the browser's offer (Aldo's
   * src/lib/assistant/session.ts); null where this Aldo doesn't have it (an
   * older one, or one that's turned it off), which then takes a realtime call.
   */
  startLive: async (sdp: string): Promise<AldoLiveVoice | null> => {
    const body = await api<Partial<AldoLiveVoice>>("/api/assistant/live", {
      method: "POST",
      // This page tells the call what comes back of work it hands over (followups), so the voice may promise it.
      body: JSON.stringify({ sdp, followups: true }),
    }).catch((error: unknown) => {
      if (error instanceof AldoApiError && (error.status === 404 || error.status === 405))
        return null;
      throw error;
    });
    if (!body || typeof body.sdp !== "string" || typeof body.sessionId !== "string") return null;
    return {
      sessionId: body.sessionId,
      sdp: body.sdp,
      model: typeof body.model === "string" ? body.model : "",
      ...secondsLeftOf(body.secondsLeft),
    };
  },
  /**
   * Has Aldo do what the voice handed over (src/lib/assistant/delegation.ts):
   * the call's transcript so far, what the user typed on it if that's what
   * this is, and the thread on screen.
   */
  references: async (
    sessionId: string,
    text: string,
    thread?: AldoHomeTarget,
  ): Promise<AldoVoiceReference[]> => {
    const body = await api<{ references?: unknown }>("/api/assistant/references", {
      method: "POST",
      body: JSON.stringify({ sessionId, text, ...(thread ? { thread } : {}) }),
    });
    return voiceReferencesOf(body.references);
  },
  delegate: async (
    sessionId: string,
    transcript: ReadonlyArray<{ role: "user" | "assistant"; text: string }>,
    typed: string | null,
    viewing: AldoHomeTarget | null,
    /** Stops it (a newer request, a hangup): Aldo starts nothing after that. */
    signal?: AbortSignal,
    /** It replaced an earlier request still being worked on. */
    stopped = false,
  ): Promise<AldoDelegated> => {
    const body = await api<Partial<AldoDelegated>>("/api/assistant/delegate", {
      method: "POST",
      ...(signal ? { signal } : {}),
      body: JSON.stringify({
        ...(stopped ? { stopped } : {}),
        sessionId,
        followups: true,
        cards: ["references"],
        transcript,
        ...(typed ? { typed } : {}),
        ...(viewing ? { viewing } : {}),
      }),
    });
    return {
      references: voiceReferencesOf(body.references),
      say: typeof body.say === "string" ? body.say : "",
      calls: Array.isArray(body.calls) ? body.calls : [],
    };
  },
  /**
   * A written message, typed without a call (Aldo's src/lib/assistant/chat.ts),
   * by the `id` the page gave it: Aldo takes it in once, however often it's
   * sent, and answers at once that it has it (`taken`, with the session
   * the page named, or the one Aldo made); its answer is asked for apart
   * (`turn`). An older Aldo ignores the id and answers in the same request
   * (`answered`). Null where this Aldo can't chat in writing (an older one
   * answers a path it doesn't know with the web client's own page). `viewing`
   * is the thread on screen, which Aldo names for "this one" (an older Aldo
   * ignores it). The page shows a plan picker (`planPicker`): refused for want
   * of a plan, Aldo keeps the request and its 402 carries the picker's
   * (needsPlanOf on the error's body); an older Aldo ignores it.
   */
  send: async (
    id: string,
    sessionId: string | null,
    text: string,
    images: ReadonlyArray<AldoImageUpload> = [],
    files: ReadonlyArray<AldoFileUpload> = [],
    viewing: AldoHomeTarget | null = null,
    takesIds = false,
  ): Promise<AldoSent | null> => {
    const body = await api<Partial<AldoChatTurn> & { accepted?: boolean }>("/api/assistant/chat", {
      method: "POST",
      // Taking a message in is quick: one that isn't answered is on a connection that died, and is sent again.
      // An older Aldo answers when the turn is done, and is not to be cut off (`takesIds`: this one is known to take ids).
      answersWithin: takesIds ? ALDO_SEND_ANSWERS_WITHIN_MS : ALDO_LEGACY_SEND_ANSWERS_WITHIN_MS,
      body: JSON.stringify({
        id,
        sessionId,
        text,
        ...(images.length > 0 ? { images } : {}),
        ...(files.length > 0 ? { files } : {}),
        ...(viewing ? { viewing } : {}),
        planPicker: true,
        // What the page shows as cards, which Aldo would otherwise say in words (an older Aldo ignores it).
        cards: cardsShown(),
      }),
    });
    if (typeof body.sessionId !== "string") return null;
    if (body.accepted) return { kind: "taken", sessionId: body.sessionId };
    return typeof body.reply === "string"
      ? { kind: "answered", turn: turnOf(body.sessionId, body.reply, body) }
      : null;
  },
  /**
   * Aldo's answer to the message `id` (sent with `send`), once it has one:
   * "pending" after a few seconds of waiting, to be asked again; "unknown"
   * when Aldo doesn't have the message. A turn that failed throws an error
   * whose body says `failed`; anything else that throws is the ask's own and
   * can be made again.
   */
  turn: async (id: string): Promise<AldoChatTurn | "pending" | "unknown"> => {
    const body = await api<Partial<AldoChatTurn> & { pending?: boolean }>(
      `/api/assistant/chat?id=${encodeURIComponent(id)}`,
      { answersWithin: ALDO_TURN_ANSWERS_WITHIN_MS, cache: "no-store" },
    ).catch((error: unknown) => {
      if (error instanceof AldoApiError && error.status === 404) return null;
      throw error;
    });
    if (!body) return "unknown";
    if (body.pending) return "pending";
    if (typeof body.reply !== "string" || typeof body.sessionId !== "string") {
      throw new TypeError("Aldo's answer couldn't be read.");
    }
    return turnOf(body.sessionId, body.reply, body);
  },
  /** The request Aldo keeps from before a plan was chosen; null where it doesn't keep them (an older Aldo) or couldn't say. */
  /** Null where Aldo keeps none (an older one); throws when it can't be reached, so the page can ask again. */
  kept: async (): Promise<AldoKept | null> =>
    keptOf(
      await api<unknown>("/api/assistant/pending").catch((error: unknown) => {
        if (error instanceof AldoApiError && error.status === 404) return null;
        throw error;
      }),
    ),
  /**
   * Sends the request Aldo kept (`requestId`) as the user's message, once a
   * plan lets it go; back from Checkout, `checkoutSession` lets Aldo confirm
   * the plan at once. Never throws: what came of it is the answer.
   */
  resume: async (
    requestId: string,
    sessionId: string | null,
    checkoutSession: string | null,
  ): Promise<AldoResumed> =>
    resumedOf(
      await api<unknown>("/api/assistant/chat", {
        method: "POST",
        body: JSON.stringify({
          resume: requestId,
          ...(sessionId ? { sessionId } : {}),
          ...(checkoutSession ? { checkoutSession } : {}),
          cards: cardsShown(),
        }),
      }).then(
        (body) => ({ ok: true as const, body }),
        (error: unknown) => ({
          ok: false as const,
          status: error instanceof AldoApiError ? error.status : 0,
          message: error instanceof Error ? error.message : String(error),
          body: error instanceof AldoApiError ? error.body : undefined,
        }),
      ),
    ),
  /**
   * What the conversation (`sessionId`) has to tell the user unprompted;
   * null where this Aldo doesn't have it (an older one answers a path it
   * doesn't know with the web client's own page).
   */
  followups: async (sessionId: string): Promise<AldoFollowups | null> => {
    const body = await api<Partial<{ news: unknown; following: unknown }>>(
      `/api/assistant/followups?sessionId=${encodeURIComponent(sessionId)}`,
    ).catch((error: unknown) => {
      if (error instanceof AldoApiError && (error.status === 404 || error.status === 405))
        return null;
      throw error;
    });
    if (!body || !Array.isArray(body.news)) return null;
    return {
      news: body.news.flatMap((n) => followupNewsOf(n) ?? []),
      following: typeof body.following === "number" ? body.following : 0,
    };
  },
  /** Takes news to say now: its line, the first time it's asked for while it still stands; null otherwise. */
  claimFollowup: async (sessionId: string, id: string, outcome: string): Promise<string | null> => {
    const body = await api<{ say?: unknown }>("/api/assistant/followups", {
      method: "POST",
      body: JSON.stringify({ sessionId, id, outcome }),
    });
    return typeof body.say === "string" && body.say ? body.say : null;
  },
  /** Runs a tool the model called: { result } or, for a refusal the model should hear, { error }. */
  runTool: (
    name: string,
    args: Record<string, unknown>,
    sessionId: string | null,
    heard: ReadonlyArray<string>,
  ) =>
    api<{ result?: unknown; error?: string }>(`/api/assistant/tools/${encodeURIComponent(name)}`, {
      method: "POST",
      body: JSON.stringify({ arguments: args, sessionId, heard, cards: ["references"] }),
    }),
  /**
   * Adds what was said in a session. `ended` says the call hung up, its last words in:
   * Aldo writes its summary then. `call: false` is a line that isn't a turn of the call (news it never said).
   */
  record: (
    sessionId: string,
    items: ReadonlyArray<{ role: "user" | "assistant"; text: string; call?: false }>,
    ended = false,
  ) =>
    api("/api/assistant/history", {
      method: "POST",
      body: JSON.stringify({ sessionId, items, ...(ended ? { ended } : {}) }),
    }),
  /**
   * The conversation, oldest first. An Aldo that draws calls as cards (`calls`) returns each voice call as one
   * `call` item where it began, not its turns; an older one returns every turn, and says so.
   */
  history: async (limit = 50): Promise<AldoHistory> => {
    const body = await api<{
      messages: Array<
        | {
            role: "user" | "assistant";
            text: string;
            at: string;
            source?: "brief";
            artifacts?: unknown;
            clientId?: string;
          }
        | { call: Omit<AldoCall, "at">; at: string }
      >;
      calls?: boolean;
    }>(`/api/assistant/history?limit=${limit}&calls=1`);
    return Object.assign(
      body.messages.map((m) =>
        "call" in m
          ? ({ kind: "call", ...m.call, at: m.at } satisfies AldoCallEntry)
          : withArtifacts(m),
      ),
      { calls: body.calls === true },
    );
  },
  /** What was said on a call (its card opens it), oldest first. */
  callTranscript: async (id: string) =>
    (
      await api<{ turns: Array<{ role: "user" | "assistant"; text: string; at: string }> }>(
        `/api/assistant/calls/${encodeURIComponent(id)}`,
      )
    ).turns,
};

/** One of the brief's things to decide first; `key` is its decision's (decisions.logic.ts). */
export interface AldoBriefItem {
  readonly key: string;
  /** What it was, for once it's decided (an older Aldo leaves it out). */
  readonly title?: string;
  /** Why it matters now, in a few words. */
  readonly why: string | null;
  /** For a question: the choice Aldo would pick, with why. */
  readonly suggestion: string | null;
  readonly reason: string | null;
}

/**
 * One item in the brief's groups: the thread it's about (null for an
 * approval of no thread's), what that's called and a line on it. `key` is a
 * decision's (decisions.logic.ts), so it shows as decided once it is; `why`
 * Aldo's few words on why it matters now; `until` when what can wait is back.
 */
export interface AldoBriefGroupItem {
  readonly key?: string;
  readonly thread: { readonly environmentId: string; readonly threadId: string } | null;
  readonly workstream: string;
  readonly text: string;
  readonly why?: string;
  readonly until?: string;
}

/** What the brief is about: what needs the user, what Aldo's watching, what can wait, and what's good to know. */
export interface AldoBriefGroups {
  readonly needs: ReadonlyArray<AldoBriefGroupItem>;
  readonly watching: ReadonlyArray<AldoBriefGroupItem>;
  readonly later: ReadonlyArray<AldoBriefGroupItem>;
  readonly fyi: ReadonlyArray<AldoBriefGroupItem>;
}

/** Aldo's brief for the day: the first time the user opens Aldo each day, or at the time they chose. */
export interface AldoBrief {
  readonly day: string;
  /** When it was made: when it was said in the conversation. */
  readonly at: string;
  readonly title: string;
  readonly text: string;
  readonly top: ReadonlyArray<AldoBriefItem>;
  /** The rest of today's calendar. */
  readonly ahead: ReadonlyArray<{
    readonly title: string;
    readonly start: string;
    readonly allDay: boolean;
  }>;
  /** Its first line, "Morning, Sam. 2 of your 5 things need you today." (an older Aldo leaves it out). */
  readonly headline?: string;
  /** What it's about, by group (an older Aldo leaves them out). */
  readonly groups?: AldoBriefGroups;
}

/**
 * Today's brief, made by this ask if it's the day's first (a few seconds);
 * `pending` while another ask makes it. Null for an Aldo without briefs.
 */
export async function fetchAldoBrief(): Promise<{
  readonly brief: AldoBrief | null;
  readonly pending?: boolean;
} | null> {
  try {
    return await api<{ brief: AldoBrief | null; pending?: boolean }>("/api/assistant/brief");
  } catch (cause) {
    if (cause instanceof AldoApiError && cause.status === 404) return null;
    throw cause;
  }
}

/** A day's brief read aloud (an mp3 the browser keeps for the day). */
export function aldoBriefAudioUrl(day: string): string {
  return `/api/assistant/brief/audio?day=${encodeURIComponent(day)}`;
}

/** The signed-in user, for the sidebar and the account dialog. */
export interface AldoProfile {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly imageUrl: string | null;
  /** Where they manage their sign-in (name, email, password, sessions). */
  readonly manageUrl: string;
  readonly signOutUrl: string;
  /** The owner's admin pages; null for everyone else, and on an Aldo without them. */
  readonly adminUrl: string | null;
  /** The welcome on Home (onboarding.logic.ts); null on an Aldo without it. */
  readonly onboarding: AldoOnboarding | null;
  /** The organization they're in, by name; null in none, and on an Aldo without organizations. */
  readonly organization: string | null;
}

/** Who's signed in; null where this Aldo can't say (an older one answers with the client's page). */
export async function fetchAldoProfile(): Promise<AldoProfile | null> {
  const body = await api<Partial<AldoProfile> & { org?: { name?: unknown } }>("/api/account").catch(
    () => null,
  );
  return body && typeof body.email === "string" && typeof body.id === "string"
    ? {
        id: body.id,
        email: body.email,
        name: typeof body.name === "string" && body.name.trim() ? body.name : null,
        imageUrl: typeof body.imageUrl === "string" && body.imageUrl ? body.imageUrl : null,
        manageUrl: typeof body.manageUrl === "string" ? body.manageUrl : "/account",
        signOutUrl: typeof body.signOutUrl === "string" ? body.signOutUrl : "/sign-out",
        // A path on this site only: not `//host` or `/\host`, which browsers read as another.
        adminUrl:
          typeof body.adminUrl === "string" && /^\/(?![/\\])/.test(body.adminUrl)
            ? body.adminUrl
            : null,
        onboarding: aldoOnboardingFrom(body),
        organization: typeof body.org?.name === "string" && body.org.name ? body.org.name : null,
      }
    : null;
}

let profileRequest: Promise<AldoProfile | null> | null = null;

/** Who's signed in, asked once per page. */
export function requestAldoProfile(): Promise<AldoProfile | null> {
  profileRequest ??= fetchAldoProfile().catch(() => null);
  return profileRequest;
}

/** Keeps what they'll hand Aldo first (empty for a skip); the welcome's state as Aldo kept it. */
export async function saveAldoInterests(
  interests: ReadonlyArray<AldoInterest>,
): Promise<AldoOnboarding | null> {
  const body = await api<unknown>("/api/account", {
    method: "PATCH",
    body: JSON.stringify({ interests }),
  });
  return aldoOnboardingFrom(body);
}

/** What Aldo knows about the user: its profile of them and its notes. */
export interface AldoMemoryItem {
  readonly id: string;
  readonly kind: "profile" | "note";
  readonly title: string;
  readonly body: string;
  /** Who wrote it last: aldo (in conversation), consolidation (after one), or user. */
  readonly source: string;
  readonly updatedAt: string;
}

export const aldoMemory = {
  list: async () => {
    const { items } = await api<{ items?: AldoMemoryItem[] }>("/api/assistant/memory");
    // An older Aldo answers with the web client's page: it has no memory.
    if (!Array.isArray(items))
      throw new AldoApiError(404, "This Aldo server doesn't have memory yet.");
    return items;
  },
  saveProfile: async (body: string) =>
    (
      await api<{ items: AldoMemoryItem[] }>("/api/assistant/memory", {
        method: "POST",
        body: JSON.stringify({ kind: "profile", body }),
      })
    ).items,
  saveNote: async (title: string, body: string) =>
    (
      await api<{ items: AldoMemoryItem[] }>("/api/assistant/memory", {
        method: "POST",
        body: JSON.stringify({ kind: "note", title, body }),
      })
    ).items,
  forget: async (id: string) =>
    (
      await api<{ items: AldoMemoryItem[] }>(`/api/assistant/memory?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
    ).items,
};
