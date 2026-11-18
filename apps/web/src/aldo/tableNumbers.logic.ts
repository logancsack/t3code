// Which table cells hold a number. Tables mark those cells `data-numeric`, and
// Aldo's build sets their digits all one width (aldo/fonts.css), so they line
// up down a column. A cell counts when it's only a number as people write one in
// a table: a count, an amount, a share, a multiple, a date or a time, with its
// sign, currency and scale. A number among words ("14 deals", "6:03 PM") keeps
// the interface face, so a column of them stays in one face.

/** A sign or comparison, a currency, the digits with their separators, then a scale, a percent or a currency. */
const NUMBER_CELL =
  /^\(?[-+−±<>≤≥~≈]?\s?(?:\p{Sc}\s?|[A-Z]{3}\s)?\d(?:[\d\s,.:/'’\-–]*\d)?(?:\s?(?:%|‰|[xX×]|[kKMBT]|bn|\p{Sc}|[A-Z]{3}))?\)?$/u;

/** Whether a table cell's text is only a number, as above. */
export function isNumberCell(text: string): boolean {
  const value = text.trim();
  return value.length > 0 && value.length <= 40 && NUMBER_CELL.test(value);
}

/**
 * Which of a table's columns hold numbers, to right-align: those whose filled
 * cells are mostly numbers, so a "n/a" or a dash among them doesn't count.
 */
export function numericColumns(rows: ReadonlyArray<ReadonlyArray<string>>): boolean[] {
  const width = Math.max(0, ...rows.map((row) => row.length));
  return Array.from({ length: width }, (_, c) => {
    const filled = rows.map((row) => row[c] ?? "").filter((cell) => cell.trim());
    return filled.length > 0 && filled.filter(isNumberCell).length * 2 > filled.length;
  });
}
