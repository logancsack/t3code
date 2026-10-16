// How a message for a machine this page isn't connected to goes to Aldo to hold
// (cloud.ts holdAldoTurn): which of its images go first, in parts a request
// can carry, what the held message says in their place, and what's tried
// again. Pure, so it's tested on its own.

/** An image's data URL longer than this goes to Aldo first, so the message itself stays small. */
export const ALDO_INLINE_MAX_CHARS = 32_000;
/** The most of an image one upload carries (Aldo takes up to 3.5M characters). */
const ALDO_PART_CHARS = 3_000_000;

/** One of a message's images that goes to Aldo first: where it sits in the attachments, its upload's id, and its data. */
export interface AldoUpload {
  readonly index: number;
  readonly id: string;
  readonly dataUrl: string;
}

/** A message's images that go to Aldo first, each an upload of its own, named after the command. */
export function aldoUploadsOf(command: unknown): AldoUpload[] {
  const { commandId, message } = command as {
    readonly commandId?: unknown;
    readonly message?: { readonly attachments?: unknown };
  };
  if (typeof commandId !== "string" || !Array.isArray(message?.attachments)) return [];
  const name = commandId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 180);
  return message.attachments.flatMap((attachment: unknown, index) => {
    const dataUrl = (attachment as { readonly dataUrl?: unknown } | null)?.dataUrl;
    return typeof dataUrl === "string" && dataUrl.length > ALDO_INLINE_MAX_CHARS
      ? [{ index, id: `${name}-${index}`, dataUrl }]
      : [];
  });
}

/** A data URL in the parts Aldo takes it in. */
export function aldoPartsOf(text: string, size = ALDO_PART_CHARS): string[] {
  const parts: string[] = [];
  for (let start = 0; start < text.length; start += size)
    parts.push(text.slice(start, start + size));
  return parts;
}

/** The message as Aldo holds it: each uploaded image names its upload in place of its data URL. */
export function aldoHeldCommand(command: unknown, uploads: ReadonlyArray<AldoUpload>): unknown {
  const byIndex = new Map(uploads.map((upload) => [upload.index, upload]));
  const held = command as { readonly message: { readonly attachments: ReadonlyArray<unknown> } };
  return {
    ...held,
    message: {
      ...held.message,
      attachments: held.message.attachments.map((attachment, index) => {
        const upload = byIndex.get(index);
        if (!upload) return attachment;
        const { dataUrl: _dataUrl, ...rest } = attachment as Record<string, unknown>;
        return {
          ...rest,
          aldoUpload: {
            id: upload.id,
            parts: aldoPartsOf(upload.dataUrl).length,
            chars: upload.dataUrl.length,
          },
        };
      }),
    },
  };
}

/**
 * Whether handing a message (or a part of one of its images) to Aldo is tried
 * again: it got no answer (`status` null: the network dropped it, or it timed
 * out), a gateway gave up, or Aldo was in trouble. Aldo holds a message once,
 * however often it's handed over. Any other answer is Aldo's last word on it.
 */
export function aldoHoldAgain(status: number | null): boolean {
  return status === null || status === 408 || status === 429 || status >= 500;
}

/** A file goes to Aldo in parts this size, the last one shorter (Aldo takes 4 MiB a part). */
export const ALDO_FILE_PART_BYTES = 4 * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The image types T3 gives an extension of their own, so it takes one Aldo puts on the machine as uploaded. */
const NAMED_IMAGE_TYPES = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/svg+xml",
  "image/tiff",
  "image/webp",
]);

/** The extension T3 gives a file by its name, without the dot (attachmentFileExtension in apps/server/src/attachmentStore.ts). */
export function aldoFileExtension(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  const extension = dot > 0 ? base.slice(dot).toLowerCase() : "";
  return extension === ".part" || !/^\.[a-z0-9]{1,10}$/.test(extension)
    ? "bin"
    : extension.slice(1);
}

/**
 * The id a message names an attachment it hands Aldo the file of by (and its
 * upload goes by): T3's name for an upload it hasn't sent, `pending-<uuid>`,
 * a file's ending in its extension. Aldo puts the file on the machine under
 * it, and T3 takes it as its own upload. `uuid` is the attachment's own when
 * it's one (the composer's are), so its upload as it's attached and as it's
 * sent are one. Null for an image of a type T3 can't take that way.
 */
export function aldoAttachmentId(
  attachment: { readonly type: "image" | "file"; readonly name: string; readonly mimeType: string },
  uuid: string,
): string | null {
  if (!UUID.test(uuid)) return null;
  if (attachment.type === "image") {
    return NAMED_IMAGE_TYPES.has(attachment.mimeType.toLowerCase()) ? `pending-${uuid}` : null;
  }
  return `pending-${uuid}-${aldoFileExtension(attachment.name)}`;
}

/** Whether an attachment's own id can name its upload (a UUID, as the composer makes them). */
export function aldoOwnUuid(id: string): boolean {
  return UUID.test(id);
}

/** How many parts a file of `size` bytes goes to Aldo in. */
export function aldoFilePartCount(size: number): number {
  return Math.max(1, Math.ceil(size / ALDO_FILE_PART_BYTES));
}

/** The parts of a file of `size` bytes Aldo doesn't have whole, given what it says it has. */
export function aldoMissingParts(
  size: number,
  have: ReadonlyArray<{ readonly part: number; readonly bytes: number }>,
): number[] {
  const kept = new Map(have.map((entry) => [entry.part, entry.bytes]));
  return Array.from({ length: aldoFilePartCount(size) }, (_, part) => part).filter(
    (part) => kept.get(part) !== Math.min(ALDO_FILE_PART_BYTES, size - part * ALDO_FILE_PART_BYTES),
  );
}

/**
 * The message as Aldo holds it when it carries files: each attachment whose
 * file went to Aldo says in how many parts, and one sent from a page
 * connected to the machine goes now (`aldoNow`), steering a turn under way,
 * as the page's own send would.
 */
export function aldoHeldFileCommand(
  command: unknown,
  files: ReadonlyMap<string, { readonly size: number }>,
  now: boolean,
): unknown {
  const held = command as { readonly message: { readonly attachments: ReadonlyArray<unknown> } };
  return {
    ...held,
    ...(now ? { aldoNow: true } : {}),
    message: {
      ...held.message,
      attachments: held.message.attachments.map((attachment) => {
        const id = (attachment as { readonly id?: unknown }).id;
        const file = typeof id === "string" ? files.get(id) : undefined;
        return file
          ? { ...(attachment as object), aldoFile: { parts: aldoFilePartCount(file.size) } }
          : attachment;
      }),
    },
  };
}
