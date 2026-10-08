// The agents' address a user claims (Settings → Integrations → Agent inbox): a
// handle, like one on a social site, checked here as it's typed. Aldo checks
// it again, and has the last word (reserved handles, ones that are taken).

/** What the handle field keeps of what's typed or pasted: an address loses its domain, which the field shows beside it. */
export function handleFieldValue(input: string): string {
  return input.split("@")[0] ?? "";
}

/** A handle as typed: lowercase, without an @ and what follows. */
export function normalizeAgentHandle(input: string): string {
  return input.trim().toLowerCase().split("@")[0] ?? "";
}

/** What's wrong with a handle's shape, or null: 3 to 30 letters, digits, dots, hyphens or underscores, starting and ending with a letter or digit. */
export function agentHandleProblem(handle: string): string | null {
  if (handle.length < 3) return "At least 3 characters.";
  if (handle.length > 30) return "At most 30 characters.";
  if (!/^[a-z0-9._-]+$/.test(handle)) return "Letters, digits, dots, hyphens and underscores only.";
  if (!/^[a-z0-9]/.test(handle) || !/[a-z0-9]$/.test(handle)) {
    return "Start and end with a letter or digit.";
  }
  if (/[._-]{2}/.test(handle)) return "No two dots, hyphens or underscores in a row.";
  return null;
}
