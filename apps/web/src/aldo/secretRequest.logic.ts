// An agent's request_secret link opens Settings → Vault with the secret's form
// filled in: `?request=NAME&delivery=env|request|file&why=…&thread=…&t3=…`,
// plus `hosts`, `path` or `scope`. The user pastes the value (the agent never
// sees it); saving tells the thread that asked (Aldo's POST /api/vault).

import type { AldoSecretKind } from "./cloud";

export interface AldoSecretRequest {
  readonly kind: AldoSecretKind;
  readonly name: string;
  readonly scope: string;
  readonly hosts: string;
  readonly path: string;
  /** One line from the agent: what it's for. */
  readonly why: string;
  readonly requestedBy: { readonly thread: string; readonly t3?: string };
}

const KINDS: ReadonlySet<string> = new Set<AldoSecretKind>(["env", "request", "file"]);

/** The request in a Vault URL's query, or null when there's none (or it's malformed). */
export function parseAldoSecretRequest(
  search: string,
  everyThread: string,
): AldoSecretRequest | null {
  const params = new URLSearchParams(search);
  const name = params.get("request")?.trim() ?? "";
  const thread = params.get("thread")?.trim() ?? "";
  const kind = (params.get("delivery") ?? "env") as AldoSecretKind;
  if (!name || !thread || !KINDS.has(kind)) return null;
  const t3 = params.get("t3")?.trim();
  return {
    kind,
    name,
    scope: params.get("scope")?.trim() || everyThread,
    hosts: params.get("hosts")?.trim() ?? "",
    path: (params.get("path")?.trim() ?? "").replace(/^\/vercel\//, "~/"),
    why: params.get("why")?.trim() ?? "",
    requestedBy: t3 ? { thread, t3 } : { thread },
  };
}

/**
 * Whether a secret form answers the request: the same name, for the same
 * threads. Saving any other secret leaves the request open, and doesn't tell
 * the thread something it didn't ask for is ready.
 */
export function answersAldoSecretRequest(
  request: AldoSecretRequest,
  draft: { readonly name: string; readonly scope: string },
): boolean {
  return draft.name.trim() === request.name && draft.scope === request.scope;
}
