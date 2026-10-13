// Share to Aldo: the files a share put in a draft, kept on the device until
// the draft no longer needs them. A new Aldo draft uploads its files only as
// its first message is sent, and a draft keeps a file it hasn't uploaded only
// by name, so one reopened before it's sent (the app closed, the phone
// restarted) would ask for the file again. Its bytes are kept here instead,
// in a cache of their own (Aldo's worker clears the shares' after a day), and
// the next time the app opens they go back in the drafts still waiting to send
// them; once a draft is sent or the file removed, they're let go as the app
// next opens.

import {
  type ComposerFileAttachment,
  composerFileNeedsReattach,
  DraftId,
  useComposerDraftStore,
} from "../composerDraftStore";
import { randomUUID } from "../lib/utils";

const CACHE = "aldo-draft-files-v1";
const LIST_KEY = "aldo:share-draft-files";

/** A file kept for a draft: the draft, the file's id in it now, and where its bytes are. */
interface KeptFile {
  readonly draftId: string;
  readonly id: string;
  readonly key: string;
}

function keptFiles(): KeptFile[] {
  try {
    const list: unknown = JSON.parse(window.localStorage.getItem(LIST_KEY) ?? "[]");
    return Array.isArray(list)
      ? list.filter(
          (entry): entry is KeptFile =>
            !!entry &&
            typeof entry.draftId === "string" &&
            typeof entry.id === "string" &&
            typeof entry.key === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function setKeptFiles(list: ReadonlyArray<KeptFile>): void {
  try {
    if (list.length > 0) window.localStorage.setItem(LIST_KEY, JSON.stringify(list));
    else window.localStorage.removeItem(LIST_KEY);
  } catch {
    // Without storage, a reopened draft asks for its files again.
  }
}

/** Keeps the bytes of the files a share just put in a draft. */
export async function keepAldoDraftFiles(
  draftId: DraftId,
  files: ReadonlyArray<ComposerFileAttachment>,
): Promise<void> {
  if (typeof caches === "undefined" || files.length === 0) return;
  const cache = await caches.open(CACHE);
  const kept: KeptFile[] = [];
  for (const attachment of files) {
    if (!attachment.file) continue;
    const key = `/aldo-draft-file/${attachment.id}`;
    try {
      await cache.put(key, new Response(attachment.file));
      kept.push({ draftId, id: attachment.id, key });
    } catch {
      // No room on the device: a reopened draft asks for this one again.
    }
  }
  setKeptFiles([...keptFiles(), ...kept]);
}

/**
 * As the app opens: gives the drafts still waiting to send a shared file its
 * bytes back, and lets go of those no draft waits for (sent, removed, or
 * uploaded already). Before anything else changes the drafts' files.
 */
export async function restoreAldoDraftFiles(): Promise<void> {
  const list = keptFiles();
  if (typeof caches === "undefined" || list.length === 0) return;
  const cache = await caches.open(CACHE);
  const store = useComposerDraftStore.getState();
  const still: KeptFile[] = [];
  for (const entry of list) {
    const draftId = DraftId.make(entry.draftId);
    const marker = store.getComposerDraft(draftId)?.files.find((file) => file.id === entry.id);
    const blob =
      marker && composerFileNeedsReattach(marker)
        ? await cache
            .match(entry.key)
            .then((kept) => kept?.blob() ?? null)
            .catch(() => null)
        : null;
    if (!marker || !blob) {
      await cache.delete(entry.key).catch(() => false);
      continue;
    }
    // In the marker's place (the draft store replaces a file it waits for with one like it).
    const id = randomUUID();
    store.addFiles(draftId, [
      {
        type: "file",
        id,
        name: marker.name,
        mimeType: marker.mimeType,
        sizeBytes: marker.sizeBytes,
        file: new File([blob], marker.name, { type: marker.mimeType }),
      },
    ]);
    still.push({ ...entry, id });
  }
  setKeptFiles(still);
}
