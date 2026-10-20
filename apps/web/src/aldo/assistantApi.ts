// Assistant conversation, voice, brief and memory APIs.

import { type AldoHomeTarget } from "./homeApi";
import { api, AldoApiError } from "./api";
import { aldoOnboardingFrom, type AldoInterest, type AldoOnboarding } from "./onboarding.logic";

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

/** Whether this Aldo has the assistant, and the images its written messages take (null: none, as on an older Aldo). */
export async function aldoAssistantInfo(): Promise<{
  readonly available: boolean;
  readonly images: AldoImageLimits | null;
}> {
  const response = await fetch("/api/assistant/tools", { credentials: "same-origin" }).catch(
    () => null,
  );
  if (!response?.ok) return { available: false, images: null };
  const body = (await response.json().catch(() => null)) as {
    tools?: unknown;
    images?: { max?: unknown; maxBytes?: unknown; types?: unknown };
  } | null;
  const images = body?.images;
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
  };
}

/** An image to send with a written message, as Aldo takes it. */
export interface AldoImageUpload {
  readonly name: string;
  readonly dataUrl: string;
}

/** A written turn with Aldo: its reply, and the tool calls it made with what came of each. */
export interface AldoChatTurn {
  readonly sessionId: string;
  readonly reply: string;
  readonly calls: ReadonlyArray<{
    readonly callId: string;
    readonly name: string;
    readonly arguments: Record<string, unknown>;
    readonly outcome: unknown;
  }>;
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
        transcript,
        ...(typed ? { typed } : {}),
        ...(viewing ? { viewing } : {}),
      }),
    });
    return {
      say: typeof body.say === "string" ? body.say : "",
      calls: Array.isArray(body.calls) ? body.calls : [],
    };
  },
  /**
   * A written turn, typed without a call (Aldo's src/lib/assistant/chat.ts);
   * null where this Aldo can't chat in writing (an older one answers a path
   * it doesn't know with the web client's own page). `viewing` is the thread
   * on screen, which Aldo names for "this one" (an older Aldo ignores it).
   */
  chat: async (
    sessionId: string | null,
    text: string,
    images: ReadonlyArray<AldoImageUpload> = [],
    viewing: AldoHomeTarget | null = null,
  ): Promise<AldoChatTurn | null> => {
    const body = await api<Partial<AldoChatTurn>>("/api/assistant/chat", {
      method: "POST",
      body: JSON.stringify({
        sessionId,
        text,
        ...(images.length > 0 ? { images } : {}),
        ...(viewing ? { viewing } : {}),
      }),
    });
    if (typeof body.reply !== "string" || typeof body.sessionId !== "string") return null;
    return {
      sessionId: body.sessionId,
      reply: body.reply,
      calls: Array.isArray(body.calls) ? body.calls : [],
    };
  },
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
      body: JSON.stringify({ arguments: args, sessionId, heard }),
    }),
  record: (sessionId: string, items: ReadonlyArray<{ role: "user" | "assistant"; text: string }>) =>
    api("/api/assistant/history", { method: "POST", body: JSON.stringify({ sessionId, items }) }),
  history: async (limit = 50) =>
    (
      await api<{
        messages: Array<{ role: "user" | "assistant"; text: string; at: string; source?: "brief" }>;
      }>(`/api/assistant/history?limit=${limit}`)
    ).messages,
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

/** Aldo's brief for the day: the first time the user opens Aldo each day. */
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
}

/** Who's signed in; null where this Aldo can't say (an older one answers with the client's page). */
export async function fetchAldoProfile(): Promise<AldoProfile | null> {
  const body = await api<Partial<AldoProfile>>("/api/account").catch(() => null);
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
