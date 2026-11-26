/** Compact summaries are plain text; full plans use AgentMarkdown. */
export const plainCardText = (text: string): string =>
  text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/(^|\n)\s{0,3}#{1,6}\s+/g, "$1")
    .replace(/[*`~]+|(?<!\w)_+|_+(?!\w)/g, "")
    .trim();
