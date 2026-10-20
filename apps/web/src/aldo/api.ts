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

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const zone = timeZone();
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...(zone ? { "x-time-zone": zone } : {}),
      ...init.headers,
    },
  });
  if (response.status === 401) {
    // The Aldo session ended; send the user back through sign-in.
    window.location.assign(`/sign-in?redirect_url=${encodeURIComponent(window.location.href)}`);
    throw new AldoApiError(401, "Your Aldo session ended. Sign in again.");
  }
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new AldoApiError(
      response.status,
      body.error ?? `Request failed (${response.status})`,
      body,
    );
  }
  return body;
}
