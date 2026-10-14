// A message's images and files, on an Aldo that keeps them (its directory's
// `heldFiles`), go to Aldo rather than to the thread's machine, whether or not
// the machine is up: the message names each as T3 names an upload it hasn't
// sent (held.logic.ts aldoAttachmentId), Aldo holds it once it has every file,
// and the machine fetches them as Aldo sends it. So the message goes even if
// this page goes away first: the device keeps it, files and all, until Aldo
// has it (dispatch.ts handToAldo, outbox.ts). Each file starts uploading as
// it's attached, so little is left to send by the time the message is.

import type { ChatAttachment } from "@t3tools/contracts";

import type { ComposerFileAttachment, ComposerImageAttachment } from "../composerDraftStore";
import { randomUUID } from "../lib/utils";
import { aldoKeepsFiles, isAldoCloud, isAldoEnvironmentId, uploadAldoFile } from "./cloud";
import { aldoAttachmentId, aldoOwnUuid } from "./held.logic";

type ComposerAttachment = ComposerImageAttachment | ComposerFileAttachment;

/** How long a message's files stay here once named: past its send (to several models, too), or one that failed first. */
const KEEP_MS = 10 * 60_000;

/** The files of the attachments messages name, by the id each names one by, until the messages are handed to Aldo. */
const named = new Map<string, Blob>();
/** The files already uploading to Aldo, by id, since they were attached. */
const started = new Set<string>();

/** Whether a message to this thread hands its images and files to Aldo. Every way of sending a message asks this. */
export function aldoCarriesAttachments(environmentId: string): boolean {
  return isAldoCloud && isAldoEnvironmentId(environmentId) && aldoKeepsFiles();
}

/**
 * An attachment as a message that hands its file to Aldo names it; throws for
 * one that can't go (a file whose bytes this page lost to a reload).
 */
export function aldoAttachmentOf(attachment: ComposerAttachment): ChatAttachment {
  const id = aldoAttachmentId(
    attachment,
    aldoOwnUuid(attachment.id) ? attachment.id : randomUUID(),
  );
  if (!attachment.file || !id) {
    throw new Error(`Attachment '${attachment.name}' can't be sent: attach it again.`);
  }
  const file = attachment.file;
  named.set(id, file);
  setTimeout(() => {
    if (named.get(id) === file) named.delete(id);
  }, KEEP_MS);
  return {
    type: attachment.type,
    id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    ...(attachment.source ? { source: attachment.source } : {}),
  } as ChatAttachment;
}

/** The files a message hands Aldo, by the id each attachment names it by; null for one that hands none. */
export function aldoFilesOf(command: {
  readonly message?: { readonly attachments?: ReadonlyArray<unknown> };
}): Map<string, Blob> | null {
  const files = new Map<string, Blob>();
  for (const attachment of command.message?.attachments ?? []) {
    const id = (attachment as { readonly id?: unknown }).id;
    const file = typeof id === "string" ? named.get(id) : undefined;
    if (typeof id === "string" && file) files.set(id, file);
  }
  return files.size > 0 ? files : null;
}

/** Starts sending an attachment's file to Aldo as it's attached, so little is left to send with its message. */
export function startAldoUpload(environmentId: string, attachment: ComposerAttachment): void {
  if (!aldoCarriesAttachments(environmentId) || !attachment.file || !aldoOwnUuid(attachment.id)) {
    return;
  }
  const id = aldoAttachmentId(attachment, attachment.id);
  if (!id || started.has(id)) return;
  started.add(id);
  // One that fails is sent again with its message.
  uploadAldoFile(environmentId, id, attachment.file).catch(() => started.delete(id));
}
