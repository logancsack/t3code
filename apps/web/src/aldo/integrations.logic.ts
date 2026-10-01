// How a sign-in for an integration (Settings → Integrations) reports back.
// Connecting opens Aldo's connect URL in a popup; when the provider is done,
// Aldo's callback page posts the result to this tab, both to its opener and
// on the "aldo-integrations" BroadcastChannel (a provider's Cross-Origin-
// Opener-Policy can cut the popup off from its opener). Without a popup, the
// callback sends the page back to Settings → Integrations with the result in
// the query: `?integration=microsoft&status=connected|error&message=…`.

export const ALDO_INTEGRATIONS_CHANNEL = "aldo-integrations";

export interface AldoIntegrationResult {
  readonly provider: string;
  readonly ok: boolean;
  /** Why it didn't connect, when the provider or Aldo said. */
  readonly message: string | null;
}

const REDIRECT_PARAMS = ["integration", "status", "message"] as const;

/** The result in a message from Aldo's callback page, or null for any other message. */
export function parseAldoIntegrationMessage(data: unknown): AldoIntegrationResult | null {
  if (typeof data !== "object" || data === null) return null;
  const { type, provider, ok, message } = data as Record<string, unknown>;
  if (type !== "aldo:integration" || typeof provider !== "string" || !provider) return null;
  if (typeof ok !== "boolean") return null;
  return {
    provider,
    ok,
    message: typeof message === "string" && message.trim() ? message.trim() : null,
  };
}

/** The result a callback without a popup left in the page's query, or null when there's none. */
export function parseAldoIntegrationRedirect(search: string): AldoIntegrationResult | null {
  const params = new URLSearchParams(search);
  const provider = params.get("integration")?.trim() ?? "";
  const status = params.get("status");
  if (!provider || (status !== "connected" && status !== "error")) return null;
  return {
    provider,
    ok: status === "connected",
    message: params.get("message")?.trim() || null,
  };
}

/** The query without the callback's result, to put back in the address bar once it's read. */
export function withoutAldoIntegrationRedirect(search: string): string {
  const params = new URLSearchParams(search);
  for (const name of REDIRECT_PARAMS) params.delete(name);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

/**
 * Tells each result once: the callback page sends it twice (to the opener and
 * on the channel), so the same result again within `windowMs` is the same
 * sign-in. Returns whether a result is new.
 */
export function aldoIntegrationResultFilter(
  windowMs = 1_000,
): (result: AldoIntegrationResult, now: number) => boolean {
  let last: { readonly key: string; readonly at: number } | null = null;
  return (result, now) => {
    const key = JSON.stringify([result.provider, result.ok, result.message]);
    if (last && last.key === key && now - last.at < windowMs) return false;
    last = { key, at: now };
    return true;
  };
}
