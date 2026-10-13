import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  type ComposerFileAttachment,
  composerFileNeedsReattach,
  DraftId,
  useComposerDraftStore,
} from "../composerDraftStore";
import { keepAldoDraftFiles, restoreAldoDraftFiles } from "./shareDraftFiles";

const draftId = DraftId.make("draft-shared");

function makeFile(id: string, text = "report"): ComposerFileAttachment {
  const file = new File([text], "report.pdf", { type: "application/pdf" });
  return { type: "file", id, name: file.name, mimeType: file.type, sizeBytes: file.size, file };
}

/** The draft as a reload leaves it: the file by name only. */
function reload(): void {
  const store = useComposerDraftStore.getState();
  for (const file of store.getComposerDraft(draftId)?.files ?? []) {
    store.removeFile(draftId, file.id);
    store.addFiles(draftId, [{ ...file, file: null }]);
  }
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

describe("shared files kept for a draft", () => {
  let cached: Map<string, Blob>;

  beforeEach(() => {
    useComposerDraftStore.setState({ draftsByThreadKey: {}, draftThreadsByThreadKey: {} });
    cached = stubDevice();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("go back in a reopened draft that still waits to send them", async () => {
    const shared = makeFile("file-shared", "the shared bytes");
    useComposerDraftStore.getState().addFiles(draftId, [shared]);
    await keepAldoDraftFiles(draftId, [shared]);
    reload();
    expect(
      useComposerDraftStore
        .getState()
        .getComposerDraft(draftId)
        ?.files.every(composerFileNeedsReattach),
    ).toBe(true);

    await restoreAldoDraftFiles();

    const files = useComposerDraftStore.getState().getComposerDraft(draftId)?.files ?? [];
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe("report.pdf");
    expect(await files[0]?.file?.text()).toBe("the shared bytes");
    expect(cached.size).toBe(1);

    // Kept under the file's new id, so the next reopen finds it again.
    reload();
    await restoreAldoDraftFiles();
    const again = useComposerDraftStore.getState().getComposerDraft(draftId)?.files ?? [];
    expect(await again[0]?.file?.text()).toBe("the shared bytes");
  });

  it("are let go once the draft no longer has them", async () => {
    const shared = makeFile("file-shared");
    useComposerDraftStore.getState().addFiles(draftId, [shared]);
    await keepAldoDraftFiles(draftId, [shared]);
    useComposerDraftStore.getState().removeFile(draftId, "file-shared");

    await restoreAldoDraftFiles();

    expect(cached.size).toBe(0);
    expect(window.localStorage.getItem("aldo:share-draft-files")).toBeNull();
  });

  it("are let go once the draft has the file's bytes or upload already", async () => {
    const shared = makeFile("file-shared");
    useComposerDraftStore.getState().addFiles(draftId, [shared]);
    await keepAldoDraftFiles(draftId, [shared]);

    await restoreAldoDraftFiles();

    expect(cached.size).toBe(0);
    expect(useComposerDraftStore.getState().getComposerDraft(draftId)?.files[0]?.id).toBe(
      "file-shared",
    );
  });
});
