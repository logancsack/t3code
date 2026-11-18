// Who's signed in, as Aldo tells this browser: its `aldo-who` cookie, a hash
// of the user's id and no credential. A copy kept on this device (what Home
// last showed) is saved with it and shown only under the same one, so one
// person's never shows to another signing in here. An Aldo that doesn't set
// it gives none, and nothing kept is shown.
export function aldoWho(): string | null {
  if (typeof document === "undefined") return null;
  return /(?:^|;\s*)aldo-who=([0-9a-f]{32})(?:;|$)/.exec(document.cookie)?.[1] ?? null;
}
