import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { ComposerFileAttachment, ComposerImageAttachment } from "../composerDraftStore";

const DRAFT = "draft-shared";

type Modules = {
  readonly store: typeof import("../composerDraftStore");
  readonly kept: typeof import("./shareDraftFiles");
};

/** The app as it opens: its modules fresh (the drafts as they were saved are set up by each test). */
async function open(): Promise<Modules> {
  vi.resetModules();
  return { store: await import("../composerDraftStore"), kept: await import("./shareDraftFiles") };
}

function makeFile(id: string, text: string): ComposerFileAttachment {
  const file = new File([text], "report.pdf", { type: "application/pdf" });
  return { type: "file", id, name: file.name, mimeType: file.type, sizeBytes: file.size, file };
}

function makeImage(id: string, text: string): ComposerImageAttachment {
  const file = new File([text], "photo.jpg", { type: "image/jpeg" });
  return {
    type: "image",
    id,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    previewUrl: "blob:photo",
    file,
  };
}

/** The draft as the app finds it on opening: still waiting to send (or not), with what it could save. */
function reopened(
  { store }: Modules,
  saved: { files?: ComposerFileAttachment[]; images?: ComposerImageAttachment[]; sent?: boolean },
): void {
  const draftId = store.DraftId.make(DRAFT);
  store.useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {
      [DRAFT]: { promotedTo: saved.sent ? { threadId: "t" } : null } as never,
    },
  });
  const state = store.useComposerDraftStore.getState();
  state.setPrompt(draftId, "Look at this");
  if (saved.files) state.addFiles(draftId, saved.files);
  if (saved.images) state.addImages(draftId, saved.images);
}

function draftOf({ store }: Modules) {
  return store.useComposerDraftStore.getState().getComposerDraft(store.DraftId.make(DRAFT));
}

function stubDevice(): Map<string, Blob> {
  const entries = new Map<string, Blob>();
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
  const cache = {
    put: async (key: string, response: Response) => void entries.set(key, await response.blob()),
    match: async (key: string) => {
      const blob = entries.get(key);
      return blob ? new Response(blob) : undefined;
    },
    delete: async (key: string) => entries.delete(key),
  };
  vi.stubGlobal("window", { localStorage: storage });
  vi.stubGlobal("caches", { open: async () => cache });
  return entries;
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("what a share put in a draft, kept on the device", () => {
  let cached: Map<string, Blob>;

  beforeEach(() => {
    cached = stubDevice();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gives a reopened draft a file back, each time it's reopened until sent", async () => {
    const shared = makeFile("file-shared", "the shared bytes");
    const first = await open();
    reopened(first, { files: [shared] });
    await first.kept.keepAldoDraftFiles(first.store.DraftId.make(DRAFT), [shared]);

    // Saved by name alone.
    const second = await open();
    reopened(second, { files: [{ ...shared, file: null }] });
    await second.kept.restoreAldoDraftFiles();
    const files = draftOf(second)?.files ?? [];
    expect(files).toHaveLength(1);
    expect(await files[0]?.file?.text()).toBe("the shared bytes");

    const third = await open();
    reopened(third, { files: [{ ...files[0]!, file: null }] });
    await third.kept.restoreAldoDraftFiles();
    expect(await draftOf(third)?.files[0]?.file?.text()).toBe("the shared bytes");
  });

  it("gives a reopened draft an image back that it couldn't save, and lets go of one it did", async () => {
    const shared = makeImage("image-shared", "the photo");
    const first = await open();
    reopened(first, { images: [shared] });
    await first.kept.keepAldoDraftFiles(first.store.DraftId.make(DRAFT), [shared]);

    // Too large to save: the draft has its words alone.
    const second = await open();
    reopened(second, {});
    await second.kept.restoreAldoDraftFiles();
    const images = draftOf(second)?.images ?? [];
    expect(images).toHaveLength(1);
    expect(images[0]?.name).toBe("photo.jpg");
    expect(await images[0]?.file.text()).toBe("the photo");

    // Saved this time.
    const third = await open();
    reopened(third, { images: [images[0]!] });
    await third.kept.restoreAldoDraftFiles();
    expect(draftOf(third)?.images).toHaveLength(1);
    expect(cached.size).toBe(0);
    expect(window.localStorage.getItem("aldo:share-draft-files")).toBeNull();
  });

  it("lets go of what the user removes from the draft, at once", async () => {
    const file = makeFile("file-shared", "a file");
    const image = makeImage("image-shared", "a photo");
    const app = await open();
    reopened(app, { files: [file], images: [image] });
    await app.kept.keepAldoDraftFiles(app.store.DraftId.make(DRAFT), [file, image]);
    expect(cached.size).toBe(2);

    app.store.useComposerDraftStore.getState().removeImage(app.store.DraftId.make(DRAFT), image.id);
    await settled();
    expect(cached.size).toBe(1);

    app.store.useComposerDraftStore.getState().removeFile(app.store.DraftId.make(DRAFT), file.id);
    await settled();
    expect(cached.size).toBe(0);
    expect(window.localStorage.getItem("aldo:share-draft-files")).toBeNull();
  });

  it("lets go of an image whose draft was sent", async () => {
    const shared = makeImage("image-shared", "the photo");
    const first = await open();
    reopened(first, { images: [shared] });
    await first.kept.keepAldoDraftFiles(first.store.DraftId.make(DRAFT), [shared]);

    const second = await open();
    reopened(second, { sent: true });
    await second.kept.restoreAldoDraftFiles();
    expect(draftOf(second)?.images ?? []).toHaveLength(0);
    expect(cached.size).toBe(0);
  });
});
