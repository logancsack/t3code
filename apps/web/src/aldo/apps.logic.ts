// Apps (AldoAppsSection.tsx): how an app's sign-in reports back to Settings,
// and which URL a user typed is worth sending to Aldo. In a popup, Aldo's
// last page posts the result to its opener and on the integrations' channel
// (so it can arrive twice); without one, it sends the page back to Settings
// with the result in the query: `?app=connected|error&message=…`.

/** What the sign-in's last page posts to this tab (and over the integrations' channel). */
export interface AldoAppResult {
  readonly ok: boolean;
  readonly title?: string;
  readonly message?: string;
}

export function parseAldoAppMessage(data: unknown): AldoAppResult | null {
  const message = data as {
    type?: unknown;
    ok?: unknown;
    title?: unknown;
    message?: unknown;
  } | null;
  if (!message || message.type !== "aldo:app" || typeof message.ok !== "boolean") return null;
  return {
    ok: message.ok,
    ...(typeof message.title === "string" ? { title: message.title } : {}),
    ...(typeof message.message === "string" ? { message: message.message } : {}),
  };
}

/** An MCP server address as typed: https, not this computer (Aldo checks the rest), with the scheme added when it's left off. */
export function normalizeAldoAppUrl(typed: string): string | null {
  const text = typed.trim();
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "https:" && url.hostname && url.hostname !== "localhost"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** The result a sign-in without a popup left in the page's query, or null when there's none. */
export function parseAldoAppRedirect(search: string): AldoAppResult | null {
  const params = new URLSearchParams(search);
  const status = params.get("app");
  if (status !== "connected" && status !== "error") return null;
  const message = params.get("message")?.trim();
  return { ok: status === "connected", ...(message ? { message } : {}) };
}

/** The query without the sign-in's result, to put back in the address bar once it's read. */
export function withoutAldoAppRedirect(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("app");
  // The integrations' own result uses message too: keep it when theirs is there.
  if (!params.has("integration")) params.delete("message");
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

/** Tells each result once: the same result again within `windowMs` is the same sign-in, arriving the second way. */
export function aldoAppResultFilter(
  windowMs = 1_000,
): (result: AldoAppResult, now: number) => boolean {
  let last: { readonly key: string; readonly at: number } | null = null;
  return (result, now) => {
    const key = JSON.stringify([result.ok, result.title ?? null, result.message ?? null]);
    if (last && last.key === key && now - last.at < windowMs) return false;
    last = { key, at: now };
    return true;
  };
}
