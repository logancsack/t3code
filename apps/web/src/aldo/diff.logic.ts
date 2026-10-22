// What Aldo changed when it rewrote a draft for the user ("make it warmer"):
// the new text in runs, the words it added marked, so its card underlines
// them (AldoUpNext.tsx, AldoApprovals.tsx). What it took out isn't shown: the
// card shows what will be sent. A word diff (the longest run of words both
// share); past a size it would be slow to work out, nothing is marked.
// Pure, so it's tested on its own.

export interface AldoDiffRun {
  readonly text: string;
  /** New in this version. */
  readonly added: boolean;
}

/** More words than this on either side, and nothing is marked: the card shows the text as it is. */
const MAX_WORDS = 1_500;

/** Words, marks and the space between them, in order: "Hi Jordan,\n" is ["Hi", " ", "Jordan", ",", "\n"]. */
const tokens = (text: string) =>
  text.match(/\s+|[\p{L}\p{N}\p{M}_'’]+|[^\s\p{L}\p{N}\p{M}_'’]/gu) ?? [];

/**
 * `after` in runs, the words not in `before` marked added. The space between
 * two added words is part of what's added, so an added phrase is one mark.
 */
export function wordDiff(before: string, after: string): ReadonlyArray<AldoDiffRun> {
  const b = tokens(before).filter((t) => !/^\s+$/.test(t));
  const a = tokens(after);
  const words = a.flatMap((t, i) => (/^\s+$/.test(t) ? [] : [i]));
  if (after === "") return [];
  if (b.length > MAX_WORDS || words.length > MAX_WORDS) return [{ text: after, added: false }];
  // The longest common run of words, from the end, so it's read forward.
  const n = words.length;
  const m = b.length;
  const width = m + 1;
  const table = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[words[i]!] === b[j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const added = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < n) {
    if (j < m && a[words[i]!] === b[j]) {
      i += 1;
      j += 1;
    } else if (j < m && table[(i + 1) * width + j]! < table[i * width + j + 1]!) {
      j += 1;
    } else {
      added.add(words[i]!);
      i += 1;
    }
  }
  // Space joins two added words into one mark; elsewhere it's as it was.
  const runs: { text: string; added: boolean }[] = [];
  a.forEach((token, index) => {
    const space = /^\s+$/.test(token);
    const isAdded = space
      ? added.has(index - 1) && added.has(index + 1) && !token.includes("\n")
      : added.has(index);
    const last = runs.at(-1);
    if (last && last.added === isAdded) last.text += token;
    else runs.push({ text: token, added: isAdded });
  });
  return runs;
}

/** How many words were added (not marks): for saying so to a screen reader. */
export function addedWords(runs: ReadonlyArray<AldoDiffRun>): number {
  return runs.reduce(
    (sum, run) => sum + (run.added ? (run.text.match(/[\p{L}\p{N}]+/gu) ?? []).length : 0),
    0,
  );
}
