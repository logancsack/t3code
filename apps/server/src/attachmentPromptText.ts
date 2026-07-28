import type { ChatAttachment } from "@t3tools/contracts";

import { resolveAttachmentPath } from "./attachmentStore.ts";

/**
 * Telling the agent about non-image attachments.
 *
 * Images go into the turn as content blocks, which every provider understands
 * natively. A markdown file or a zip archive has no such block — and inlining
 * one would be wrong anyway, since the agent may only need to list an archive
 * or grep a corner of a large document.
 *
 * So a file attachment is delivered as a path. The server has already written
 * the bytes under its attachments directory; this appends a short section to
 * the turn text naming each file and where it landed, and the agent reads it
 * with the file tools it already has. That works identically across Claude,
 * Codex, Cursor, Grok and OpenCode, none of which need adapter changes.
 *
 * The section is appended to the text sent to the provider only. The message
 * persisted for the thread transcript keeps the user's own words, so the
 * composer does not display machine-oriented paths back to them.
 */

const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

function formatAttachmentSize(sizeBytes: number): string {
  let value = sizeBytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = unitIndex === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${rounded} ${BYTE_UNITS[unitIndex]}`;
}

/**
 * Build the file-attachment section for a turn, or `null` when the turn has no
 * file attachments to describe.
 *
 * An attachment whose path cannot be resolved is skipped rather than failing
 * the turn: the rest of the message is still worth sending, and a turn that
 * dies because one of five files had an unusable id is worse than one that
 * mentions four.
 */
export function buildFileAttachmentPromptSection(input: {
  readonly attachmentsDir: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
}): string | null {
  const lines: string[] = [];
  for (const attachment of input.attachments) {
    if (attachment.type !== "file") {
      continue;
    }
    const attachmentPath = resolveAttachmentPath({
      attachmentsDir: input.attachmentsDir,
      attachment,
    });
    if (!attachmentPath) {
      continue;
    }
    lines.push(
      `- ${attachment.name} (${attachment.mimeType}, ${formatAttachmentSize(attachment.sizeBytes)}): ${attachmentPath}`,
    );
  }

  if (lines.length === 0) {
    return null;
  }

  const heading =
    lines.length === 1
      ? "The user attached a file to this message. It is saved on disk at the path below — read it with your file tools:"
      : `The user attached ${lines.length} files to this message. They are saved on disk at the paths below — read them with your file tools:`;
  return `${heading}\n${lines.join("\n")}`;
}

/**
 * Append the file-attachment section to a turn's text.
 *
 * A turn carrying only attachments has no text of its own, and providers vary
 * in how they treat an empty prompt, so the section becomes the whole message
 * in that case.
 */
export function withFileAttachmentPromptSection(input: {
  readonly attachmentsDir: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly text: string | undefined;
}): string | undefined {
  const section = buildFileAttachmentPromptSection(input);
  if (!section) {
    return input.text;
  }
  return input.text ? `${input.text}\n\n${section}` : section;
}
