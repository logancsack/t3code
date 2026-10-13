// Share to Aldo: what a phone's share sheet sent opens in a new draft, ready
// to send (shareTarget.logic.ts). It's a General draft, or where a new thread
// opens on an Aldo without General threads. The words go in the prompt, the
// files the composer takes are attached as a pasted file would be, and a
// toast names the rest. Mounted once, in Aldo; as the app opens, it also gives
// drafts a share put files in their bytes back (shareDraftFiles.ts).

import { clampFileAttachmentUploadBytes } from "@t3tools/client-runtime/state/attachments";
import { PROVIDER_SEND_TURN_MAX_IMAGE_BYTES } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import {
  fileAttachmentStagingLimit,
  normalizeComposerImageFileMimeType,
} from "../components/chat/composerAttachmentFiles";
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
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentServerConfigsAtom } from "../state/server";
import { videoMimeType } from "../types";
import {
  aldoSupportsGeneralThreads,
  getAldoEnvironments,
  isAldoCloud,
  subscribeAldoEnvironments,
} from "./cloud";
import { useStartAldoThread } from "./newThread";
import { keepAldoDraftFiles, restoreAldoDraftFiles } from "./shareDraftFiles";
import { dropAldoShare, readAldoShare } from "./shareTarget";
import {
  ALDO_SHARE_LIMITS,
  aldoSharePrompt,
  aldoShareRefusedNotice,
  fitAldoSharedFiles,
  parseAldoShareParam,
  sortAldoSharedFiles,
  type AldoShareCandidate,
  type AldoShareParam,
  type AldoShareRefused,
} from "./shareTarget.logic";

/**
 * The shares still to open, oldest first, kept for this tab until each has:
 * when the session ran out, the page goes to sign in and comes back without
 * the address it had; and a share that comes while another opens (the app
 * opened again) waits its turn instead of taking the other's place.
 */
const PENDING_KEY = "aldo:share-pending";

function pendingIds(): string[] {
  try {
    const value = window.sessionStorage.getItem(PENDING_KEY);
    if (!value) return [];
    // An earlier version kept one id, as it is.
    const ids: unknown = value.startsWith("[") ? JSON.parse(value) : [value];
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function setPendingIds(ids: ReadonlyArray<string>): void {
  try {
    if (ids.length > 0) window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(ids));
    else window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Without storage each opens now or not at all.
  }
}

function keepPending(share: AldoShareParam): void {
  if (share.kind === "kept" && !pendingIds().includes(share.id)) {
    setPendingIds([...pendingIds(), share.id]);
  }
}

function forgetPending(share: AldoShareParam): void {
  if (share.kind === "kept") setPendingIds(pendingIds().filter((id) => id !== share.id));
}

/** Read before the router settles the address: those waiting (a sign-in came between, or one still opening), then the one the app was opened with. */
function sharesToOpen(): AldoShareParam[] {
  const waiting = pendingIds().flatMap((id) => {
    const share = parseAldoShareParam(`?share=${encodeURIComponent(id)}`);
    return share ? [share] : [];
  });
  const now = parseAldoShareParam(window.location.search);
  if (!now) return waiting;
  return [
    ...waiting.filter(
      (share) => now.kind !== "kept" || share.kind !== "kept" || share.id !== now.id,
    ),
    now,
  ];
}

let opened: AldoShareParam[] = typeof window === "undefined" || !isAldoCloud ? [] : sharesToOpen();

/** How long a share waits for Aldo's directory, which says whether General threads are there. */
const DIRECTORY_WAIT_MS = 30_000;
/** Then, on an Aldo without General threads, for the projects, which come in after the directory. */
const PROJECTS_WAIT_MS = 10_000;

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
    const shares = opened;
    opened = [];
    for (const share of shares) keepPending(share);
    // A reload doesn't open it again.
    const url = new URL(window.location.href);
    if (url.searchParams.has("share")) {
      url.searchParams.delete("share");
      window.history.replaceState(window.history.state, "", url);
    }
    void (async () => {
      await restoreAldoDraftFiles().catch(() => undefined);
      for (const share of shares) await receive(share, () => openers.current);
    })();
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

/** Where a new thread opens, once the projects have come in, waiting up to `ms`. */
async function defaultProject(
  current: () => Openers,
  ms: number,
): Promise<Openers["defaultProjectRef"]> {
  const until = Date.now() + ms;
  while (!current().defaultProjectRef && Date.now() < until) {
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
  return current().defaultProjectRef;
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
  // start says itself when it can't open one.
  if (aldoSupportsGeneralThreads()) return (await current().start([]))?.draftId ?? null;
  const projectRef = await defaultProject(current, PROJECTS_WAIT_MS);
  const draft = projectRef ? await current().handleNewThread(projectRef) : null;
  if (!draft) {
    toastManager.add({
      type: "error",
      title: "Couldn't open what you shared",
      description: "Start a thread in one of your projects, then share it again.",
    });
  }
  return draft?.draftId ?? null;
}

type Candidate = AldoShareCandidate<File>;

/**
 * The images, in the order shared, as a pasted image is (made smaller to fit
 * when over the limit), until as many are ready as a message takes; one that
 * can't be is refused (`unready`), and the next takes its place.
 */
async function prepareImages(
  candidates: ReadonlyArray<Candidate>,
  refused: AldoShareRefused[],
): Promise<{
  readonly ready: Map<Candidate, ComposerImageAttachment>;
  readonly unready: Set<Candidate>;
}> {
  const ready = new Map<Candidate, ComposerImageAttachment>();
  const unready = new Set<Candidate>();
  for (const candidate of candidates) {
    if (candidate.kind !== "image") continue;
    if (ready.size >= ALDO_SHARE_LIMITS.attachments) break;
    const shared = candidate.file;
    const prepared = await prepareImageForAttachment(
      normalizeComposerImageFileMimeType(shared),
      PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
    );
    if (!prepared.ok) {
      unready.add(candidate);
      refused.push({
        name: shared.name || "image",
        why: prepared.reason === "unreadable" ? "unreadable" : "image-too-large",
      });
      continue;
    }
    const file = prepared.file;
    ready.set(candidate, {
      type: "image",
      id: randomUUID(),
      name: file.name || "image",
      mimeType: file.type,
      sizeBytes: file.size,
      previewUrl: URL.createObjectURL(file),
      file,
    });
  }
  return { ready, unready };
}

/** The largest file the draft's computer takes, as its composer says; null when it takes none. */
function draftFileBytes(draftId: DraftId): number | null {
  const environmentId = useComposerDraftStore.getState().getDraftSession(draftId)?.environmentId;
  const config = environmentId
    ? (appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId) ?? null)
    : null;
  const advertised = config?.environment.capabilities.fileAttachments?.maxUploadBytes ?? null;
  return fileAttachmentStagingLimit({
    attachmentUploadsCapabilityKnown: config !== null,
    supportsAttachmentUploads: config?.environment.capabilities.attachmentUploads === true,
    maxFileAttachmentBytes: advertised === null ? null : clampFileAttachmentUploadBytes(advertised),
  });
}

function attachFiles(draftId: DraftId, files: ReadonlyArray<File>): ComposerFileAttachment[] {
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
  return attachments;
}

async function receive(share: AldoShareParam, current: () => Openers): Promise<void> {
  // On a fresh load the toasts start listening after this mounts.
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  if (share.kind === "missed") return missed();
  try {
    const kept = await readAldoShare(share.id).catch(() => null);
    const prompt = kept ? aldoSharePrompt(kept.details) : "";
    if (!kept || (!prompt && kept.details.files.length === 0)) return missed();
    const sorted = sortAldoSharedFiles(kept.files);
    const refused: AldoShareRefused[] = [
      ...kept.missing.map((name): AldoShareRefused => ({ name, why: "missing" })),
      ...sorted.refused,
    ];
    // Ready before the draft shows, so it can't be sent without them.
    const images = await prepareImages(sorted.candidates, refused);
    const draftId = await openDraft(current);
    if (!draftId) {
      for (const image of images.ready.values()) URL.revokeObjectURL(image.previewUrl);
      return;
    }
    // As many as a message takes, in the order shared; files as the draft's computer takes them.
    const limits = { ...ALDO_SHARE_LIMITS, fileBytes: draftFileBytes(draftId) };
    const fit = fitAldoSharedFiles(sorted.candidates, images.unready, limits);
    refused.push(...fit.refused);
    const taken = new Set(fit.taken);
    for (const [candidate, image] of images.ready) {
      if (!taken.has(candidate)) URL.revokeObjectURL(image.previewUrl);
    }
    if (prompt) useComposerDraftStore.getState().setPrompt(draftId, prompt);
    const files = attachFiles(
      draftId,
      fit.taken.filter((candidate) => candidate.kind === "file").map((candidate) => candidate.file),
    );
    const ready = fit.taken.flatMap((candidate) => images.ready.get(candidate) ?? []);
    if (ready.length > 0) useComposerDraftStore.getState().addImages(draftId, ready);
    const notice = aldoShareRefusedNotice(refused, limits);
    if (notice) toastManager.add({ type: "warning", ...notice });
    await keepAldoDraftFiles(draftId, files).catch(() => undefined);
  } finally {
    forgetPending(share);
    await dropAldoShare(share.id).catch(() => undefined);
  }
}
