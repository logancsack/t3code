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

const isPrice = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Whether a value is a cost as Aldo answers it: prices, all of them numbers. */
export function isAldoCost(value: unknown): value is AldoCost {
  if (!value || typeof value !== "object") return false;
  const cost = value as { usd?: unknown; conversations?: unknown };
  const conversations = cost.conversations;
  return (
    isPrice(cost.usd) &&
    Boolean(conversations) &&
    typeof conversations === "object" &&
    !Array.isArray(conversations) &&
    Object.values(conversations as object).every(isPrice)
  );
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * The line for a conversation: its share, and its machine's when it shares one;
 * only the machine's when its own share isn't known; null with nothing to say.
 */
export function aldoCostLine(cost: AldoCost | null, threadId: string): string | null {
  if (!cost || cost.usd <= 0) return null;
  const mine = cost.conversations[threadId];
  if (mine === undefined) return `So far: about ${usd(cost.usd)} at API prices for this machine`;
  if (Object.keys(cost.conversations).length > 1)
    return `So far: about ${usd(mine)} at API prices (${usd(cost.usd)} for this machine)`;
  return `So far: about ${usd(mine)} at API prices`;
}
