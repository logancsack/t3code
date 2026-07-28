import {
  type ChatAttachmentKind,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@t3tools/contracts";

/**
 * Deciding what the composer does with the files a user hands it.
 *
 * The composer accepts anything — markdown, CSV, a zip archive — not just
 * images, and the two kinds are treated differently downstream: an image is
 * inlined into the turn as a content block the model sees directly, while a
 * file is written to disk on the server and reaches the agent as a path it
 * reads with its own tools. That split is decided here, once, so the picker,
 * paste and drop paths cannot drift apart.
 *
 * Kept free of React and of `URL.createObjectURL` so the size and count rules
 * are testable without a DOM.
 */

const FALLBACK_MIME_TYPE = "application/octet-stream";

export const IMAGE_SIZE_LIMIT_LABEL = `${Math.round(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES / (1024 * 1024))}MB`;
export const FILE_SIZE_LIMIT_LABEL = `${Math.round(PROVIDER_SEND_TURN_MAX_FILE_BYTES / (1024 * 1024))}MB`;

export interface AcceptedComposerAttachment {
  readonly type: ChatAttachmentKind;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly file: File;
}

export interface ComposerAttachmentIntake {
  readonly accepted: ReadonlyArray<AcceptedComposerAttachment>;
  /** The last rejection, surfaced as the thread's composer error, or `null`. */
  readonly error: string | null;
}

export function composerAttachmentKind(file: File): ChatAttachmentKind {
  return file.type.startsWith("image/") ? "image" : "file";
}

/**
 * A browser reports no mime type at all for plenty of ordinary files —
 * `.md` and `.zip` among them, depending on the platform. The server requires a
 * non-empty type, and its own extension inference prefers the filename anyway,
 * so an unknown type is not worth rejecting over.
 */
export function composerAttachmentMimeType(file: File): string {
  return file.type.trim() || FALLBACK_MIME_TYPE;
}

function maxBytesForKind(kind: ChatAttachmentKind): number {
  return kind === "image" ? PROVIDER_SEND_TURN_MAX_IMAGE_BYTES : PROVIDER_SEND_TURN_MAX_FILE_BYTES;
}

function sizeLimitLabelForKind(kind: ChatAttachmentKind): string {
  return kind === "image" ? IMAGE_SIZE_LIMIT_LABEL : FILE_SIZE_LIMIT_LABEL;
}

/**
 * Split a batch of picked, pasted or dropped files into the ones the composer
 * will stage and a message explaining the last one it would not.
 *
 * Oversized files are skipped individually so that dropping a folder with one
 * huge archive in it still attaches everything else; exceeding the per-message
 * count stops the batch, since nothing after it could fit either.
 */
export function planComposerAttachmentIntake(input: {
  readonly files: ReadonlyArray<File>;
  readonly existingCount: number;
}): ComposerAttachmentIntake {
  const accepted: AcceptedComposerAttachment[] = [];
  let count = input.existingCount;
  let error: string | null = null;

  for (const file of input.files) {
    const type = composerAttachmentKind(file);
    if (file.size === 0) {
      error = `'${file.name}' is empty.`;
      continue;
    }
    if (file.size > maxBytesForKind(type)) {
      error = `'${file.name}' exceeds the ${sizeLimitLabelForKind(type)} attachment limit.`;
      continue;
    }
    if (count >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
      error = `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} files per message.`;
      break;
    }

    accepted.push({
      type,
      name: file.name || (type === "image" ? "image" : "file"),
      mimeType: composerAttachmentMimeType(file),
      sizeBytes: file.size,
      file,
    });
    count += 1;
  }

  return { accepted, error };
}

const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

/** Size shown on a file attachment chip, where there is no thumbnail to look at. */
export function formatComposerAttachmentSize(sizeBytes: number): string {
  let value = sizeBytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = unitIndex === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${rounded} ${BYTE_UNITS[unitIndex]}`;
}
