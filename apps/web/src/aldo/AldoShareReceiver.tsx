// Share to Aldo: what a phone's share sheet sent opens in a new draft, ready
// to send (shareTarget.logic.ts). It's a General draft, or where a new thread
// opens on an Aldo without General threads. The words go in the prompt, the
// files the composer takes are attached as a pasted file would be, and a
// toast names the rest. Mounted once, in Aldo.

import { PROVIDER_SEND_TURN_MAX_IMAGE_BYTES } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { normalizeComposerImageFileMimeType } from "../components/chat/composerAttachmentFiles";
import { toastManager } from "../components/ui/toast";
import {
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  type DraftId,
  useComposerDraftStore,
} from "../composerDraftStore";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { prepareImageForAttachment } from "../lib/imageCompression";
import { randomUUID } from "../lib/utils";
import { videoMimeType } from "../types";
import {
  aldoSupportsGeneralThreads,
  getAldoEnvironments,
  isAldoCloud,
  subscribeAldoEnvironments,
} from "./cloud";
import { useStartAldoThread } from "./newThread";
import { dropAldoShare, readAldoShare } from "./shareTarget";
import {
  aldoSharePrompt,
  aldoShareRefusedNotice,
  parseAldoShareParam,
  sortAldoSharedFiles,
  type AldoShareParam,
  type AldoShareRefused,
} from "./shareTarget.logic";

/** Read before the router settles the address: the share the app was opened with. */
let opened: AldoShareParam | null =
  typeof window === "undefined" || !isAldoCloud
    ? null
    : parseAldoShareParam(window.location.search);

/** How long a share waits for Aldo's directory, which says whether General threads are there. */
const DIRECTORY_WAIT_MS = 30_000;

interface Openers {
  readonly start: ReturnType<typeof useStartAldoThread>["start"];
  readonly handleNewThread: ReturnType<typeof useHandleNewThread>["handleNewThread"];
  readonly defaultProjectRef: ReturnType<typeof useHandleNewThread>["defaultProjectRef"];
}

/** Mounted once: opens the share the app was opened with, if any. */
export function AldoShareReceiver() {
  const { start } = useStartAldoThread();
  const { handleNewThread, defaultProjectRef } = useHandleNewThread();
  // A render-synced mirror: the share opens after awaits, with what's current then.
  const openers = useRef<Openers>({ start, handleNewThread, defaultProjectRef });
  openers.current = { start, handleNewThread, defaultProjectRef };
  useEffect(() => {
    const share = opened;
    opened = null;
    if (!share) return;
    // A reload doesn't open it again.
    const url = new URL(window.location.href);
    url.searchParams.delete("share");
    window.history.replaceState(window.history.state, "", url);
    void receive(share, () => openers.current);
  }, []);
  return null;
}

function missed(): void {
  toastManager.add({
    type: "error",
    title: "What you shared didn't reach Aldo",
    description: "Share it again.",
  });
}

/** Whether Aldo's directory has loaded, waiting for it up to `ms`. */
function directoryLoaded(ms: number): Promise<boolean> {
  if (getAldoEnvironments() !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let timer = 0;
    const unsubscribe = subscribeAldoEnvironments(() => {
      if (getAldoEnvironments() === null) return;
      window.clearTimeout(timer);
      unsubscribe();
      resolve(true);
    });
    timer = window.setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, ms);
  });
}

async function openDraft(current: () => Openers): Promise<DraftId | null> {
  if (!(await directoryLoaded(DIRECTORY_WAIT_MS))) {
    toastManager.add({
      type: "error",
      title: "Couldn't open what you shared",
      description: "Aldo can't be reached just now. Share it again.",
    });
    return null;
  }
  const { start, handleNewThread, defaultProjectRef } = current();
  // start says itself when it can't open one.
  if (aldoSupportsGeneralThreads()) return (await start([]))?.draftId ?? null;
  const draft = defaultProjectRef ? await handleNewThread(defaultProjectRef) : null;
  if (!draft) {
    toastManager.add({
      type: "error",
      title: "Couldn't open what you shared",
      description: "Start a thread in one of your projects, then share it again.",
    });
  }
  return draft?.draftId ?? null;
}

async function attachImages(
  draftId: DraftId,
  files: ReadonlyArray<File>,
  refused: AldoShareRefused[],
): Promise<void> {
  const images: ComposerImageAttachment[] = [];
  for (const shared of files) {
    // As a pasted image: made smaller to fit when it's over the limit.
    const prepared = await prepareImageForAttachment(
      normalizeComposerImageFileMimeType(shared),
      PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
    );
    if (!prepared.ok) {
      refused.push({
        name: shared.name || "image",
        why: prepared.reason === "unreadable" ? "unreadable" : "image-too-large",
      });
      continue;
    }
    const file = prepared.file;
    images.push({
      type: "image",
      id: randomUUID(),
      name: file.name || "image",
      mimeType: file.type,
      sizeBytes: file.size,
      previewUrl: URL.createObjectURL(file),
      file,
    });
  }
  if (images.length > 0) useComposerDraftStore.getState().addImages(draftId, images);
}

function attachFiles(draftId: DraftId, files: ReadonlyArray<File>): void {
  const attachments = files.map((shared): ComposerFileAttachment => {
    const mimeType =
      videoMimeType({ name: shared.name, mimeType: shared.type }) ??
      (shared.type || "application/octet-stream");
    const file =
      shared.type === mimeType
        ? shared
        : new File([shared], shared.name, { type: mimeType, lastModified: shared.lastModified });
    return {
      type: "file",
      id: randomUUID(),
      name: file.name || "file",
      mimeType,
      sizeBytes: file.size,
      file,
    };
  });
  if (attachments.length > 0) useComposerDraftStore.getState().addFiles(draftId, attachments);
}

async function receive(share: AldoShareParam, current: () => Openers): Promise<void> {
  // On a fresh load the toasts start listening after this mounts.
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  if (share.kind === "missed") return missed();
  try {
    const kept = await readAldoShare(share.id).catch(() => null);
    const prompt = kept ? aldoSharePrompt(kept.details) : "";
    if (!kept || (!prompt && kept.details.files.length === 0)) return missed();
    const draftId = await openDraft(current);
    if (!draftId) return;
    if (prompt) useComposerDraftStore.getState().setPrompt(draftId, prompt);
    const sorted = sortAldoSharedFiles(kept.files);
    const refused: AldoShareRefused[] = [
      ...kept.missing.map((name): AldoShareRefused => ({ name, why: "missing" })),
      ...sorted.refused,
    ];
    attachFiles(draftId, sorted.files);
    await attachImages(draftId, sorted.images, refused);
    const notice = aldoShareRefusedNotice(refused);
    if (notice) toastManager.add({ type: "warning", ...notice });
  } finally {
    await dropAldoShare(share.id).catch(() => undefined);
  }
}
