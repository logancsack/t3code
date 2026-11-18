// Same-origin HTTP and platform identities; no feature state.

export const isAldoCloud = import.meta.env.VITE_ALDO_CLOUD === "1";

export const CONNECTION_PREFIX = "aldo:";

export function isAldoEnvironmentId(environmentId: string): boolean {
  return environmentId.startsWith("aldo-");
}

/**
 * Whether a connection is one of Aldo's machines. Its token comes from Aldo as
 * it connects (aldoEnvironmentGateway), never from the connection catalog.
 */
export function isAldoConnectionId(connectionId: string): boolean {
  return connectionId.startsWith(CONNECTION_PREFIX);
}

export function threadIdForEnvironment(environmentId: string): string {
  return environmentId.replace(/^aldo-/, "");
}

export class AldoApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** What the response said besides `error` (a refusal's plan picker, planPicker.logic.ts). */
    readonly body?: unknown,
  ) {
    super(message);
  }
}

/** The browser's time zone, which Aldo keeps for routines' times and its sense of the user's day. */
function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

/**
 * How long a read the app keeps polling (the directory, Home) waits for Aldo to
 * begin its answer. Aldo begins within 3 s even cold, so this cuts only a
 * request on a connection that died (a phone back from sleep, a network that
 * changed), which the browser can leave waiting for minutes while every later
 * read waits behind it. The answer itself takes as long as it takes, so a slow
 * network still gets it.
 */
export const ALDO_READ_ANSWERS_WITHIN_MS = 10_000;

export async function api<T>(
  path: string,
  { answersWithin, ...init }: RequestInit & { readonly answersWithin?: number } = {},
): Promise<T> {
  const zone = timeZone();
  const cut = answersWithin === undefined ? null : new AbortController();
  const timer = cut ? setTimeout(() => cut.abort(), answersWithin) : undefined;
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      ...(cut
        ? { signal: init.signal ? AbortSignal.any([init.signal, cut.signal]) : cut.signal }
        : {}),
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        ...(zone ? { "x-time-zone": zone } : {}),
        ...init.headers,
      },
    });
  } catch (cause) {
    // Unanswered, it failed as one that couldn't reach Aldo does: each caller already copes with those.
    throw cut?.signal.aborted && !init.signal?.aborted
      ? new TypeError("Aldo didn't answer in time.")
      : cause;
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 401) {
    // The Aldo session ended; send the user back through sign-in.
    window.location.assign(`/sign-in?redirect_url=${encodeURIComponent(window.location.href)}`);
    throw new AldoApiError(401, "Your Aldo session ended. Sign in again.");
  }
  // An answer cut off midway fails like one that never came, rather than reading as an empty one.
  const text = await response.text();
  const body = (parsed(text) ?? {}) as T & { error?: string };
  if (!response.ok) {
    throw new AldoApiError(
      response.status,
      body.error ?? `Request failed (${response.status})`,
      body,
    );
  }
  return body;
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
