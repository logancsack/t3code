import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import * as Schema from "effect/Schema";
import {
  defaultInstanceIdForDriver,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  ThreadId,
  type ModelSelection,
  type PreviewAnnotationPayload,
  type ProviderOptionSelection,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import {
  collectAssistantCitations,
  serializeAssistantCitation,
} from "@t3tools/shared/assistantCitations";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// The composer draft's `modelSelectionByProvider` and
// `stickyModelSelectionByProvider` maps are keyed by `ProviderInstanceId`
// in production; these aliases keep the legacy-key migration tests concise.
const CODEX_INSTANCE = ProviderInstanceId.make("codex");
const CLAUDE_AGENT_INSTANCE = ProviderInstanceId.make("claudeAgent");
const CODEX_DRIVER = ProviderDriverKind.make("codex");
const CLAUDE_AGENT_DRIVER = ProviderDriverKind.make("claudeAgent");

type ProviderOptionSelectionBag = ReadonlyArray<ProviderOptionSelection>;
type ProviderOptionSelectionsByProvider = Partial<Record<string, ProviderOptionSelectionBag>>;

function toSelections(
  options: Record<string, string | boolean | undefined> | undefined,
): ReadonlyArray<ProviderOptionSelection> {
  const result: Array<ProviderOptionSelection> = [];
  if (!options) return result;
  for (const [id, value] of Object.entries(options)) {
    if (typeof value === "string" || typeof value === "boolean") {
      result.push({ id, value });
    }
  }
  return result;
}

function selectionsByProvider(
  options: Partial<Record<ProviderDriverKind, Record<string, string | boolean | undefined>>>,
): ProviderOptionSelectionsByProvider {
  const result: ProviderOptionSelectionsByProvider = {};
  for (const [provider, bag] of Object.entries(options) as Array<
    [ProviderDriverKind, Record<string, string | boolean | undefined>]
  >) {
    result[provider] = toSelections(bag);
  }
  return result;
}

import {
  COMPOSER_DRAFT_STORAGE_KEY,
  clearComposerDraftsEnvironment,
  finalizePromotedDraftThreadByRef,
  markPromotedDraftThreadByRef,
  restoreFailedBackgroundDraftThread,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  composerFileNeedsReattach,
  partializeComposerDraftStoreState,
  useComposerDraftStore,
  DraftId,
} from "./composerDraftStore";
import { removeLocalStorageItem, setLocalStorageItem } from "./hooks/useLocalStorage";
import { formatTerminalContextReference, type TerminalContextDraft } from "./lib/terminalContext";
import { createDeferredStorage } from "./lib/storage";

function makeImage(input: {
  id: string;
  previewUrl: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  lastModified?: number;
}): ComposerImageAttachment {
  const name = input.name ?? "image.png";
  const mimeType = input.mimeType ?? "image/png";
  const sizeBytes = input.sizeBytes ?? 4;
  const lastModified = input.lastModified ?? 1_700_000_000_000;
  const file = new File([new Uint8Array(sizeBytes).fill(1)], name, {
    type: mimeType,
    lastModified,
  });
  return {
    type: "image",
    id: input.id,
    name,
    mimeType,
    sizeBytes: file.size,
    previewUrl: input.previewUrl,
    file,
  };
}

function makeFile(id: string): ComposerFileAttachment {
  const file = new File(["report"], "report.pdf", { type: "application/pdf" });
  return {
    type: "file",
    id,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    file,
  };
}

function makeTerminalContext(input: {
  id: string;
  text?: string;
  terminalId?: string;
  terminalLabel?: string;
  lineStart?: number;
  lineEnd?: number;
}): TerminalContextDraft {
  return {
    id: input.id,
    threadId: ThreadId.make("thread-dedupe"),
    terminalId: input.terminalId ?? "default",
    terminalLabel: input.terminalLabel ?? "Terminal 1",
    lineStart: input.lineStart ?? 4,
    lineEnd: input.lineEnd ?? 5,
    text: input.text ?? "git status\nOn branch main",
    createdAt: "2026-03-13T12:00:00.000Z",
  };
}

function resetComposerDraftStore() {
  useComposerDraftStore.setState({
    rewindingThreadKeys: new Set(),
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    stickyModelSelectionByProvider: {},
    stickyActiveProvider: null,
  });
}

function modelSelection(
  provider: ProviderDriverKind,
  model: string,
  options?: Record<string, string | boolean | undefined>,
): ModelSelection {
  return createModelSelection(defaultInstanceIdForDriver(provider), model, toSelections(options));
}

function providerModelOptions(
  options: Partial<Record<string, Record<string, string | boolean | undefined>>>,
): ProviderOptionSelectionsByProvider {
  return selectionsByProvider(options);
}

const TEST_ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const OTHER_TEST_ENVIRONMENT_ID = EnvironmentId.make("environment-remote");
const LEGACY_TEST_ENVIRONMENT_ID = EnvironmentId.make("__legacy__");

function threadKeyFor(
  threadId: ThreadId,
  environmentId: EnvironmentId = LEGACY_TEST_ENVIRONMENT_ID,
): string {
  if (environmentId === LEGACY_TEST_ENVIRONMENT_ID) {
    return threadId;
  }
  return scopedThreadKey(scopeThreadRef(environmentId, threadId));
}

function draftFor(threadId: ThreadId, environmentId: EnvironmentId = LEGACY_TEST_ENVIRONMENT_ID) {
  const store = useComposerDraftStore.getState().draftsByThreadKey;
  return store[threadKeyFor(threadId, environmentId)] ?? store[threadId] ?? undefined;
}

function draftByKey(key: string) {
  return useComposerDraftStore.getState().draftsByThreadKey[key] ?? undefined;
}

describe("composerDraftStore assistant citations", () => {
  beforeEach(resetComposerDraftStore);
  afterEach(resetComposerDraftStore);

  it("keeps quotes, comments, and remote source IDs through persistence and removes them on clear", async () => {
    await useComposerDraftStore.persist.clearStorage();
    vi.useFakeTimers();
    try {
      const threadId = ThreadId.make("citation-draft");
      const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);
      const citation = {
        version: 1 as const,
        environmentId: EnvironmentId.make("remote-source"),
        threadId: ThreadId.make("source-thread"),
        messageId: MessageId.make("source-message"),
        text: "Preserve the selected text after reload.",
        comment: "Why is this important?\nPlease show an example.",
        start: 12,
        end: 52,
        prefix: "Before. ",
        suffix: " After.",
      };
      const prompt = `Explain ${serializeAssistantCitation(citation)} further.`;
      useComposerDraftStore.getState().setPrompt(threadRef, prompt);
      await vi.advanceTimersByTimeAsync(300);
      resetComposerDraftStore();
      await useComposerDraftStore.persist.rehydrate();
      const restored = draftFor(threadId, TEST_ENVIRONMENT_ID)?.prompt ?? "";
      expect(restored).toBe(prompt);
      expect(collectAssistantCitations(restored).map((entry) => entry.citation)).toEqual([
        citation,
      ]);
      useComposerDraftStore.getState().clearComposerContent(threadRef);
      expect(
        collectAssistantCitations(draftFor(threadId, TEST_ENVIRONMENT_ID)?.prompt ?? ""),
      ).toEqual([]);
    } finally {
      await useComposerDraftStore.persist.clearStorage();
      vi.useRealTimers();
    }
  });
});

describe("composerDraftStore addImages", () => {
  const threadId = ThreadId.make("thread-dedupe");
  const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);
  let originalRevokeObjectUrl: typeof URL.revokeObjectURL;
  let revokeSpy: ReturnType<typeof vi.fn<(url: string) => void>>;

  beforeEach(() => {
    resetComposerDraftStore();
    originalRevokeObjectUrl = URL.revokeObjectURL;
    revokeSpy = vi.fn();
    URL.revokeObjectURL = revokeSpy;
  });

  afterEach(() => {
    URL.revokeObjectURL = originalRevokeObjectUrl;
  });

  it("restores images with matching metadata without replacing unsent bytes", () => {
    const store = useComposerDraftStore.getState();
    const unsent = makeImage({ id: "unsent", previewUrl: "blob:unsent" });
    const restored = {
      ...unsent,
      id: "restored",
      previewUrl: "blob:restored",
      file: new File([new Uint8Array(unsent.sizeBytes).fill(2)], unsent.name, {
        type: unsent.mimeType,
        lastModified: unsent.file.lastModified,
      }),
    };
    store.addImages(threadRef, [unsent]);
    store.addImages(threadRef, [restored, restored], { allowDuplicates: true });

    const images = store.getComposerDraft(threadRef)?.images;
    expect(images?.map((image) => image.id)).toEqual(["unsent", "restored"]);
    expect(images?.[0]?.file).toBe(unsent.file);
    expect(images?.[1]?.file).toBe(restored.file);
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it("does not revoke blob URLs that are still used by an accepted duplicate image", () => {
    const first = makeImage({
      id: "img-shared",
      previewUrl: "blob:shared",
    });
    const duplicateSameUrl = makeImage({
      id: "img-shared",
      previewUrl: "blob:shared",
    });

    useComposerDraftStore.getState().addImages(threadRef, [first, duplicateSameUrl]);

    const draft = draftFor(threadId, TEST_ENVIRONMENT_ID);
    expect(draft?.images.map((image) => image.id)).toEqual(["img-shared"]);
    expect(revokeSpy).not.toHaveBeenCalledWith("blob:shared");
  });
});

describe("composerDraftStore file attachments", () => {
  const threadId = ThreadId.make("thread-files");
  const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("persists uploaded file references without including file contents", () => {
    const store = useComposerDraftStore.getState();
    store.addFiles(threadRef, [
      { ...makeFile("file-1"), source: { _tag: "pasted-text" as const } },
    ]);
    store.setFileUpload(threadRef, "file-1", TEST_ENVIRONMENT_ID, "pending-report-pdf");

    const persistApi = useComposerDraftStore.persist as unknown as {
      getOptions: () => {
        merge: (
          persistedState: unknown,
          currentState: ReturnType<typeof useComposerDraftStore.getState>,
        ) => ReturnType<typeof useComposerDraftStore.getState>;
      };
    };
    const options = persistApi.getOptions();
    const persisted = partializeComposerDraftStoreState(useComposerDraftStore.getState());

    expect(persisted.draftsByThreadKey[threadKeyFor(threadId, TEST_ENVIRONMENT_ID)]?.files).toEqual(
      [
        {
          id: "file-1",
          name: "report.pdf",
          mimeType: "application/pdf",
          sizeBytes: 6,
          attachmentId: "pending-report-pdf",
          environmentId: TEST_ENVIRONMENT_ID,
          source: { _tag: "pasted-text" },
        },
      ],
    );

    const hydrated = options.merge(persisted, useComposerDraftStore.getState());
    expect(hydrated.draftsByThreadKey[threadKeyFor(threadId, TEST_ENVIRONMENT_ID)]?.files).toEqual([
      {
        type: "file",
        id: "file-1",
        name: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 6,
        file: null,
        uploadedAttachmentId: "pending-report-pdf",
        uploadEnvironmentId: TEST_ENVIRONMENT_ID,
        source: { _tag: "pasted-text" },
      },
    ]);
  });

  it("persists a pending file as a needs-reattach marker instead of dropping it", () => {
    const store = useComposerDraftStore.getState();
    // No setFileUpload: the upload never finished, so there is no attachment
    // id and the File handle cannot serialize.
    store.addFiles(threadRef, [makeFile("file-pending")]);

    const persistApi = useComposerDraftStore.persist as unknown as {
      getOptions: () => {
        merge: (
          persistedState: unknown,
          currentState: ReturnType<typeof useComposerDraftStore.getState>,
        ) => ReturnType<typeof useComposerDraftStore.getState>;
      };
    };
    const options = persistApi.getOptions();
    const persisted = partializeComposerDraftStoreState(useComposerDraftStore.getState());

    expect(persisted.draftsByThreadKey[threadKeyFor(threadId, TEST_ENVIRONMENT_ID)]?.files).toEqual(
      [
        {
          id: "file-pending",
          name: "report.pdf",
          mimeType: "application/pdf",
          sizeBytes: 6,
        },
      ],
    );

    const hydrated = options.merge(persisted, useComposerDraftStore.getState());
    const hydratedFiles =
      hydrated.draftsByThreadKey[threadKeyFor(threadId, TEST_ENVIRONMENT_ID)]?.files;
    expect(hydratedFiles).toEqual([
      {
        type: "file",
        id: "file-pending",
        name: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 6,
        file: null,
      },
    ]);
    expect(hydratedFiles?.every(composerFileNeedsReattach)).toBe(true);
  });

  it("enforces the combined file and image limit across separate updates", () => {
    const store = useComposerDraftStore.getState();
    const images = Array.from({ length: PROVIDER_SEND_TURN_MAX_ATTACHMENTS - 1 }, (_, index) =>
      makeImage({
        id: `image-${index}`,
        name: `image-${index}.png`,
        previewUrl: `blob:image-${index}`,
      }),
    );
    store.addImages(threadRef, images);
    store.addFiles(threadRef, [
      makeFile("file-accepted"),
      { ...makeFile("file-overflow"), name: "other.pdf" },
    ]);
    expect(
      store.addImage(
        threadRef,
        makeImage({ id: "image-overflow", name: "overflow.png", previewUrl: "blob:overflow" }),
      ),
    ).toBe(false);

    const draft = store.getComposerDraft(threadRef);
    expect(draft?.images).toHaveLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS - 1);
    expect(draft?.files.map((file) => file.id)).toEqual(["file-accepted"]);
  });

  it("replaces a needs-reattach marker when the same file is picked again", () => {
    const store = useComposerDraftStore.getState();
    // A hydrated marker: same metadata as the original pick, no bytes and no
    // server-side upload.
    const marker: ComposerFileAttachment = { ...makeFile("file-marker"), file: null };
    store.addFiles(threadRef, [marker]);
    expect(store.getComposerDraft(threadRef)?.files.every(composerFileNeedsReattach)).toBe(true);

    // Following the "Attach again" instruction produces a fresh id with the
    // exact metadata the dedup key hashes.
    const repicked = makeFile("file-repicked");
    store.addFiles(threadRef, [repicked]);

    const files = store.getComposerDraft(threadRef)?.files;
    expect(files?.map((file) => file.id)).toEqual(["file-repicked"]);
    expect(files?.[0]?.file).not.toBeNull();
    expect(files?.some(composerFileNeedsReattach)).toBe(false);
  });

  it("restores files with matching metadata without replacing unsent bytes", () => {
    const store = useComposerDraftStore.getState();
    const unsent = makeFile("unsent");
    const restored = {
      ...unsent,
      id: "restored",
      file: new File(["edited"], unsent.name, { type: unsent.mimeType }),
    };
    store.addFiles(threadRef, [unsent]);
    store.addFiles(threadRef, [restored, restored], { allowDuplicates: true });

    const files = store.getComposerDraft(threadRef)?.files;
    expect(files?.map((file) => file.id)).toEqual(["unsent", "restored"]);
    expect(files?.[0]?.file).toBe(unsent.file);
    expect(files?.[1]?.file).toBe(restored.file);
  });
});

describe("composerDraftStore syncPersistedAttachments", () => {
  const threadId = ThreadId.make("thread-sync-persisted");
  const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);

  beforeEach(() => {
    removeLocalStorageItem(COMPOSER_DRAFT_STORAGE_KEY);
    useComposerDraftStore.setState({
      draftsByThreadKey: {},
      draftThreadsByThreadKey: {},
      logicalProjectDraftThreadKeyByLogicalProjectKey: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    });
  });

  afterEach(() => {
    removeLocalStorageItem(COMPOSER_DRAFT_STORAGE_KEY);
  });

  it("treats malformed persisted draft storage as empty", async () => {
    const image = makeImage({
      id: "img-persisted",
      previewUrl: "blob:persisted",
    });
    useComposerDraftStore.getState().addImage(threadRef, image);
    setLocalStorageItem(
      COMPOSER_DRAFT_STORAGE_KEY,
      {
        version: 2,
        state: {
          draftsByThreadId: {
            [threadId]: {
              attachments: "not-an-array",
            },
          },
        },
      },
      Schema.Unknown,
    );

    useComposerDraftStore.getState().syncPersistedAttachments(threadRef, [
      {
        id: image.id,
        name: image.name,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        dataUrl: image.previewUrl,
      },
    ]);
    await Promise.resolve();

    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)?.persistedAttachments).toEqual([]);
    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)?.nonPersistedImageIds).toEqual([image.id]);
  });
});

describe("composerDraftStore terminal contexts", () => {
  const threadId = ThreadId.make("thread-dedupe");
  const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);

  beforeEach(() => {
    useComposerDraftStore.setState({
      draftsByThreadKey: {},
      draftThreadsByThreadKey: {},
      logicalProjectDraftThreadKeyByLogicalProjectKey: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    });
  });

  it("persists terminal context snapshot text", () => {
    useComposerDraftStore
      .getState()
      .addTerminalContext(threadRef, makeTerminalContext({ id: "ctx-persist" }));

    const persistedState = partializeComposerDraftStoreState(
      useComposerDraftStore.getState(),
    ) as unknown as {
      draftsByThreadKey?: Record<string, { terminalContexts?: Array<Record<string, unknown>> }>;
    };

    expect(
      persistedState.draftsByThreadKey?.[threadKeyFor(threadId, TEST_ENVIRONMENT_ID)]
        ?.terminalContexts?.[0],
      "Expected terminal context metadata to be persisted.",
    ).toMatchObject({
      id: "ctx-persist",
      terminalId: "default",
      terminalLabel: "Terminal 1",
      lineStart: 4,
      lineEnd: 5,
    });
    expect(
      persistedState.draftsByThreadKey?.[threadKeyFor(threadId, TEST_ENVIRONMENT_ID)]
        ?.terminalContexts?.[0]?.text,
    ).toBe(makeTerminalContext({ id: "ctx-persist" }).text);
  });

  it("sanitizes malformed persisted drafts during merge", () => {
    const persistApi = useComposerDraftStore.persist as unknown as {
      getOptions: () => {
        merge: (
          persistedState: unknown,
          currentState: ReturnType<typeof useComposerDraftStore.getState>,
        ) => ReturnType<typeof useComposerDraftStore.getState>;
      };
    };
    const mergedState = persistApi.getOptions().merge(
      {
        draftsByThreadId: {
          [threadId]: {
            prompt: "",
            attachments: "not-an-array",
            terminalContexts: "not-an-array",
            provider: "bogus-provider",
            modelOptions: "not-an-object",
          },
        },
        draftThreadsByThreadId: "not-an-object",
        projectDraftThreadIdByProjectKey: "not-an-object",
      },
      useComposerDraftStore.getInitialState(),
    );

    expect(mergedState.draftsByThreadKey[threadKeyFor(threadId)]).toBeUndefined();
    expect(mergedState.draftThreadsByThreadKey).toEqual({});
    expect(mergedState.logicalProjectDraftThreadKeyByLogicalProjectKey).toEqual({});
  });
});

describe("composerDraftStore context persistence", () => {
  const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, ThreadId.make("context-persistence"));
  const annotation: PreviewAnnotationPayload = {
    id: "retry-note",
    pageUrl: "http://localhost:3000/checkout",
    pageTitle: "Checkout",
    comment: "Keep the cart after a failed payment",
    elements: [],
    regions: [{ id: "error-region", rect: { x: 10, y: 20, width: 100, height: 50 } }],
    strokes: [],
    styleChanges: [],
    screenshot: null,
    createdAt: "2026-09-06T10:00:00.000Z",
  };

  beforeEach(resetComposerDraftStore);

  it("preserves snapshots and inline positions through repeated persistence and hydration", () => {
    const terminal = {
      ...makeTerminalContext({ id: "checkout-console" }),
      threadId: threadRef.threadId,
    };
    const store = useComposerDraftStore.getState();
    store.addTerminalContext(threadRef, terminal);
    store.addPreviewAnnotation(threadRef, annotation);
    const terminalLink = formatTerminalContextReference(terminal);
    const prompt = `Inspect ${terminalLink}. Apply [Retry note](t3-context://v1/preview-annotation/preview-annotation_retry-note). Compare ${terminalLink} again.`;
    store.setPrompt(threadRef, prompt);
    let state = useComposerDraftStore.getState();
    const merge = useComposerDraftStore.persist.getOptions().merge!;

    for (let reload = 0; reload < 3; reload++) {
      state = merge(
        JSON.parse(JSON.stringify(partializeComposerDraftStoreState(state))),
        useComposerDraftStore.getInitialState(),
      );
      const draft = state.draftsByThreadKey[scopedThreadKey(threadRef)];
      expect(draft?.prompt).toBe(prompt);
      expect(draft?.terminalContexts).toEqual([terminal]);
      expect(draft?.previewAnnotations).toEqual([annotation]);
    }
  });

  it("retains annotation-only drafts and filters malformed annotations", () => {
    const merge = useComposerDraftStore.persist.getOptions().merge!;
    const state = merge(
      {
        draftsByThreadKey: {
          [scopedThreadKey(threadRef)]: {
            prompt: "",
            attachments: [],
            previewAnnotations: [annotation, { id: "invalid" }, null],
          },
        },
      },
      useComposerDraftStore.getInitialState(),
    );
    const draft = state.draftsByThreadKey[scopedThreadKey(threadRef)];
    expect(draft?.previewAnnotations).toEqual([annotation]);
    expect(draft?.prompt).toContain(
      "t3-context://v1/preview-annotation/preview-annotation_retry-note",
    );
  });
});

describe("composerDraftStore project draft thread mapping", () => {
  const projectId = ProjectId.make("project-a");
  const otherProjectId = ProjectId.make("project-b");
  const projectRef = scopeProjectRef(TEST_ENVIRONMENT_ID, projectId);
  const otherProjectRef = scopeProjectRef(TEST_ENVIRONMENT_ID, otherProjectId);
  const remoteProjectRef = scopeProjectRef(OTHER_TEST_ENVIRONMENT_ID, projectId);
  const threadId = ThreadId.make("thread-a");
  const otherThreadId = ThreadId.make("thread-b");
  const draftId = DraftId.make("draft-a");
  const otherDraftId = DraftId.make("draft-b");
  const sharedDraftId = DraftId.make("draft-shared");
  const localDraftId = DraftId.make("draft-local");
  const remoteDraftId = DraftId.make("draft-remote");

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("clears composer data for one environment without touching another", () => {
    const store = useComposerDraftStore.getState();
    const localThreadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);
    const remoteThreadRef = scopeThreadRef(OTHER_TEST_ENVIRONMENT_ID, otherThreadId);
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const revokeSpy = vi.fn<(url: string) => void>();
    URL.revokeObjectURL = revokeSpy;

    try {
      store.setProjectDraftThreadId(projectRef, localDraftId, { threadId });
      store.setProjectDraftThreadId(remoteProjectRef, remoteDraftId, {
        threadId: otherThreadId,
      });
      store.setPrompt(localDraftId, "local draft");
      store.setPrompt(remoteDraftId, "remote draft");
      store.addImage(localDraftId, makeImage({ id: "img-local", previewUrl: "blob:local-draft" }));
      store.setPrompt(localThreadRef, "local thread draft");
      store.setPrompt(remoteThreadRef, "remote thread draft");
      useComposerDraftStore.setState({
        rewindingThreadKeys: new Set([
          threadKeyFor(threadId, TEST_ENVIRONMENT_ID),
          threadKeyFor(otherThreadId, OTHER_TEST_ENVIRONMENT_ID),
        ]),
      });

      clearComposerDraftsEnvironment(TEST_ENVIRONMENT_ID);

      const next = useComposerDraftStore.getState();
      expect([...next.rewindingThreadKeys]).toEqual([
        threadKeyFor(otherThreadId, OTHER_TEST_ENVIRONMENT_ID),
      ]);
      expect(next.getDraftThreadByProjectRef(projectRef)).toBeNull();
      expect(next.getDraftThreadByProjectRef(remoteProjectRef)).not.toBeNull();
      expect(next.getComposerDraft(localDraftId)).toBeNull();
      expect(next.getComposerDraft(remoteDraftId)?.prompt).toBe("remote thread draft");
      expect(next.getComposerDraft(localThreadRef)).toBeNull();
      expect(next.getComposerDraft(remoteThreadRef)?.prompt).toBe("remote thread draft");
      expect(revokeSpy).toHaveBeenCalledWith("blob:local-draft");
    } finally {
      URL.revokeObjectURL = originalRevokeObjectUrl;
    }
  });

  it("rotates a failed bootstrap thread id without losing its draft", () => {
    const store = useComposerDraftStore.getState();
    const retryThreadId = ThreadId.make("thread-retry");
    store.setProjectDraftThreadId(projectRef, draftId, {
      threadId,
      branch: "feature/test",
      worktreePath: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      envMode: "worktree",
      startFromOrigin: true,
      runtimeMode: "approval-required",
      interactionMode: "plan",
    });
    store.setPrompt(draftId, "keep this prompt");
    markPromotedDraftThreadByRef(scopeThreadRef(TEST_ENVIRONMENT_ID, threadId));

    store.setLogicalProjectDraftThreadId(scopedProjectKey(projectRef), projectRef, draftId, {
      threadId: retryThreadId,
      createdAt: "2026-01-01T00:01:00.000Z",
    });

    expect(useComposerDraftStore.getState().getDraftThread(draftId)).toMatchObject({
      threadId: retryThreadId,
      branch: "feature/test",
      worktreePath: null,
      createdAt: "2026-01-01T00:01:00.000Z",
      envMode: "worktree",
      startFromOrigin: true,
      runtimeMode: "approval-required",
      interactionMode: "plan",
      promotedTo: null,
    });
    expect(useComposerDraftStore.getState().getComposerDraft(draftId)?.prompt).toBe(
      "keep this prompt",
    );
  });

  it.each([false, true])(
    "restores a failed background draft without replacing the next draft (finalized: %s)",
    (finalized) => {
      const store = useComposerDraftStore.getState();
      const nextDraftId = DraftId.make("next-draft");
      const retryThreadId = ThreadId.make("retry-thread");
      const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);
      store.setProjectDraftThreadId(projectRef, draftId, {
        threadId,
        branch: "main",
        envMode: "worktree",
        startFromOrigin: true,
      });
      const sentDraft = store.getDraftSession(draftId)!;
      markPromotedDraftThreadByRef(threadRef);
      store.setProjectDraftThreadId(projectRef, nextDraftId, {
        threadId: ThreadId.make("next-thread"),
      });
      store.setPrompt(nextDraftId, "My next task");
      const nextDraft = store.getDraftSession(nextDraftId);
      if (finalized) finalizePromotedDraftThreadByRef(threadRef);

      restoreFailedBackgroundDraftThread(draftId, sentDraft, retryThreadId);
      store.setPrompt(draftId, "Retry the first task");

      expect(store.getDraftThreadByProjectRef(projectRef)?.draftId).toBe(nextDraftId);
      expect(store.getDraftSession(nextDraftId)).toBe(nextDraft);
      expect(store.getComposerDraft(nextDraftId)?.prompt).toBe("My next task");
      expect(store.getDraftSession(draftId)).toMatchObject({
        threadId: retryThreadId,
        promotedTo: null,
        branch: "main",
        envMode: "worktree",
        startFromOrigin: true,
      });
      expect(store.getComposerDraft(draftId)?.prompt).toBe("Retry the first task");
    },
  );

  it("keeps invested composer drafts alive unmapped when remapping a project to a new draft thread", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectRef, draftId, { threadId });
    store.setPrompt(draftId, "keep me around");

    store.setProjectDraftThreadId(projectRef, otherDraftId, { threadId: otherThreadId });

    // The mapping moved to the fresh draft...
    expect(useComposerDraftStore.getState().getDraftThreadByProjectRef(projectRef)?.threadId).toBe(
      otherThreadId,
    );
    // ...but the invested draft survives with its content for the sidebar
    // draft rows to surface.
    expect(useComposerDraftStore.getState().getDraftThread(draftId)?.threadId).toBe(threadId);
    expect(draftByKey(draftId)?.prompt).toBe("keep me around");
  });

  it("keeps composer drafts when the thread is still mapped by another project", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectRef, draftId, { threadId });
    store.setProjectDraftThreadId(otherProjectRef, sharedDraftId, { threadId });
    store.setPrompt(sharedDraftId, "keep me");

    store.clearProjectDraftThreadId(projectRef);

    expect(useComposerDraftStore.getState().getDraftThreadByProjectRef(projectRef)).toBeNull();
    expect(
      useComposerDraftStore.getState().getDraftThreadByProjectRef(otherProjectRef)?.threadId,
    ).toBe(threadId);
    expect(draftByKey(sharedDraftId)?.prompt).toBe("keep me");
  });

  it("does not clear composer drafts for existing server threads during promotion cleanup", () => {
    const store = useComposerDraftStore.getState();
    const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);
    store.setPrompt(threadRef, "keep me");

    markPromotedDraftThreadByRef(scopeThreadRef(TEST_ENVIRONMENT_ID, threadId));

    expect(useComposerDraftStore.getState().getDraftThread(threadRef)).toBeNull();
    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)?.prompt).toBe("keep me");
  });

  it("promotes matching thread ids separately for each environment", () => {
    const store = useComposerDraftStore.getState();
    const localThreadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);
    const remoteThreadRef = scopeThreadRef(OTHER_TEST_ENVIRONMENT_ID, threadId);

    store.setProjectDraftThreadId(projectRef, localDraftId, { threadId });
    store.setPrompt(localDraftId, "local draft");
    store.setProjectDraftThreadId(remoteProjectRef, remoteDraftId, { threadId });
    store.setPrompt(remoteDraftId, "remote draft");

    markPromotedDraftThreadByRef(localThreadRef);

    expect(store.getDraftThreadByProjectRef(projectRef)).toBeNull();
    expect(store.getDraftThreadByProjectRef(remoteProjectRef)?.threadId).toBe(threadId);
    expect(store.getDraftThreadByRef(localThreadRef)?.promotedTo).toEqual(localThreadRef);
    expect(store.getDraftThreadByRef(remoteThreadRef)?.promotedTo).toBeNull();
    expect(draftByKey(localDraftId)?.prompt).toBe("local draft");
    expect(draftByKey(remoteDraftId)?.prompt).toBe("remote draft");

    markPromotedDraftThreadByRef(remoteThreadRef);

    expect(store.getDraftThreadByProjectRef(projectRef)).toBeNull();
    expect(store.getDraftThreadByProjectRef(remoteProjectRef)).toBeNull();
    expect(store.getDraftThreadByRef(localThreadRef)?.promotedTo).toEqual(localThreadRef);
    expect(store.getDraftThreadByRef(remoteThreadRef)?.promotedTo).toEqual(remoteThreadRef);
    expect(draftByKey(localDraftId)?.prompt).toBe("local draft");
    expect(draftByKey(remoteDraftId)?.prompt).toBe("remote draft");
  });

  it("moves composer edits made during promotion to the canonical thread", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectRef, draftId, { threadId });
    markPromotedDraftThreadByRef(scopeThreadRef(TEST_ENVIRONMENT_ID, threadId));
    store.setPrompt(draftId, "typed during setup");

    finalizePromotedDraftThreadByRef(scopeThreadRef(TEST_ENVIRONMENT_ID, threadId));

    expect(useComposerDraftStore.getState().getDraftThreadByProjectRef(projectRef)).toBeNull();
    expect(useComposerDraftStore.getState().getDraftThread(draftId)).toBeNull();
    expect(draftByKey(draftId)).toBeUndefined();
    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)?.prompt).toBe("typed during setup");
  });

  it("clears stale upload metadata when retargeting a draft to another environment", () => {
    const store = useComposerDraftStore.getState();
    const hydratedFile: ComposerFileAttachment = {
      ...makeFile("file-cross-environment"),
      file: null,
      uploadedAttachmentId: "local-environment-upload",
      uploadEnvironmentId: TEST_ENVIRONMENT_ID,
    };

    store.setProjectDraftThreadId(projectRef, draftId, { threadId });
    store.addFiles(draftId, [hydratedFile]);

    store.setProjectDraftThreadId(remoteProjectRef, draftId, { threadId });

    const file = store.getComposerDraft(draftId)?.files[0];
    expect(file).toMatchObject({
      id: hydratedFile.id,
      file: null,
    });
    expect(file?.uploadedAttachmentId).toBeUndefined();
    expect(file?.uploadEnvironmentId).toBeUndefined();
    expect(file && composerFileNeedsReattach(file)).toBe(true);
  });

  it("pins manual workspace choices and can return to automatic routing without losing the prompt", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectRef, draftId, { threadId });
    store.setPrompt(draftId, "keep this prompt");
    store.setDraftThreadContext(draftId, {
      projectRef: remoteProjectRef,
      environmentSelection: "auto",
      loadBalancedEnvironmentId: OTHER_TEST_ENVIRONMENT_ID,
    });
    expect(store.getDraftThread(draftId)).toMatchObject({
      environmentId: OTHER_TEST_ENVIRONMENT_ID,
      environmentSelection: "auto",
      loadBalancedEnvironmentId: OTHER_TEST_ENVIRONMENT_ID,
    });
    store.setDraftThreadContext(draftId, { branch: "feature/pinned" });
    expect(store.getDraftThread(draftId)?.environmentSelection).toBe("manual");
    store.setDraftThreadContext(draftId, {
      branch: null,
      environmentSelection: "auto",
      loadBalancedEnvironmentId: null,
    });
    expect(store.getDraftThread(draftId)).toMatchObject({
      branch: null,
      environmentSelection: "auto",
      loadBalancedEnvironmentId: null,
    });
    expect(store.getComposerDraft(draftId)?.prompt).toBe("keep this prompt");
  });
});

describe("composerDraftStore modelSelection", () => {
  const threadId = ThreadId.make("thread-model-options");
  const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("returns a manual draft to automatic selection without discarding its prompt", () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(threadRef, "Investigate this failure");
    store.setModelSelection(threadRef, modelSelection(CODEX_DRIVER, "gpt-5.4"), {
      explicit: true,
    });

    store.setModelSelection(threadRef, null);

    const draft = draftFor(threadId, TEST_ENVIRONMENT_ID);
    expect(draft?.modelSelectionExplicit).toBeUndefined();
    expect(draft?.prompt).toBe("Investigate this failure");
  });

  it("restores a generated header after a failed send without carrying its origin into a new prompt", () => {
    const store = useComposerDraftStore.getState();
    const prompt = "Ultrathink:\nInvestigate this failure";
    store.setPrompt(threadRef, prompt, { effortInjected: true });
    const effortInjected = draftFor(threadId, TEST_ENVIRONMENT_ID)?.promptEffortInjected === true;
    store.clearComposerContent(threadRef);
    store.setPrompt(threadRef, "Ultrathink:\nAnother user-authored prompt");
    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)?.promptEffortInjected).not.toBe(true);

    store.clearComposerContent(threadRef);
    store.setPrompt(threadRef, prompt, { effortInjected });
    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)?.promptEffortInjected).toBe(true);
  });

  it("does not clear other provider options when setting options for a single provider", () => {
    const store = useComposerDraftStore.getState();

    // Set options for both providers
    store.setModelOptions(
      threadRef,
      providerModelOptions({
        codex: { fastMode: true },
        claudeAgent: { effort: "max" },
      }),
    );

    // Now set options for only codex — claudeAgent should be untouched
    store.setModelOptions(threadRef, providerModelOptions({ codex: { reasoningEffort: "xhigh" } }));

    const draft = draftFor(threadId, TEST_ENVIRONMENT_ID);
    expect(draft?.modelSelectionByProvider[CODEX_INSTANCE]?.options).toEqual(
      createModelSelection(CODEX_INSTANCE, "gpt-5.4", toSelections({ reasoningEffort: "xhigh" }))
        .options,
    );
    expect(draft?.modelSelectionByProvider[CLAUDE_AGENT_INSTANCE]?.options).toEqual(
      createModelSelection(
        CLAUDE_AGENT_INSTANCE,
        "claude-opus-4-6",
        toSelections({ effort: "max" }),
      ).options,
    );
  });

  it("preserves other provider options when switching the active model selection", () => {
    const store = useComposerDraftStore.getState();

    store.setModelOptions(
      threadRef,
      providerModelOptions({
        codex: { fastMode: true },
        claudeAgent: { effort: "max" },
      }),
    );

    store.setModelSelection(threadRef, modelSelection(CLAUDE_AGENT_DRIVER, "claude-opus-4-6"));

    const draft = draftFor(threadId, TEST_ENVIRONMENT_ID);
    expect(draft?.modelSelectionByProvider[CLAUDE_AGENT_INSTANCE]).toEqual(
      modelSelection(CLAUDE_AGENT_DRIVER, "claude-opus-4-6", { effort: "max" }),
    );
    expect(draft?.modelSelectionByProvider[CODEX_INSTANCE]?.options).toEqual(
      createModelSelection(CODEX_INSTANCE, "gpt-5.4", toSelections({ fastMode: true })).options,
    );
    expect(draft?.activeProvider).toBe("claudeAgent");
  });
});

describe("composerDraftStore setModelSelection", () => {
  const threadId = ThreadId.make("thread-model");
  const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("keeps explicit model overrides instead of coercing to null", () => {
    const store = useComposerDraftStore.getState();

    store.setModelSelection(threadRef, modelSelection(CODEX_DRIVER, "gpt-5.3-codex"));

    expect(
      draftFor(threadId, TEST_ENVIRONMENT_ID)?.modelSelectionByProvider[CODEX_INSTANCE],
    ).toEqual(modelSelection(CODEX_DRIVER, "gpt-5.3-codex"));
  });
});

describe("composerDraftStore model seed migration", () => {
  const staleDraftId = DraftId.make("draft-legacy-stale-model");
  const explicitDraftId = DraftId.make("draft-legacy-explicit-model");
  const typedDraftId = DraftId.make("draft-legacy-typed-model");
  const staleThreadId = ThreadId.make("thread-legacy-stale-model");
  const explicitThreadId = ThreadId.make("thread-legacy-explicit-model");
  const typedThreadId = ThreadId.make("thread-legacy-typed-model");
  const serverThreadId = ThreadId.make("thread-server-model");
  const serverThreadKey = scopedThreadKey(scopeThreadRef(TEST_ENVIRONMENT_ID, serverThreadId));
  const projectId = ProjectId.make("project-model-migration");
  const logicalProjectKey = `${TEST_ENVIRONMENT_ID}:/tmp/project-model-migration`;

  const draftThread = (threadId: ThreadId) => ({
    threadId,
    environmentId: TEST_ENVIRONMENT_ID,
    projectId,
    logicalProjectKey,
    createdAt: "2026-08-01T00:00:00.000Z",
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    envMode: "local",
    startFromOrigin: false,
    promotedTo: null,
  });

  beforeEach(async () => {
    resetComposerDraftStore();
    await useComposerDraftStore.persist.clearStorage();
  });

  afterEach(async () => {
    await useComposerDraftStore.persist.clearStorage();
  });

  it.each([1, 2])(
    "keeps the legacy sticky Codex selection when v%s storage omitted the provider",
    async (version) => {
      vi.useFakeTimers();
      try {
        const stickySelection = modelSelection(CODEX_DRIVER, "gpt-5.6-terra", {
          reasoningEffort: "xhigh",
        });
        const storage = useComposerDraftStore.persist.getOptions().storage;
        expect(storage).toBeDefined();
        storage?.setItem(COMPOSER_DRAFT_STORAGE_KEY, {
          version,
          state: {
            draftsByThreadId: {},
            draftThreadsByThreadId: {},
            projectDraftThreadIdByProjectId: {},
            stickyModel: stickySelection.model,
            stickyModelOptions: providerModelOptions({
              [CODEX_DRIVER]: { reasoningEffort: "xhigh" },
            }),
          },
        } as never);
        await vi.advanceTimersByTimeAsync(300);

        await useComposerDraftStore.persist.rehydrate();

        expect(useComposerDraftStore.getState()).toMatchObject({
          stickyModelSelectionByProvider: { [CODEX_INSTANCE]: stickySelection },
          stickyActiveProvider: null,
        });
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("strips seeded models only from empty draft sessions when upgrading storage", async () => {
    vi.useFakeTimers();
    try {
      const staleSelection = modelSelection(CODEX_DRIVER, "gpt-5.4");
      const stickySelection = modelSelection(CODEX_DRIVER, "gpt-5.6-terra", {
        reasoningEffort: "xhigh",
      });
      const storage = useComposerDraftStore.persist.getOptions().storage;
      expect(storage).toBeDefined();
      storage?.setItem(COMPOSER_DRAFT_STORAGE_KEY, {
        version: 8,
        state: {
          draftsByThreadKey: {
            [staleDraftId]: {
              prompt: "",
              attachments: [],
              modelSelectionByProvider: { [CODEX_INSTANCE]: staleSelection },
              activeProvider: CODEX_INSTANCE,
              runtimeMode: "approval-required",
            },
            [typedDraftId]: {
              prompt: "keep this prompt",
              attachments: [],
              modelSelectionByProvider: { [CODEX_INSTANCE]: staleSelection },
              activeProvider: CODEX_INSTANCE,
            },
            [explicitDraftId]: {
              prompt: "",
              attachments: [],
              modelSelectionByProvider: { [CODEX_INSTANCE]: staleSelection },
              activeProvider: CODEX_INSTANCE,
              modelSelectionExplicit: true,
            },
            [serverThreadKey]: {
              prompt: "",
              attachments: [],
              modelSelectionByProvider: { [CODEX_INSTANCE]: staleSelection },
              activeProvider: CODEX_INSTANCE,
            },
          },
          draftThreadsByThreadKey: {
            [staleDraftId]: draftThread(staleThreadId),
            [explicitDraftId]: draftThread(explicitThreadId),
            [typedDraftId]: draftThread(typedThreadId),
          },
          logicalProjectDraftThreadKeyByLogicalProjectKey: {
            [logicalProjectKey]: staleDraftId,
          },
          stickyModelSelectionByProvider: { [CODEX_INSTANCE]: stickySelection },
          stickyActiveProvider: CODEX_INSTANCE,
        },
      } as never);
      await vi.advanceTimersByTimeAsync(300);

      await useComposerDraftStore.persist.rehydrate();

      expect(draftByKey(staleDraftId)).toMatchObject({
        modelSelectionByProvider: {},
        activeProvider: null,
        runtimeMode: "approval-required",
      });
      expect(draftByKey(typedDraftId)).toMatchObject({
        prompt: "keep this prompt",
        modelSelectionByProvider: { [CODEX_INSTANCE]: staleSelection },
        activeProvider: CODEX_INSTANCE,
      });
      expect(draftByKey(explicitDraftId)).toMatchObject({
        modelSelectionByProvider: { [CODEX_INSTANCE]: staleSelection },
        activeProvider: CODEX_INSTANCE,
        modelSelectionExplicit: true,
      });
      expect(draftByKey(serverThreadKey)).toMatchObject({
        modelSelectionByProvider: { [CODEX_INSTANCE]: staleSelection },
        activeProvider: CODEX_INSTANCE,
      });
      expect(useComposerDraftStore.getState().draftThreadsByThreadKey[staleDraftId]).toMatchObject({
        environmentId: TEST_ENVIRONMENT_ID,
        projectId,
        logicalProjectKey,
      });
      expect(useComposerDraftStore.getState()).toMatchObject({
        stickyModelSelectionByProvider: { [CODEX_INSTANCE]: stickySelection },
        stickyActiveProvider: CODEX_INSTANCE,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps v8 file-only draft sessions and their seeded models", async () => {
    vi.useFakeTimers();
    try {
      const uploadedDraftId = DraftId.make("draft-legacy-uploaded-file");
      const markerDraftId = DraftId.make("draft-legacy-file-marker");
      const uploadedThreadId = ThreadId.make("thread-legacy-uploaded-file");
      const markerThreadId = ThreadId.make("thread-legacy-file-marker");
      const staleSelection = modelSelection(CODEX_DRIVER, "gpt-5.4");
      const storage = useComposerDraftStore.persist.getOptions().storage;
      expect(storage).toBeDefined();
      storage?.setItem(COMPOSER_DRAFT_STORAGE_KEY, {
        version: 8,
        state: {
          draftsByThreadKey: {
            [uploadedDraftId]: {
              prompt: "",
              attachments: [],
              files: [
                {
                  id: "file-uploaded",
                  name: "uploaded-report.pdf",
                  mimeType: "application/pdf",
                  sizeBytes: 128,
                  attachmentId: "attachment-uploaded",
                  environmentId: TEST_ENVIRONMENT_ID,
                },
              ],
              modelSelectionByProvider: { [CODEX_INSTANCE]: staleSelection },
              activeProvider: CODEX_INSTANCE,
            },
            [markerDraftId]: {
              prompt: "",
              attachments: [],
              files: [
                {
                  id: "file-needs-reattach",
                  name: "local-notes.txt",
                  mimeType: "text/plain",
                  sizeBytes: 64,
                },
              ],
              modelSelectionByProvider: { [CODEX_INSTANCE]: staleSelection },
              activeProvider: CODEX_INSTANCE,
              runtimeMode: "approval-required",
            },
          },
          draftThreadsByThreadKey: {
            [uploadedDraftId]: draftThread(uploadedThreadId),
            [markerDraftId]: draftThread(markerThreadId),
          },
          logicalProjectDraftThreadKeyByLogicalProjectKey: {},
          stickyModelSelectionByProvider: {},
          stickyActiveProvider: null,
        },
      } as never);
      await vi.advanceTimersByTimeAsync(300);

      await useComposerDraftStore.persist.rehydrate();

      expect(draftByKey(uploadedDraftId)).toMatchObject({
        files: [
          {
            id: "file-uploaded",
            name: "uploaded-report.pdf",
            uploadedAttachmentId: "attachment-uploaded",
            uploadEnvironmentId: TEST_ENVIRONMENT_ID,
          },
        ],
        modelSelectionByProvider: { [CODEX_INSTANCE]: staleSelection },
        activeProvider: CODEX_INSTANCE,
      });
      expect(draftByKey(markerDraftId)).toMatchObject({
        files: [
          {
            id: "file-needs-reattach",
            name: "local-notes.txt",
            file: null,
          },
        ],
        modelSelectionByProvider: { [CODEX_INSTANCE]: staleSelection },
        activeProvider: CODEX_INSTANCE,
        runtimeMode: "approval-required",
      });
      expect(draftByKey(markerDraftId)?.files.every(composerFileNeedsReattach)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// createDeferredStorage
// ---------------------------------------------------------------------------

function createMockStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((name: string) => store.get(name) ?? null),
    setItem: vi.fn((name: string, value: string) => {
      store.set(name, value);
    }),
    removeItem: vi.fn((name: string) => {
      store.delete(name);
    }),
  };
}

describe("composer draft persistence", () => {
  it("defers attachment reads and serialization until typing stops, then restores the last draft", async () => {
    await useComposerDraftStore.persist.clearStorage();
    vi.useFakeTimers();
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      resetComposerDraftStore();
      const heavyThreadId = ThreadId.make("heavy-draft");
      const typingThreadId = ThreadId.make("typing-draft");
      const heavyRef = scopeThreadRef(TEST_ENVIRONMENT_ID, heavyThreadId);
      const typingRef = scopeThreadRef(TEST_ENVIRONMENT_ID, typingThreadId);
      const heavyKey = scopedThreadKey(heavyRef);
      useComposerDraftStore.getState().setPrompt(heavyRef, "Keep this image");
      const attachments = [
        {
          id: "heavy-image",
          name: "image.png",
          mimeType: "image/png",
          sizeBytes: 49_152,
          dataUrl: `data:image/png;base64,${"AQID".repeat(16_384)}`,
          type: "image" as const,
        },
      ];
      let attachmentReads = 0;
      useComposerDraftStore.setState((state) => ({
        draftsByThreadKey: {
          ...state.draftsByThreadKey,
          [heavyKey]: {
            ...state.draftsByThreadKey[heavyKey]!,
            get persistedAttachments() {
              attachmentReads += 1;
              return attachments;
            },
          },
        },
      }));
      attachmentReads = 0;
      stringify.mockClear();

      for (let index = 1; index <= 20; index++) {
        useComposerDraftStore.getState().setPrompt(typingRef, `Draft ${index}`);
      }
      expect(attachmentReads).toBe(0);
      expect(stringify).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(300);
      expect(attachmentReads).toBe(1);
      expect(stringify).toHaveBeenCalledTimes(1);

      resetComposerDraftStore();
      await useComposerDraftStore.persist.rehydrate();
      expect(draftFor(typingThreadId, TEST_ENVIRONMENT_ID)?.prompt).toBe("Draft 20");
      expect(draftFor(heavyThreadId, TEST_ENVIRONMENT_ID)?.persistedAttachments).toEqual(
        attachments,
      );
    } finally {
      stringify.mockRestore();
      await useComposerDraftStore.persist.clearStorage();
      vi.useRealTimers();
      resetComposerDraftStore();
    }
  });
});

describe("createDeferredStorage", () => {
  const serialize = vi.fn((value: string) => `s:${value}`);

  beforeEach(() => {
    vi.useFakeTimers();
    serialize.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels stale writes and flushes only the latest deferred draft once", () => {
    const base = createMockStorage();
    const storage = createDeferredStorage(base, serialize);
    storage.setItem("key", "stale");
    storage.removeItem("key");
    vi.advanceTimersByTime(300);
    expect(serialize).not.toHaveBeenCalled();
    expect(base.setItem).not.toHaveBeenCalled();
    expect(base.removeItem).toHaveBeenCalledWith("key");

    storage.setItem("key", "latest");
    storage.flush();
    expect(base.setItem).toHaveBeenCalledWith("key", "s:latest");
    vi.advanceTimersByTime(300);
    expect(serialize).toHaveBeenCalledTimes(1);
    expect(base.setItem).toHaveBeenCalledTimes(1);
  });
});

describe("composerDraftStore inline context references", () => {
  const threadId = ThreadId.make("thread-inline-context");
  const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);
  const reviewComment = {
    id: "rc-1",
    sectionId: "file:a/b.ts",
    sectionTitle: "File comment",
    filePath: "a/b.ts",
    startIndex: 3,
    endIndex: 3,
    rangeLabel: "L4",
    text: "Why?",
    diff: "const x = 1;",
  };
  const reviewLink = "[b.ts L4](t3-context://v1/review-comment/review-comment_rc-1)";
  const annotation = {
    id: "ann-1",
    pageUrl: "http://localhost:3000/",
    pageTitle: "Home",
    comment: "Bigger",
    elements: [],
    regions: [],
    strokes: [],
    styleChanges: [],
    screenshot: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const annotationLink = "[Bigger](t3-context://v1/preview-annotation/preview-annotation_ann-1)";

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("does not overwrite a prompt update made by the caret handler", () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(threadRef, "before after");
    store.setContextInsertionHandler(threadRef, (references) => {
      const reference = references[0];
      if (!reference) return false;
      useComposerDraftStore
        .getState()
        .setPrompt(
          threadRef,
          `before [${reference.label}](t3-context://v1/${reference.kind}/${reference.contextId}) after`,
        );
      return true;
    });

    store.addReviewComment(threadRef, reviewComment);

    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)?.prompt).toBe(`before ${reviewLink} after`);
    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)?.reviewComments).toEqual([reviewComment]);
    store.setContextInsertionHandler(threadRef, null);
  });

  it("rehydrates annotation-only drafts with their references", () => {
    const merged = useComposerDraftStore.persist.getOptions().merge!(
      {
        draftsByThreadKey: {
          [threadKeyFor(threadId)]: {
            prompt: "",
            attachments: [],
            previewAnnotations: [annotation],
          },
        },
      },
      useComposerDraftStore.getInitialState(),
    );
    expect(merged.draftsByThreadKey[threadKeyFor(threadId)]?.previewAnnotations).toEqual([
      annotation,
    ]);
    expect(merged.draftsByThreadKey[threadKeyFor(threadId)]?.prompt).toContain(annotationLink);
  });
});

describe("composerDraftStore attachment references", () => {
  const threadId = ThreadId.make("thread-attachment-refs");
  const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("restores a file-only draft with a reference and preserves it through prompt edits", () => {
    const store = useComposerDraftStore.getState();
    store.addFiles(
      threadRef,
      [
        {
          type: "file",
          id: "restored",
          name: "notes.txt",
          mimeType: "text/plain",
          sizeBytes: 3,
          file: null,
          uploadedAttachmentId: "uploaded",
          uploadEnvironmentId: TEST_ENVIRONMENT_ID,
        },
      ],
      { appendReference: true },
    );
    const restored = draftFor(threadId, TEST_ENVIRONMENT_ID)!;
    expect(restored.prompt).toBe("[notes.txt](t3-context://v1/file/file_restored) ");
    store.setPrompt(threadRef, `${restored.prompt}explain this`);
    const edited = draftFor(threadId, TEST_ENVIRONMENT_ID)!;
    expect(edited.files.map((file) => file.id)).toEqual(["restored"]);
    expect(edited.prompt).toContain("t3-context://v1/file/file_restored");
  });

  it.each(["old.file:1", "file-1"])(
    "rewrites persisted attachment references before removal: %s",
    (id) => {
      const merged = useComposerDraftStore.persist.getOptions().merge!(
        {
          draftsByThreadKey: {
            [threadKeyFor(threadId, TEST_ENVIRONMENT_ID)]: {
              prompt: `before [notes.txt](t3-context://v1/file/${id}) after`,
              attachments: [],
              files: [{ id, name: "notes.txt", mimeType: "text/plain", sizeBytes: 3 }],
            },
          },
        },
        useComposerDraftStore.getInitialState(),
      );
      useComposerDraftStore.setState(merged);
      const draft = draftFor(threadId, TEST_ENVIRONMENT_ID)!;
      expect(draft.prompt.match(/t3-context:/g)).toHaveLength(1);
      expect(draft.prompt).not.toContain(`/file/${id})`);
      useComposerDraftStore.getState().removeFile(threadRef, id);
      expect(draftFor(threadId, TEST_ENVIRONMENT_ID)?.prompt).toBe("before after");
    },
  );

  it("preserves canonical references when another producer ID matches their namespace", () => {
    const prompt =
      "![x.png](t3-context://v1/image/image_x) ![image_x.png](t3-context://v1/image/image_image_x)";
    const merged = useComposerDraftStore.persist.getOptions().merge!(
      {
        draftsByThreadKey: {
          [threadKeyFor(threadId, TEST_ENVIRONMENT_ID)]: {
            prompt,
            attachments: ["x", "image_x"].map((id) => ({
              id,
              name: `${id}.png`,
              mimeType: "image/png",
              sizeBytes: 1,
              dataUrl: "data:image/png;base64,YQ==",
            })),
          },
        },
      },
      useComposerDraftStore.getInitialState(),
    );
    expect(merged.draftsByThreadKey[threadKeyFor(threadId, TEST_ENVIRONMENT_ID)]?.prompt).toBe(
      prompt,
    );
  });
});
