// How a message for a machine this page isn't connected to goes to Aldo to hold
// (cloud.ts holdAldoTurn): which of its images go first, in parts a request
// can carry, what the held message says in their place, and what's tried
// again. Pure, so it's tested on its own.

/** An image's data URL longer than this goes to Aldo first, so the message itself stays small. */
export const ALDO_INLINE_MAX_CHARS = 32_000;
/** The most of an image one upload carries (Aldo takes up to 3.5M characters). */
export const ALDO_PART_CHARS = 3_000_000;

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
