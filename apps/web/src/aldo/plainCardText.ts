/** Compact summaries are plain text; full plans use AgentMarkdown. */
export const plainCardText = (text: string): string => {
  const code: string[] = [];
  return text
    .replace(
      /(`+)([^`]+)\1/g,
      (_match, _ticks, value: string) => `\u0000${code.push(value) - 1}\u0000`,
    )
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/(^|\n)\s{0,3}#{1,6}\s+/g, "$1")
    .replace(/(\*\*|__)(?=\S)(.+?\S|\S)\1/g, "$2")
    .replace(/~~(?=\S)(.+?\S|\S)~~/g, "$1")
    .replace(/(^|\s)([*_])(?=\S)([^\n]+?\S|\S)\2(?=$|[\s.,!?;:])/g, "$1$3")
    .replace(/\u0000(\d+)\u0000/g, (_match, index: string) => code[Number(index)] ?? "")
    .trim();
};
