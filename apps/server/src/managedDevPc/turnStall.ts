/**
 * How the liveness watchdog words the stop of a silent turn. The words are the record: the stop's
 * reason is all a run keeps of it, and Aldo's snapshot reads the stall back out of them.
 */
export type StallReason = "model-silence" | "suspend-silence";

const STALL_PATTERN = /^Turn stalled \((model-silence|suspend-silence)\): /;

export function stallMessage(reason: StallReason, silentForMs: number): string {
  const minutes = Math.max(1, Math.round(silentForMs / 60_000));
  return `Turn stalled (${reason}): no provider activity for ${minutes} minute${minutes === 1 ? "" : "s"}, so the turn was interrupted.`;
}

/** The reason a stop was the watchdog's, or null for anyone else's stop. */
export function stallReasonOf(message: string): StallReason | null {
  return (STALL_PATTERN.exec(message)?.[1] as StallReason | undefined) ?? null;
}
