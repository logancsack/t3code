// A thread Aldo starts for the user opens with the brief Aldo wrote for its
// agent. Aldo quotes the user's own words after the brief, under a fixed header,
// before its signature (fromAldo and briefOf in Aldo's src/lib/from-aldo.ts;
// keep the two in step). The thread shows those words as the user's request,
// with the brief behind them. A message without the block, or with anything
// else in its place, is shown as it is.

/** The line Aldo signs what it writes to a thread with. */
const SIGNATURE = "_(Sent by Aldo, the user's assistant, for them.)_";
const HEADER =
  /\n\nThe user's request to Aldo (on Home|by text), in their own words \(for context: the brief above is the task\):\n\n/g;

/** Where the user asked Aldo for the work: on Home, or by text message. */
export type AldoRequestFrom = "home" | "text";

export interface AldoRequest {
  /** The user's own words. */
  readonly said: string;
  readonly from: AldoRequestFrom;
  /** What Aldo told the agent, without its signature. */
  readonly brief: string;
}

/** The user's request and the brief, from the first message of a thread Aldo started; null for any other message. */
export function aldoRequestOf(text: string): AldoRequest | null {
  const end = `\n\n${SIGNATURE}`;
  const message = text.replace(/\r\n/g, "\n").trimEnd();
  if (!message.endsWith(end)) return null;
  const body = message.slice(0, -end.length);
  const last = [...body.matchAll(HEADER)].at(-1);
  if (!last) return null;
  const lines = body.slice(last.index + last[0].length).split("\n");
  // Every line of the user's words is quoted: anything else isn't the block.
  if (!lines.every((line) => line === ">" || line.startsWith("> "))) return null;
  const said = lines
    .map((line) => line.slice(2))
    .join("\n")
    .trim();
  const brief = body.slice(0, last.index).trim();
  if (!said || !brief) return null;
  return { said, from: last[1] === "by text" ? "text" : "home", brief };
}

/**
 * What recalling a message Aldo sent puts back in the composer (the up arrow,
 * Edit from here): the user's own words when it carries them, and nothing of
 * what Aldo wrote; null for a message Aldo didn't sign.
 */
export function aldoRecalledPrompt(text: string): string | null {
  if (!text.replace(/\r\n/g, "\n").trimEnd().endsWith(`\n\n${SIGNATURE}`)) return null;
  return aldoRequestOf(text)?.said ?? "";
}

/** The card's heading. */
export function aldoRequestLabel(from: AldoRequestFrom): string {
  return from === "text" ? "Your request, by text" : "Your request, from Home";
}
