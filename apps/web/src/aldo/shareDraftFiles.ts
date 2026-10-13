// Share to Aldo: what a share put in a draft (its files and images), kept on
// the device until the draft no longer needs it. A new Aldo draft uploads its
// files only as its first message is sent, and keeps a file it hasn't
// uploaded only by name; an image stays only if the draft could save it (a
// large one may not fit, and the app can close before it's saved). So one
// reopened before it's sent (the app closed, the phone restarted) would ask
// for a file again, or have lost an image. Their bytes are kept here instead,
// in a cache of their own (Aldo's worker clears the shares' after a day), and
// the next time the app opens they go back in the drafts still waiting to send
// them; once a draft sends one, or the user removes it, it's let go.

import {
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  composerFileNeedsReattach,
  DraftId,
  useComposerDraftStore,
} from "../composerDraftStore";
import { randomUUID } from "../lib/utils";

const CACHE = "aldo-draft-files-v1";
const LIST_KEY = "aldo:share-draft-files";

/** What's kept for a draft: the draft, the file's or image's id in it now, where its bytes are, and for an image, what it's called. */
interface Kept {
  readonly draftId: string;
  readonly id: string;
  readonly key: string;
  readonly image?: { readonly name: string; readonly mimeType: string };
}

function keptList(): Kept[] {
  try {
    const list: unknown = JSON.parse(window.localStorage.getItem(LIST_KEY) ?? "[]");
    return Array.isArray(list)
      ? list.filter(
          (entry): entry is Kept =>
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

function setKeptList(list: ReadonlyArray<Kept>): void {
  try {
    if (list.length > 0) window.localStorage.setItem(LIST_KEY, JSON.stringify(list));
    else window.localStorage.removeItem(LIST_KEY);
  } catch {
    // Without storage, a reopened draft asks for its files again.
  }
}

/** Whether a draft is still waiting to send: not sent, nor thrown away. */
function waiting(draftId: DraftId): boolean {
  const session = useComposerDraftStore.getState().getDraftSession(draftId);
  return session !== null && !session.promotedTo;
}

/** Whether the draft has it now. */
function has(entry: Kept): boolean {
  const draft = useComposerDraftStore.getState().getComposerDraft(DraftId.make(entry.draftId));
  return !!draft && (entry.image ? draft.images : draft.files).some((item) => item.id === entry.id);
}

function letGo(entries: ReadonlyArray<Kept>): void {
  if (entries.length === 0) return;
  const gone = new Set(entries.map((entry) => entry.key));
  setKeptList(keptList().filter((entry) => !gone.has(entry.key)));
  if (typeof caches === "undefined") return;
  void caches
    .open(CACHE)
    .then((cache) => Promise.all(entries.map((entry) => cache.delete(entry.key))))
    .catch(() => undefined);
}

/** While the app runs: what a draft sends, or the user removes from it, is let go. */
let unwatch: (() => void) | null = null;
function watch(): void {
  if (unwatch || keptList().length === 0) return;
  unwatch = useComposerDraftStore.subscribe(() => {
    letGo(keptList().filter((entry) => !has(entry)));
    if (keptList().length > 0) return;
    unwatch?.();
    unwatch = null;
  });
}

/** Keeps the bytes of what a share just put in a draft. */
export async function keepAldoDraftFiles(
  draftId: DraftId,
  attachments: ReadonlyArray<ComposerFileAttachment | ComposerImageAttachment>,
): Promise<void> {
  if (typeof caches === "undefined" || attachments.length === 0) return;
  const cache = await caches.open(CACHE);
  const kept: Kept[] = [];
  for (const attachment of attachments) {
    if (!attachment.file) continue;
    const key = `/aldo-draft-file/${attachment.id}`;
    try {
      await cache.put(key, new Response(attachment.file));
      kept.push({
        draftId,
        id: attachment.id,
        key,
        ...(attachment.type === "image"
          ? { image: { name: attachment.name, mimeType: attachment.mimeType } }
          : {}),
      });
    } catch {
      // No room on the device: a reopened draft asks for this one again.
    }
  }
  setKeptList([...keptList(), ...kept]);
  // Sent or removed meanwhile.
  letGo(kept.filter((entry) => !has(entry)));
  watch();
}

/**
 * As the app opens: gives the drafts still waiting to send something a share
 * put in them its bytes back (a file they ask for again, an image they
 * couldn't save), and lets go of the rest. Before anything else changes the
 * drafts.
 */
export async function restoreAldoDraftFiles(): Promise<void> {
  const list = keptList();
  if (typeof caches === "undefined" || list.length === 0) return;
  const cache = await caches.open(CACHE);
  const store = useComposerDraftStore.getState();
  const still: Kept[] = [];
  for (const entry of list) {
    const draftId = DraftId.make(entry.draftId);
    const marker = entry.image
      ? undefined
      : store.getComposerDraft(draftId)?.files.find((file) => file.id === entry.id);
    // A file the draft asks for again; an image it lost, while it still waits to send it.
    const wanted = entry.image
      ? waiting(draftId) && !has(entry)
      : !!marker && composerFileNeedsReattach(marker);
    const blob = wanted
      ? await cache
          .match(entry.key)
          .then((kept) => kept?.blob() ?? null)
          .catch(() => null)
      : null;
    if (!blob) {
      // Saved with the draft, sent, removed, or no longer here.
      await cache.delete(entry.key).catch(() => false);
      continue;
    }
    // A new id: the draft store replaces a file it asks for with one like it.
    const id = randomUUID();
    if (entry.image) {
      const file = new File([blob], entry.image.name, { type: entry.image.mimeType });
      store.addImages(draftId, [
        {
          type: "image",
          id,
          name: entry.image.name,
          mimeType: entry.image.mimeType,
          sizeBytes: file.size,
          previewUrl: URL.createObjectURL(file),
          file,
        },
      ]);
    } else if (marker) {
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
    }
    still.push({ ...entry, id });
  }
  setKeptList(still);
  watch();
}
