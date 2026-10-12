// The Mail page (AldoMail.tsx): the user's look at their agents' inbox, the
// mail its agents received and sent, read through Aldo (GET
// /api/agent-inbox/messages and /threads/:id). Here: where the page is (its
// folder, search and conversation, in the address), how people and times
// read, which of a message's bodies shows, and the document an HTML message
// is shown in. That document is locked down by AldoMailFrame.tsx (a sandboxed
// frame of its own origin); here is what it allows: no network but inline
// images and, once the user asks for them, images and styles from the web
// (a sender learns when their mail is opened from them), and one script, our
// own, that tells the page how tall the mail is.

export type AldoMailFolder = "inbox" | "sent" | "spam";

export const ALDO_MAIL_FOLDERS: ReadonlyArray<{
  readonly value: AldoMailFolder;
  readonly label: string;
}> = [
  { value: "inbox", label: "Inbox" },
  { value: "sent", label: "Sent" },
  { value: "spam", label: "Spam" },
];

/** Where the Mail page is, in its address: a folder or a search, and the conversation open in it. */
export interface AldoMailSearch {
  readonly folder?: AldoMailFolder;
  readonly q?: string;
  readonly thread?: string;
  /** The message in the conversation that was picked, shown open. */
  readonly message?: string;
}

export function parseAldoMailSearch(raw: Record<string, unknown>): AldoMailSearch {
  const text = (value: unknown, max: number) =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
  const folder = ALDO_MAIL_FOLDERS.find((entry) => entry.value === raw.folder)?.value;
  const q = text(raw.q, 200);
  const thread = text(raw.thread, 300);
  const message = text(raw.message, 1000);
  return {
    ...(folder && folder !== "inbox" ? { folder } : {}),
    ...(q ? { q } : {}),
    ...(thread ? { thread } : {}),
    ...(thread && message ? { message } : {}),
  };
}

export interface AldoMailAddress {
  readonly name: string;
  readonly address: string;
}

/** A sender or recipient as mail writes them: `Name <a@b.c>`, `"Last, First" <a@b.c>` or `a@b.c`. */
export function parseMailAddress(value: string): AldoMailAddress {
  const match = /^\s*(.*?)\s*<([^<>]*)>\s*$/.exec(value);
  if (!match) return { name: "", address: value.trim() };
  const name = (match[1] ?? "")
    .replace(/^"(.*)"$/, "$1")
    .replace(/\\(.)/g, "$1")
    .trim();
  const address = (match[2] ?? "").trim();
  return { name: name === address ? "" : name, address };
}

/** What to call someone: their name, else their address. */
export function mailPersonLabel(value: string): string {
  const { name, address } = parseMailAddress(value);
  return name || address || value;
}

/** Who a row in a list is about: whoever wrote it, or for mail the agents sent, who it went to. */
export function mailRowPeople(input: {
  readonly from: string;
  readonly to: ReadonlyArray<string>;
  readonly sent: boolean;
}): string {
  if (!input.sent) return mailPersonLabel(input.from);
  const names = input.to.map(mailPersonLabel).filter(Boolean);
  return names.length ? `To: ${names.join(", ")}` : "To: (no one)";
}

/** How a list says when: the time today, the day this year, the date before. */
export function mailTimeKind(at: string, now: Date): "time" | "day" | "date" | null {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  if (date.toDateString() === now.toDateString()) return "time";
  return date.getFullYear() === now.getFullYear() ? "day" : "date";
}

export function formatMailTime(at: string, now: Date = new Date()): string {
  const kind = mailTimeKind(at, now);
  if (!kind) return "";
  const options: Intl.DateTimeFormatOptions =
    kind === "time"
      ? { hour: "numeric", minute: "2-digit" }
      : kind === "day"
        ? { month: "short", day: "numeric" }
        : { year: "numeric", month: "numeric", day: "numeric" };
  return new Intl.DateTimeFormat(undefined, options).format(new Date(at));
}

/** When a message came, in full, as it reads at the top of it. */
export function formatMailDate(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatMailSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, "") : Math.round(value)} ${units[unit]}`;
}

export interface AldoMailBodySource {
  /** It answers another message, so it may quote it. */
  readonly reply: boolean;
  readonly text?: string;
  readonly html?: string;
  /** What's new in it, without what it quotes (AgentMail's). */
  readonly extractedText?: string;
  readonly extractedHtml?: string;
}

export interface AldoMailBody {
  readonly kind: "html" | "text";
  readonly content: string;
  /** What it quotes is left out, and can be shown. */
  readonly quoteHidden: boolean;
  /** It quotes something, shown or not. */
  readonly quotes: boolean;
}

const present = (value: string | undefined) => (value && value.trim() ? value : undefined);

/**
 * Which body of a message shows: its HTML, else its text; for a reply, what's
 * new in it unless the user asked for what it quotes too.
 */
export function mailBody(message: AldoMailBodySource, showQuoted: boolean): AldoMailBody | null {
  const html = present(message.html);
  const text = present(message.text);
  const newHtml = present(message.extractedHtml);
  const newText = present(message.extractedText);
  if (html) {
    const quotes = message.reply && newHtml !== undefined && newHtml.trim() !== html.trim();
    const hide = quotes && !showQuoted;
    return { kind: "html", content: hide ? newHtml! : html, quoteHidden: hide, quotes };
  }
  if (text) {
    const quotes = message.reply && newText !== undefined && newText.trim() !== text.trim();
    const hide = quotes && !showQuoted;
    return { kind: "text", content: hide ? newText! : text, quoteHidden: hide, quotes };
  }
  return null;
}

/** A few words of a message, for it folded in a conversation: what's new in it, as plain text. */
export function mailSnippet(message: AldoMailBodySource, max = 160): string {
  const source =
    present(message.extractedText) ??
    present(message.text) ??
    (present(message.extractedHtml) ?? present(message.html) ?? "")
      .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&amp;/gi, "&");
  const text = source.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export interface AldoMailFile extends AldoMailInlineImage {
  readonly inline: boolean;
  readonly contentType: string;
}

/** The files a message carries to list under it: all but the images shown inside it (those Aldo gave an address for). */
export function mailFiles<T extends AldoMailFile>(message: {
  readonly html?: string;
  readonly extractedHtml?: string;
  readonly attachments: ReadonlyArray<T>;
}): T[] {
  const html = `${message.html ?? ""}${message.extractedHtml ?? ""}`.toLowerCase();
  return message.attachments.filter(
    (file) =>
      !(
        file.contentId &&
        file.url &&
        file.contentType.startsWith("image/") &&
        html.includes(`cid:${file.contentId.toLowerCase()}`)
      ),
  );
}

/** How long a link to a picture inside mail lasts when Aldo doesn't say (AgentMail signs them for a while). */
const MAIL_LINK_DEFAULT_MS = 10 * 60_000;
/** How long before such a link expires that a conversation read again takes the shown one's place. */
const MAIL_LINK_MARGIN_MS = 60_000;

/**
 * Whether a conversation read again can leave the one shown as it is, so
 * nothing on screen reloads: the same messages, with the links to the
 * pictures inside them (read at `loadedAt`) good for a while yet.
 */
export function keepShownMail(
  shown: AldoMailThreadLinks,
  loadedAt: number,
  next: AldoMailThreadLinks,
  now: number,
): boolean {
  if (shown.id !== next.id || shown.messages.length !== next.messages.length) return false;
  if (!shown.messages.every((message, i) => message.id === next.messages[i]?.id)) return false;
  return shown.messages.every((message) =>
    message.attachments.every((file) => {
      if (!file.url) return true;
      const said = file.expiresAt ? Date.parse(file.expiresAt) : Number.NaN;
      const ends = Number.isFinite(said) ? said : loadedAt + MAIL_LINK_DEFAULT_MS;
      return ends - now > MAIL_LINK_MARGIN_MS;
    }),
  );
}

export interface AldoMailThreadLinks {
  readonly id: string;
  readonly messages: ReadonlyArray<{
    readonly id: string;
    readonly attachments: ReadonlyArray<{ readonly url?: string; readonly expiresAt?: string }>;
  }>;
}

/** A folder or search's list as loaded: its key (folder or search), messages so far, and where the next page starts. */
export interface AldoMailList<T extends { readonly id: string; readonly at: string }> {
  readonly key: string;
  readonly messages: ReadonlyArray<T>;
  readonly next: string | null;
}

/**
 * A folder read again from its first page, with the older pages already
 * loaded kept below it (a refresh doesn't take the user back to the top). A
 * search, ranked by match rather than time, is read again whole.
 */
export function mergeMailPages<T extends { readonly id: string; readonly at: string }>(
  previous: AldoMailList<T> | null,
  fresh: AldoMailList<T>,
  ordered: boolean,
): AldoMailList<T> {
  if (!previous || previous.key !== fresh.key || !ordered || fresh.next === null) return fresh;
  const seen = new Set(fresh.messages.map((m) => m.id));
  const oldest = Date.parse(fresh.messages.at(-1)?.at ?? "");
  const older = previous.messages.filter((m) => !seen.has(m.id) && Date.parse(m.at) < oldest);
  if (older.length === 0) return fresh;
  return { key: fresh.key, messages: [...fresh.messages, ...older], next: previous.next };
}

/**
 * A list's rows, one a conversation: its first message listed (the newest in a
 * folder, the best match in a search), with how many of its messages are listed.
 */
export function mailConversations<T extends { readonly threadId: string }>(
  messages: ReadonlyArray<T>,
): Array<{ readonly mail: T; readonly count: number }> {
  const rows = new Map<string, { mail: T; count: number }>();
  for (const mail of messages) {
    const row = rows.get(mail.threadId);
    if (row) row.count += 1;
    else rows.set(mail.threadId, { mail, count: 1 });
  }
  return [...rows.values()];
}

/** A next page added to a list, without a message it has already. */
export function appendMailPage<T extends { readonly id: string; readonly at: string }>(
  list: AldoMailList<T>,
  page: { readonly messages: ReadonlyArray<T>; readonly next: string | null },
): AldoMailList<T> {
  const seen = new Set(list.messages.map((m) => m.id));
  return {
    key: list.key,
    messages: [...list.messages, ...page.messages.filter((m) => !seen.has(m.id))],
    next: page.next,
  };
}

/** A message's text, as text and the web addresses in it (to open in a new tab), each with where it starts. */
export function linkifyMailText(text: string): ReadonlyArray<{
  readonly kind: "text" | "link";
  readonly value: string;
  readonly start: number;
}> {
  const parts: Array<{ kind: "text" | "link"; value: string; start: number }> = [];
  const pattern = /\bhttps?:\/\/[^\s<>"']+/gi;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    let url = match[0];
    // Punctuation that ends a sentence isn't part of the address, nor a bracket it doesn't open.
    for (;;) {
      const end = url.at(-1) ?? "";
      const opener = end === ")" ? "(" : end === "]" ? "[" : null;
      const unopened = opener !== null && url.split(opener).length < url.split(end).length;
      if (!unopened && !(end && ".,;:!?".includes(end))) break;
      url = url.slice(0, -1);
    }
    const start = match.index ?? 0;
    if (start > last) parts.push({ kind: "text", value: text.slice(last, start), start: last });
    parts.push({ kind: "link", value: url, start });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last), start: last });
  return parts;
}

export interface AldoMailInlineImage {
  /** What the mail's HTML calls it: `cid:<contentId>`. */
  readonly contentId?: string;
  /** Where Aldo said it is, for a while. */
  readonly url?: string;
}

/** The mail's own images (`cid:`) at the addresses Aldo gave for them; ones without an address stay as they are, and don't load. */
export function withInlineImages(html: string, images: ReadonlyArray<AldoMailInlineImage>): string {
  const urls = new Map<string, string>();
  for (const image of images) {
    if (image.contentId && image.url?.startsWith("https://")) {
      urls.set(image.contentId.toLowerCase(), image.url);
    }
  }
  if (urls.size === 0) return html;
  return html.replace(/cid:([^\s"'<>)]+)/gi, (whole, id: string) => {
    let key = id.toLowerCase();
    try {
      key = decodeURIComponent(id).toLowerCase();
    } catch {}
    return urls.get(key) ?? whole;
  });
}

/** Whether the mail would load anything from the web: images, styles or fonts (a sender learns it was opened). */
export function hasRemoteMailContent(html: string): boolean {
  return (
    /\b(?:src|srcset|background|poster)\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html) ||
    /<(?:image|use|feimage)\b[^>]*?\s(?:xlink:)?href\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html) ||
    /url\(\s*["']?\s*(?:https?:)?\/\//i.test(html) ||
    /@import\b/i.test(html) ||
    /<link\b[^>]*\bstylesheet\b/i.test(html)
  );
}

/** The origins the mail's own images are at (AgentMail's), which its document may load from. */
export function inlineImageOrigins(images: ReadonlyArray<AldoMailInlineImage>): string[] {
  const origins = new Set<string>();
  for (const image of images) {
    if (!image.url?.startsWith("https://")) continue;
    try {
      origins.add(new URL(image.url).origin);
    } catch {}
  }
  return [...origins];
}

/**
 * What a message's document may do: run only our script (its nonce), load
 * nothing but its own images, and with `remote` images, styles and fonts from
 * the web too. Nothing it does reaches Aldo: the frame has an origin of its own.
 */
export function mailContentSecurityPolicy(input: {
  readonly nonce: string;
  readonly remote: boolean;
  readonly imageOrigins: ReadonlyArray<string>;
}): string {
  const web = input.remote ? " https: http:" : "";
  const images = input.imageOrigins.map((origin) => ` ${origin}`).join("");
  return [
    "default-src 'none'",
    `script-src 'nonce-${input.nonce}'`,
    `img-src data:${images}${web}`,
    `style-src 'unsafe-inline'${web}`,
    `font-src data:${web}`,
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

/** The message that a mail document posts with its height: `nonce` says it's ours. */
export interface AldoMailFrameMessage {
  readonly aldoMail: string;
  readonly height: number;
}

export function parseMailFrameMessage(data: unknown, nonce: string): number | null {
  const message = data as Partial<AldoMailFrameMessage> | null;
  if (!message || typeof message !== "object" || message.aldoMail !== nonce) return null;
  return typeof message.height === "number" &&
    Number.isFinite(message.height) &&
    message.height >= 0
    ? message.height
    : null;
}

/**
 * The document a message is shown in: our policy, base styles and script
 * first, then the mail's own styles and body (made safe by AldoMailFrame.tsx),
 * in a root whose height the script reports as it changes (images load, the
 * frame narrows), scaled down to fit a narrow frame. Mail is laid out for a
 * light page, so it gets one, whatever the app's theme.
 */
export function mailDocument(input: {
  readonly nonce: string;
  readonly policy: string;
  /** The mail's own `<style>`s and stylesheets. */
  readonly head: string;
  /** Its `<body>`'s attributes, already escaped. */
  readonly bodyAttributes: string;
  readonly body: string;
}): string {
  const report = [
    'document.addEventListener("DOMContentLoaded",function(){',
    'var root=document.getElementById("aldo-mail-root");if(!root)return;var last=-1;',
    "function post(){var style=getComputedStyle(document.body);",
    "var height=Math.ceil(root.getBoundingClientRect().bottom+window.scrollY+(parseFloat(style.paddingBottom)||0)+(parseFloat(style.marginBottom)||0));",
    `if(height!==last){last=height;parent.postMessage({aldoMail:${JSON.stringify(input.nonce)},height:height},"*");}}`,
    // Mail laid out wider than the frame (on a phone) is scaled down to fit, as mail apps do; past half, it scrolls.
    'function fit(){root.style.zoom="";var wide=root.scrollWidth;var room=root.clientWidth;',
    "if(room>0&&wide>room+1)root.style.zoom=String(Math.max(0.5,room/wide));post();}",
    'if(window.ResizeObserver){new ResizeObserver(post).observe(root);}window.addEventListener("load",fit);window.addEventListener("resize",fit);fit();});',
  ].join("");
  return [
    "<!doctype html><html><head>",
    `<meta http-equiv="Content-Security-Policy" content="${input.policy.replace(/"/g, "&quot;")}">`,
    '<meta charset="utf-8"><meta name="referrer" content="no-referrer">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<base target="_blank">',
    "<style>:root{color-scheme:light}html{background:#fff}body{margin:0;padding:16px;color:#1f1f1f;background:#fff;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;overflow-wrap:break-word}#aldo-mail-root{display:flow-root;overflow-x:auto}img{max-width:100%;height:auto}pre{white-space:pre-wrap}</style>",
    `<script nonce="${input.nonce}">${report}</script>`,
    input.head,
    "</head>",
    `<body${input.bodyAttributes ? ` ${input.bodyAttributes}` : ""}><div id="aldo-mail-root">`,
    input.body,
    "</div></body></html>",
  ].join("");
}
