/** Compact summaries are plain text; full plans use AgentMarkdown. */
export const plainCardText = (text: string): string =>
  text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/(^|\n)\s{0,3}#{1,6}\s+/g, "$1")
    .replace(/(`+)([^`]+)\1/g, "$2")
    .replace(/(\*\*|__)(?=\S)(.+?\S|\S)\1/g, "$2")
    .replace(/~~(?=\S)(.+?\S|\S)~~/g, "$1")
    .replace(/(^|\s)([*_])(?=\S)([^\n]+?\S|\S)\2(?=$|[\s.,!?;:])/g, "$1$3")
    .trim();
