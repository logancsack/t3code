// The agents' address a user claims (Settings → Agents → Your agents' email): a
// handle, like one on a social site, checked here as it's typed. Aldo checks
// it again, and has the last word (reserved handles, ones that are taken). The
// same for the name its mail goes out under, which the user changes as they like.

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

/** Most characters a sender name has (Aldo's limit: mail apps cut longer ones short). */
const SENDER_NAME_MAX = 64;

/** A sender name as typed: spaces and line breaks run together, as Aldo keeps it. */
export function normalizeSenderName(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/** What's wrong with a sender name, or null: what mail puts around addresses, control characters and ones that turn text around aren't allowed. */
export function senderNameProblem(name: string): string | null {
  if (!name) return "Type a name.";
  if (name.length > SENDER_NAME_MAX) return `At most ${SENDER_NAME_MAX} characters.`;
  if (/[()<>[\]:;@\\,"]/.test(name)) {
    return 'Leave out , ; : @ " \\ ( ) < > [ ]: mail uses them around addresses.';
  }
  if (/[\p{Cc}\p{Bidi_Control}]/u.test(name)) {
    return "No control characters, or ones that turn text around.";
  }
  return null;
}
