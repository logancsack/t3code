// Apps (AldoAppsSection.tsx): how an app's sign-in, in its popup, reports
// back to Settings, and which URL a user typed is worth sending to Aldo.

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

/** An MCP server address as typed: https only (Aldo checks the rest), with the scheme added when it's left off. */
export function normalizeAldoAppUrl(typed: string): string | null {
  const text = typed.trim();
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "https:" && url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
}
