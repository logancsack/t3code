// Share to Aldo: a phone's share sheet sends a link, words, photos or files to
// the installed app (public-aldo/manifest.webmanifest, share_target). Aldo's
// service worker keeps them in Cache Storage under a one-off id and opens the
// app at /?share=<id> (Aldo's src/lib/service-worker.ts); one that didn't
// come through opens /?share=missed. The app puts a share in a new draft,
// ready to send, and deletes it (shareTarget.ts, AldoShareReceiver.tsx).
// Here: which share the address names, what it says, the words for the
// prompt, and which files the composer takes, by its own rules
// (ChatComposer's addComposerAttachments).

import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
} from "@t3tools/contracts";
import { fileAttachmentTooLargeMessage } from "@t3tools/client-runtime/state/attachments";

import { classifyComposerAttachmentFile } from "../components/chat/composerAttachmentFiles";

/** The cache Aldo's service worker keeps shares in. */
export const ALDO_SHARE_CACHE = "aldo-shares-v1";

/** Where a share's details (no index), or one of its files, is kept in that cache. */
export function aldoShareKey(id: string, index?: number): string {
  return `/aldo-share/${id}${index === undefined ? "" : `/${index}`}`;
}

/** Whether a kept entry (its URL's path) belongs to the share `id`. */
export function aldoShareKeyIsFor(path: string, id: string): boolean {
  return path === aldoShareKey(id) || path.startsWith(`${aldoShareKey(id)}/`);
}

export type AldoShareParam =
  | { readonly kind: "kept"; readonly id: string }
  | { readonly kind: "missed" };

/** The share the app was opened with (`?share=`): one the worker kept, or one that didn't come through. */
export function parseAldoShareParam(search: string): AldoShareParam | null {
  const value = new URLSearchParams(search).get("share");
  if (value === "missed") return { kind: "missed" };
  // The worker's ids: when (base 36), a dash, then randomness.
  if (value && /^[0-9a-z]{1,16}-[0-9a-z]{1,40}$/.test(value)) return { kind: "kept", id: value };
  return null;
}

export interface AldoSharedFileEntry {
  readonly name: string;
  readonly type: string;
  readonly size: number;
}

export interface AldoShareDetails {
  readonly title: string;
  readonly text: string;
  readonly url: string;
  readonly files: ReadonlyArray<AldoSharedFileEntry>;
}

const words = (value: unknown): string => (typeof value === "string" ? value : "");

/** A share's details as the worker kept them; null if they aren't there or aren't readable. */
export function parseAldoShareDetails(value: unknown): AldoShareDetails | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const files = Array.isArray(raw.files) ? raw.files : [];
  return {
    title: words(raw.title),
    text: words(raw.text),
    url: words(raw.url),
    files: files.map((entry: unknown) => {
      const file = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
      return {
        name: words(file.name) || "file",
        type: words(file.type),
        size: typeof file.size === "number" && Number.isFinite(file.size) ? file.size : 0,
      };
    }),
  };
}

/**
 * The prompt a share starts with: its words, with its title before them and
 * its link after them unless the words already say it. A page shared from a
 * browser is often a title, and its link in the words.
 */
export function aldoSharePrompt(details: Pick<AldoShareDetails, "title" | "text" | "url">): string {
  const title = details.title.trim();
  const text = details.text.trim();
  const url = details.url.trim();
  const lines: string[] = [];
  if (title && !text.includes(title) && title !== url) lines.push(title);
  if (text) lines.push(text);
  if (url && !text.includes(url)) lines.push(url);
  return lines.join("\n");
}

/** Why a shared file wasn't attached. */
export type AldoShareRefusal =
  | "too-many"
  | "unsupported-image"
  | "empty"
  | "too-large"
  | "no-files"
  | "image-too-large"
  | "unreadable"
  | "missing";

export interface AldoShareRefused {
  readonly name: string;
  readonly why: AldoShareRefusal;
}

export interface AldoShareLimits {
  /** Attachments one message takes. */
  readonly attachments: number;
  /** The largest file (not image) the draft's computer takes, as its composer says; null when it takes none. */
  readonly fileBytes: number | null;
}

/** Before the draft's computer says otherwise. */
export const ALDO_SHARE_LIMITS = {
  attachments: PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  fileBytes: PROVIDER_SEND_TURN_MAX_FILE_BYTES,
} satisfies AldoShareLimits;

/** A shared file the composer may take: as an image (made smaller to fit, as a pasted one is) or as a file. */
export interface AldoShareCandidate<F> {
  readonly kind: "image" | "file";
  readonly file: F;
}

/** Which shared files the composer may take, in the order shared, and which it can't anywhere (an image it can't attach, an empty file). */
export function sortAldoSharedFiles<F extends Pick<File, "name" | "type" | "size">>(
  files: ReadonlyArray<F>,
): { readonly candidates: AldoShareCandidate<F>[]; readonly refused: AldoShareRefused[] } {
  const candidates: AldoShareCandidate<F>[] = [];
  const refused: AldoShareRefused[] = [];
  for (const file of files) {
    const kind = classifyComposerAttachmentFile(file);
    if (kind === "unsupported-image")
      refused.push({ name: file.name || "file", why: "unsupported-image" });
    else if (file.size <= 0) refused.push({ name: file.name || "file", why: "empty" });
    else candidates.push({ kind, file });
  }
  return { candidates, refused };
}

/**
 * What a draft takes of them, in the order shared, up to `limits.attachments`:
 * the images, but those that couldn't be made ready (`unready`, refused
 * already, which take no slot), and the files its computer takes
 * (`limits.fileBytes`). Why each other wasn't.
 */
export function fitAldoSharedFiles<F extends Pick<File, "name" | "size">>(
  candidates: ReadonlyArray<AldoShareCandidate<F>>,
  unready: ReadonlySet<AldoShareCandidate<F>>,
  limits: AldoShareLimits = ALDO_SHARE_LIMITS,
): { readonly taken: AldoShareCandidate<F>[]; readonly refused: AldoShareRefused[] } {
  const taken: AldoShareCandidate<F>[] = [];
  const refused: AldoShareRefused[] = [];
  for (const candidate of candidates) {
    if (unready.has(candidate)) continue;
    const refuse = (why: AldoShareRefusal) =>
      refused.push({ name: candidate.file.name || "file", why });
    const { fileBytes } = limits;
    if (candidate.kind === "file" && fileBytes === null) refuse("no-files");
    else if (candidate.kind === "file" && fileBytes !== null && candidate.file.size > fileBytes)
      refuse("too-large");
    else if (taken.length >= limits.attachments) refuse("too-many");
    else taken.push(candidate);
  }
  return { taken, refused };
}

function refusalSentence(refused: AldoShareRefused, limits: AldoShareLimits): string {
  const name = refused.name;
  switch (refused.why) {
    case "too-many":
      return `'${name}' didn't fit: a message takes up to ${limits.attachments} attachments.`;
    case "unsupported-image":
      return `'${name}' isn't an image Aldo can attach (GIF, HEIC, JPEG, PNG or WebP).`;
    case "empty":
      return `'${name}' is empty.`;
    case "too-large":
      return fileAttachmentTooLargeMessage(
        name,
        limits.fileBytes ?? PROVIDER_SEND_TURN_MAX_FILE_BYTES,
      );
    case "no-files":
      return `'${name}' couldn't be attached: this thread's computer doesn't take files.`;
    case "image-too-large":
      return `'${name}' is too large, even made smaller.`;
    case "unreadable":
      return `'${name}' couldn't be read.`;
    case "missing":
      return `'${name}' didn't come through.`;
  }
}

/** What the toast says about shared files that weren't attached; null when they all were. */
export function aldoShareRefusedNotice(
  refused: ReadonlyArray<AldoShareRefused>,
  limits: AldoShareLimits = ALDO_SHARE_LIMITS,
): { readonly title: string; readonly description: string } | null {
  if (refused.length === 0) return null;
  const shown = refused.slice(0, 3).map((entry) => refusalSentence(entry, limits));
  if (refused.length > shown.length) shown.push(`And ${refused.length - shown.length} more.`);
  return {
    title:
      refused.length === 1
        ? "A shared file wasn't attached"
        : `${refused.length} shared files weren't attached`,
    description: shown.join(" "),
  };
}
