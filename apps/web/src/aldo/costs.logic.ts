// What a thread has cost, in its header's Aldo menu (AldoPreviewsControl.tsx):
// Aldo's GET /api/environments/costs says what its machine's agents used at
// API prices and each conversation's estimated share (an older Aldo has no
// such route, and nothing shows). Pure, so it's tested on its own.

export interface AldoCost {
  /** The machine's agents, at API prices. */
  readonly usd: number;
  /** Each conversation's share, by the tokens its turns processed. */
  readonly conversations: Readonly<Record<string, number>>;
}

/** Whether a value is a cost as Aldo answers it. */
export function isAldoCost(value: unknown): value is AldoCost {
  if (!value || typeof value !== "object") return false;
  const cost = value as { usd?: unknown; conversations?: unknown };
  return (
    typeof cost.usd === "number" &&
    Boolean(cost.conversations) &&
    typeof cost.conversations === "object"
  );
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** The line for a conversation: its share, and its machine's when it shares one; null with nothing to say. */
export function aldoCostLine(cost: AldoCost | null, threadId: string): string | null {
  if (!cost || cost.usd <= 0) return null;
  const mine = cost.conversations[threadId];
  const shared = Object.keys(cost.conversations).length > 1;
  if (mine !== undefined && shared)
    return `So far: about ${usd(mine)} at API prices (${usd(cost.usd)} for this machine)`;
  return `So far: about ${usd(mine ?? cost.usd)} at API prices`;
}
