// Follow-ups an agent offers when it finishes a task: Aldo's instructions ask
// it to end its reply with a fenced `aldo-next` block, one short instruction a
// line ("Add it to my calendar"). The client hides the block and offers each
// line as a reply a tap sends (AldoNextChips).

/** Follow-ups offered at most, as the instructions ask. */
const MOST = 3;
/** Longer than this isn't a follow-up to tap. */
const LONGEST = 120;

/** An `aldo-next` fence, closed or still streaming in. */
const BLOCK =
  /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*aldo-next[ \t]*(?:\n([\s\S]*?))?(?:\n[ \t]*\2[ \t]*(?=\n|$)|$)/g;

export function splitAldoNext(text: string): {
  readonly text: string;
  readonly next: ReadonlyArray<string>;
} {
  if (!text.includes("aldo-next")) return { text, next: [] };
  let next: string[] = [];
  const rest = text.replace(
    BLOCK,
    (_block, lead: string, _fence: string, body: string | undefined) => {
      next = (body ?? "")
        .split("\n")
        .map((line) =>
          line
            .trim()
            .replace(/^(?:[-*•]|\d+[.)])\s+/, "")
            .trim(),
        )
        .filter((line) => line.length > 0 && line.length <= LONGEST)
        .slice(0, MOST);
      return lead;
    },
  );
  return { text: rest.trimEnd(), next };
}
