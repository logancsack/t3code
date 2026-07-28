import Mime from "@effect/platform-node/Mime";

/**
 * Naming for non-image attachments on disk.
 *
 * Attachments are stored flat as `<attachmentId><extension>`: the projection
 * pipeline's garbage collector enumerates that directory non-recursively and
 * parses the id back out of each entry, so a file attachment cannot introduce a
 * nested directory or the GC would never reclaim it.
 *
 * That makes the extension the only part of the original name that survives, so
 * it is worth getting right — an agent handed `report.bin` has to guess what it
 * is holding, where `report.csv` it can just read. The original name is carried
 * separately in the turn text.
 */

// Bounded to alphanumerics so a separator or a dot segment from the user's
// filename can never survive into the stored path.
const BARE_EXTENSION_PATTERN = /^[a-z0-9]{1,8}$/i;
const EXTENSION_PATTERN = /\.([a-z0-9]{1,8})$/i;

export const FALLBACK_ATTACHMENT_EXTENSION = ".bin";

/**
 * Pick the on-disk extension for a file attachment.
 *
 * The user's filename wins over the mime type: browsers report
 * `application/octet-stream` for most of what people actually attach (`.md`,
 * `.zip` on some platforms, anything unrecognized), while the name they chose
 * almost always carries the real extension.
 */
export function inferAttachmentFileExtension(input: {
  readonly mimeType: string;
  readonly fileName?: string | undefined;
}): string {
  const fromFileName = EXTENSION_PATTERN.exec(input.fileName?.trim() ?? "");
  if (fromFileName?.[1]) {
    return `.${fromFileName[1].toLowerCase()}`;
  }

  // `Mime.getExtension` yields a bare extension with no leading dot.
  const fromMime = Mime.getExtension(input.mimeType);
  if (fromMime && BARE_EXTENSION_PATTERN.test(fromMime)) {
    return `.${fromMime.toLowerCase()}`;
  }

  return FALLBACK_ATTACHMENT_EXTENSION;
}
