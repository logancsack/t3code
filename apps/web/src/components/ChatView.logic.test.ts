import {
  ANTIGRAVITY_DEFAULT_MODEL,
  CheckpointRef,
  EnvironmentId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  ThreadId,
  TurnId,
  type WorktreeSetupSnapshot,
} from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  isClaudePromptEffortPrefixInjection,
  stripClaudePromptEffortPrefix,
} from "@t3tools/shared/model";
import { Atom, AsyncResult } from "effect/unstable/reactivity";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentThreadDetails } from "../state/threads";

import type { Thread, TurnDiffSummary } from "../types";
import { deriveProviderInstanceEntries } from "../providerInstances";
import { type RightPanelSurface } from "../rightPanelStore";
import {
  formatOutgoingPrompt,
  agentControlledBrowserCloseConfirmation,
  deriveLockedProvider,
  getAntigravitySendBlockReason,
  getStartedThreadModelChangeBlockReason,
  retryableTurnAfterProviderReconnect,
  resolveComposerInteractionMode,
  restorePlanFollowUpComposer,
  resolveComposerProviderSelection,
  resolveDraftPromotionNavigationTarget,
  resolveVisibleWorktreeSetup,
  resolveProactiveTurnDiffAction,
  resetHeldThreadTimeline,
  resolveThreadSwitchTimeline,
  threadKeysShareEnvironment,
  timelineHasEphemeralPreviewUrls,
  shouldShowPlanFollowUpPrompt,
  shouldWriteThreadErrorToCurrentServerThread,
  waitForRevertedMessage,
  prepareRevertedMessageAttachments,
} from "./ChatView.logic";

describe("outgoing prompt formatting", () => {
  const input = {
    provider: ProviderDriverKind.make("claudeAgent"),
    model: "claude-opus-4-6",
    models: [
      {
        slug: "claude-opus-4-6",
        name: "Claude Opus",
        isCustom: false,
        capabilities: {
          optionDescriptors: [
            {
              id: "effort",
              label: "Reasoning",
              type: "select" as const,
              options: [
                { id: "high", label: "High" },
                { id: "ultrathink", label: "Ultrathink" },
              ],
              promptInjectedValues: ["ultrathink"],
            },
          ],
        },
      },
    ],
    effort: "ultrathink",
    text: "Implement the proposed plan",
  };

  it("preserves raw text while Aldo may replace an inherited model and effort", () => {
    expect(formatOutgoingPrompt({ ...input, modelMayChange: true })).toBe(input.text);
  });

  it("removes an injected trait before returning a manual Claude draft to routing", () => {
    const manualPrompt = formatOutgoingPrompt(input);
    const restoredPrompt = stripClaudePromptEffortPrefix(
      manualPrompt,
      isClaudePromptEffortPrefixInjection(input.text, manualPrompt),
    );
    expect(formatOutgoingPrompt({ ...input, text: restoredPrompt, modelMayChange: true })).toBe(
      input.text,
    );
  });
});

describe("agent browser close confirmation", () => {
  const surfaces = [
    { id: "browser:one", kind: "preview", resourceId: "tab-1" },
    { id: "browser:two", kind: "preview", resourceId: "tab-2" },
    { id: "diff", kind: "diff" },
  ] satisfies RightPanelSurface[];

  it("only warns for browsers under active agent control", () => {
    expect(
      agentControlledBrowserCloseConfirmation(surfaces, {
        "tab-1": { controller: "none" },
        "tab-2": { controller: "human" },
      }),
    ).toBeNull();

    expect(
      agentControlledBrowserCloseConfirmation([surfaces[0]!], {
        "tab-1": { controller: "agent" },
      }),
    ).toBe(
      [
        "Close browser while the agent is using it?",
        "The agent is actively controlling this browser. Closing it may interrupt the current browser action.",
      ].join("\n"),
    );
  });
});

describe("proactive panels", () => {
  it("waits for definitive checkpoint and repository state", () => {
    const missingCheckpoint = {
      status: "missing",
      files: [],
    } satisfies Pick<TurnDiffSummary, "status" | "files">;
    const changedCheckpoint = {
      status: "ready",
      files: [{ path: "src/app.ts", kind: "modified", additions: 1, deletions: 0 }],
    } satisfies Pick<TurnDiffSummary, "status" | "files">;

    expect(
      resolveProactiveTurnDiffAction({
        checkpoint: undefined,
        isGitRepo: true,
      }),
    ).toBe("defer");
    expect(
      resolveProactiveTurnDiffAction({
        checkpoint: missingCheckpoint,
        isGitRepo: true,
      }),
    ).toBe("defer");
    expect(
      resolveProactiveTurnDiffAction({
        checkpoint: changedCheckpoint,
        isGitRepo: undefined,
      }),
    ).toBe("defer");
  });
});

const environmentId = EnvironmentId.make("environment-local");
const projectId = ProjectId.make("project-1");
const threadId = ThreadId.make("thread-1");
const now = "2026-03-29T00:00:00.000Z";

describe("draft hero submission transition", () => {
  it("does not auto-navigate a background submission after server promotion", () => {
    expect(
      resolveDraftPromotionNavigationTarget({
        serverThreadRef: { environmentId, threadId },
        serverThread: makeThread({ latestTurn: completedTurn }),
        backgroundSubmissionPending: true,
      }),
    ).toBeNull();
  });
});

describe("resolveThreadSwitchTimeline", () => {
  afterEach(() => {
    resetHeldThreadTimeline();
  });

  const held = { threadKey: "env-1:thread-a", entries: ["a1", "a2"] };

  it("does not hold another environment's timeline across a jump", () => {
    expect(threadKeysShareEnvironment("env-1:thread-a", "env-2:thread-b")).toBe(false);
    expect(
      resolveThreadSwitchTimeline({
        loading: true,
        activeThreadKey: "env-2:thread-b",
        nextEntries: [],
        lastReady: held,
      }),
    ).toEqual({ entries: [], displayThreadKey: "env-2:thread-b" });
  });

  it("does not remember a timeline that still has handoff blob previews", () => {
    expect(
      timelineHasEphemeralPreviewUrls([
        {
          kind: "message",
          message: {
            id: MessageId.make("preview-message"),
            role: "user",
            text: "Preview",
            turnId: null,
            streaming: false,
            createdAt: "2026-09-10T12:00:00.000Z",
            updatedAt: "2026-09-10T12:00:00.000Z",
            attachments: [
              {
                type: "image",
                id: "preview",
                name: "preview.png",
                mimeType: "image/png",
                sizeBytes: 1,
                previewUrl: "blob:handoff",
              },
            ],
          },
        },
      ]),
    ).toBe(true);
    expect(
      timelineHasEphemeralPreviewUrls([
        {
          kind: "message",
          message: {
            id: MessageId.make("preview-message"),
            role: "user",
            text: "Preview",
            turnId: null,
            streaming: false,
            createdAt: "2026-09-10T12:00:00.000Z",
            updatedAt: "2026-09-10T12:00:00.000Z",
            attachments: [
              {
                type: "image",
                id: "preview",
                name: "preview.png",
                mimeType: "image/png",
                sizeBytes: 1,
                previewUrl: "https://cdn.example/a.png",
              },
            ],
          },
        },
      ]),
    ).toBe(false);
  });
});

describe("provider authentication recovery", () => {
  const provider = {
    instanceId: ProviderInstanceId.make("claudeAgent"),
    driver: ProviderDriverKind.make("claudeAgent"),
    displayName: "Claude",
    enabled: true,
    installed: true,
    version: "2.1.226",
    status: "error" as const,
    auth: { status: "unauthenticated" as const },
    checkedAt: now,
    models: [],
    slashCommands: [],
    skills: [],
  };

  it.each(["error", "interrupted"] as const)(
    "retries the original %s turn after reconnecting",
    (state) => {
      expect(
        retryableTurnAfterProviderReconnect({
          provider,
          latestTurn: {
            ...completedTurn,
            state,
          },
        }),
      ).toBe(completedTurn.turnId);
    },
  );
});

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: threadId,
    environmentId,
    projectId,
    title: "Thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    pullRequests: [],
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    ...overrides,
  };
}

const completedTurn = {
  turnId: TurnId.make("turn-1"),
  state: "completed" as const,
  requestedAt: now,
  startedAt: "2026-03-29T00:00:01.000Z",
  completedAt: "2026-03-29T00:00:10.000Z",
  assistantMessageId: null,
};

const readySession = {
  threadId,
  status: "ready" as const,
  providerName: "codex",
  providerInstanceId: ProviderInstanceId.make("codex"),
  runtimeMode: "full-access" as const,
  activeTurnId: null,
  lastError: null,
  updatedAt: "2026-03-29T00:00:10.000Z",
};

describe("draft promotion during worktree setup", () => {
  const serverThreadRef = { environmentId, threadId };

  it.each([null, "idle", "starting", "ready"] as const)(
    "keeps the draft mounted until the server owns the send, with session %s",
    (status) => {
      const serverThread = makeThread({
        messages: [],
        session: status ? { ...readySession, status } : null,
      });

      expect(
        resolveDraftPromotionNavigationTarget({
          serverThreadRef,
          serverThread,
          backgroundSubmissionPending: false,
        }),
      ).toBeNull();
    },
  );

  it("promotes once the bootstrap persisted the user message, before any turn", () => {
    const serverThread = makeThread({
      messages: [
        {
          id: MessageId.make("submitted-message"),
          role: "user",
          text: "Start in a new worktree",
          turnId: null,
          createdAt: now,
          updatedAt: now,
          streaming: false,
        },
      ],
      session: null,
    });

    expect(
      resolveDraftPromotionNavigationTarget({
        serverThreadRef,
        serverThread,
        backgroundSubmissionPending: false,
      }),
    ).toEqual(serverThreadRef);
  });
});

describe("resolveComposerProviderSelection", () => {
  const catalogModels: ServerProvider["models"] = [
    { slug: "gemini-pro", name: "Gemini Pro", isCustom: false, capabilities: null },
  ];

  function entry(driver: string, instanceId = driver, overrides: Partial<ServerProvider> = {}) {
    return deriveProviderInstanceEntries([
      {
        driver: ProviderDriverKind.make(driver),
        instanceId: ProviderInstanceId.make(instanceId),
        enabled: true,
        installed: true,
        status: "ready",
        auth: { status: "authenticated" },
        version: null,
        checkedAt: now,
        models: [],
        slashCommands: [],
        skills: [],
        ...overrides,
      },
    ])[0]!;
  }

  function importedThread(instanceId: ProviderInstanceId) {
    return makeThread({
      modelSelection: { instanceId, model: "default" },
      messages: [
        {
          id: MessageId.make(`import:${instanceId}:session:000000`),
          role: "user",
          text: "Continue the imported conversation",
          turnId: null,
          createdAt: now,
          updatedAt: now,
          streaming: false,
        },
      ],
    });
  }

  it.each([
    ["claudeAgent", "claude_work"],
    ["codex", "codex_work"],
    ["ollama", "local_models"],
  ])("keeps imported %s history selectable through its custom instance", (driver, instanceId) => {
    const importedEntry = entry(driver, instanceId);
    const entries = [entry(driver === "codex" ? "claudeAgent" : "codex"), importedEntry];
    const thread = importedThread(importedEntry.instanceId);
    const lockedProvider = deriveLockedProvider({
      thread,
      selectedProvider: entries[0]!.instanceId,
      threadProvider: thread.modelSelection.instanceId,
      providers: entries.map((entry) => entry.snapshot),
    });

    expect(thread.session).toBeNull();
    expect(lockedProvider).toBe(driver);
    expect(
      resolveComposerProviderSelection({
        entries,
        candidateInstanceIds: [thread.modelSelection.instanceId],
        lockedProvider,
        lockedInstanceId: thread.modelSelection.instanceId,
      }).selectedProviderEntry?.instanceId,
    ).toBe(importedEntry.instanceId);
  });

  it("keeps the session driver authoritative over instance and draft selections", () => {
    const selected = entry("claudeAgent", "claude_work");
    const sessionEntry = entry("ollama", "local_models");
    const thread = importedThread(selected.instanceId);

    expect(
      deriveLockedProvider({
        thread: {
          ...thread,
          session: {
            ...readySession,
            providerName: sessionEntry.driverKind,
            providerInstanceId: sessionEntry.instanceId,
          },
        },
        selectedProvider: selected.instanceId,
        threadProvider: thread.modelSelection.instanceId,
        providers: [selected.snapshot, sessionEntry.snapshot],
      }),
    ).toBe(sessionEntry.driverKind);
  });

  it.each(["missing", "disabled"] as const)(
    "does not move imported history to another driver when its instance is %s",
    (state) => {
      const imported = entry("claudeAgent", "claude_work", { enabled: false });
      const other = entry("codex");
      const entries = state === "missing" ? [other] : [other, imported];
      const thread = importedThread(imported.instanceId);
      const lockedProvider = deriveLockedProvider({
        thread,
        selectedProvider: other.instanceId,
        threadProvider: thread.modelSelection.instanceId,
        providers: entries.map((entry) => entry.snapshot),
      });

      expect(lockedProvider).not.toBeNull();
      expect(
        resolveComposerProviderSelection({
          entries,
          candidateInstanceIds: [other.instanceId, imported.instanceId],
          lockedProvider,
          lockedInstanceId: imported.instanceId,
        }).selectedProviderEntry,
      ).toBeUndefined();
    },
  );

  it("keeps a signed-out selection instead of silently switching providers", () => {
    const signedOutEntry = entry("antigravity", "google_work", {
      status: "error",
      auth: { status: "unauthenticated" },
      models: catalogModels,
    });
    const selection = resolveComposerProviderSelection({
      entries: [entry("codex"), signedOutEntry],
      candidateInstanceIds: [signedOutEntry.instanceId],
      lockedProvider: null,
      lockedInstanceId: null,
    });

    expect(selection.selectedProviderEntry?.instanceId).toBe(signedOutEntry.instanceId);
    expect(
      getAntigravitySendBlockReason(selection.selectedProviderEntry?.snapshot, "gemini-pro"),
    ).toBe("Sign in to Antigravity in provider settings before sending.");
  });

  it("blocks sends until the selected Antigravity profile is installed", () => {
    const provider = entry("antigravity", "google_work", {
      installed: false,
      models: catalogModels,
    }).snapshot;

    expect(getAntigravitySendBlockReason(provider, "gemini-pro")).toBe(
      "Install Antigravity in provider settings before sending.",
    );
  });

  it("lets Antigravity check saved credentials when resuming after a restart", () => {
    const provider = entry("antigravity", "google_work", {
      status: "warning",
      auth: { status: "unknown" },
      models: [],
    }).snapshot;

    expect(getAntigravitySendBlockReason(provider, "gemini-pro")).toBeNull();
    expect(getAntigravitySendBlockReason(provider, ANTIGRAVITY_DEFAULT_MODEL)).toBeNull();
    expect(
      getAntigravitySendBlockReason({ ...provider, models: catalogModels }, "gemini-pro"),
    ).toBeNull();
    expect(getAntigravitySendBlockReason(provider, "")).toBe(
      "Choose an Antigravity model before sending.",
    );
  });

  it("blocks saved model sends until Antigravity loads its account catalog", () => {
    expect(getAntigravitySendBlockReason(entry("antigravity").snapshot, "gemini-pro")).toBe(
      "Refresh Antigravity models in provider settings before sending.",
    );
  });

  it("blocks a saved model that a ready catalog no longer lists", () => {
    const provider = entry("antigravity", "google_work", {
      status: "ready",
      models: catalogModels,
    }).snapshot;

    expect(getAntigravitySendBlockReason(provider, "saved-model-not-in-current-catalog")).toBe(
      "That Antigravity model is no longer available. Choose another model.",
    );
    expect(getAntigravitySendBlockReason(provider, "gemini-pro")).toBeNull();
  });

  it("does not continue an existing Antigravity thread in another profile after deletion", () => {
    const missingInstanceId = ProviderInstanceId.make("google_work");
    const selection = resolveComposerProviderSelection({
      entries: [entry("antigravity")],
      candidateInstanceIds: [missingInstanceId],
      lockedProvider: ProviderDriverKind.make("antigravity"),
      lockedInstanceId: missingInstanceId,
    });

    expect(selection.selectedProviderEntry).toBeUndefined();
    expect(selection.unavailableProviderInstanceId).toBe(missingInstanceId);
  });
});

describe("resolveComposerInteractionMode", () => {
  it("resets a restored plan draft when the selected instance does not support plan mode", () => {
    expect(
      resolveComposerInteractionMode({
        planModeEnabled: true,
        provider: { showInteractionModeToggle: false },
        interactionMode: "plan",
      }),
    ).toEqual({ enabled: false, interactionMode: "default" });
  });

  it("disables plan mode until the selected provider is available", () => {
    expect(
      resolveComposerInteractionMode({
        planModeEnabled: true,
        provider: null,
        interactionMode: "plan",
      }),
    ).toEqual({ enabled: false, interactionMode: "default" });
  });
});

describe("getStartedThreadModelChangeBlockReason", () => {
  const providers = [
    {
      instanceId: ProviderInstanceId.make("codex"),
    },
    {
      instanceId: ProviderInstanceId.make("grok"),
      requiresNewThreadForModelChange: true,
    },
  ];

  it("allows model changes before a provider session has started", () => {
    expect(
      getStartedThreadModelChangeBlockReason({
        providers,
        hasStartedSession: false,
        currentModelSelection: {
          instanceId: ProviderInstanceId.make("grok"),
          model: "grok-build",
        },
        nextModelSelection: {
          instanceId: ProviderInstanceId.make("grok"),
          model: "grok-other",
        },
      }),
    ).toBeNull();
  });

  it("blocks started-session model changes when either provider requires a new thread", () => {
    expect(
      getStartedThreadModelChangeBlockReason({
        providers,
        hasStartedSession: true,
        currentModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        nextModelSelection: {
          instanceId: ProviderInstanceId.make("grok"),
          model: "grok-build",
        },
      }),
    ).toEqual({
      title: "Start a new chat to change models",
      description:
        "This provider does not allow switching models after a conversation has started.",
    });
  });
});

describe("shouldShowPlanFollowUpPrompt", () => {
  const base = {
    pendingUserInputCount: 0,
    interactionMode: "plan" as const,
    latestTurnSettled: true,
    hasActionableProposedPlan: true,
    hasComposerAttachments: false,
  };

  it("shows plan actions for a settled actionable plan without attachments", () => {
    expect(shouldShowPlanFollowUpPrompt(base)).toBe(true);
  });

  it("hides plan actions while the composer has staged attachments", () => {
    expect(shouldShowPlanFollowUpPrompt({ ...base, hasComposerAttachments: true })).toBe(false);
  });

  it("preserves the existing plan follow-up gates", () => {
    expect(shouldShowPlanFollowUpPrompt({ ...base, pendingUserInputCount: 1 })).toBe(false);
    expect(shouldShowPlanFollowUpPrompt({ ...base, interactionMode: "default" })).toBe(false);
    expect(shouldShowPlanFollowUpPrompt({ ...base, latestTurnSettled: false })).toBe(false);
    expect(shouldShowPlanFollowUpPrompt({ ...base, hasActionableProposedPlan: false })).toBe(false);
  });
});

describe("shouldWriteThreadErrorToCurrentServerThread", () => {
  it("requires an active server thread matching the environment, route, and target", () => {
    const routeThreadRef = { environmentId, threadId };

    expect(
      shouldWriteThreadErrorToCurrentServerThread({
        activeServerThread: null,
        routeThreadRef,
        targetThreadId: threadId,
      }),
    ).toBe(false);
  });
});

describe("rewind draft recovery", () => {
  const message = {
    id: MessageId.make("rewound-message"),
    role: "user" as const,
    text: "edit this question",
    turnId: TurnId.make("rewound-turn"),
    createdAt: now,
    updatedAt: now,
    streaming: false,
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("waits past command acceptance until the exact message disappears", async () => {
    const atom = Atom.make<Thread | null>(makeThread({ messages: [message] }));
    vi.spyOn(environmentThreadDetails, "detailAtom").mockReturnValue(atom);
    let accepted = false;
    const result = waitForRevertedMessage({ environmentId, threadId }, message.id, 0, async () => {
      accepted = true;
    });
    let completed = false;
    void result.then(() => {
      completed = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(accepted).toBe(true);
    expect(completed).toBe(false);
    appAtomRegistry.set(
      atom,
      makeThread({
        messages: [],
        latestTurn: completedTurn,
        checkpoints: [
          {
            turnId: completedTurn.turnId,
            checkpointTurnCount: 1,
            checkpointRef: CheckpointRef.make("refs/t3/checkpoints/1"),
            status: "ready",
            files: [],
            assistantMessageId: null,
            completedAt: now,
          },
        ],
      }),
    );
    await Promise.resolve();
    expect(completed).toBe(false);
    appAtomRegistry.set(atom, makeThread({ messages: [] }));
    await result;
  });

  it("rejects a new provider rewind failure without restoring a draft", async () => {
    const atom = Atom.make<Thread | null>(makeThread({ messages: [message] }));
    vi.spyOn(environmentThreadDetails, "detailAtom").mockReturnValue(atom);
    const result = waitForRevertedMessage({ environmentId, threadId }, message.id, 0, async () => {
      appAtomRegistry.set(
        atom,
        makeThread({
          messages: [message],
          activities: [
            {
              id: EventId.make("rewind-failed"),
              kind: "checkpoint.revert.failed",
              tone: "error",
              summary: "Checkpoint revert failed",
              payload: { detail: "Native history unavailable", turnCount: 0 },
              turnId: null,
              createdAt: now,
            },
          ],
        }),
      );
    });
    await expect(result).rejects.toThrow("Native history unavailable");
  });

  it("bounds waits when a provider never finishes", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const atom = Atom.make<Thread | null>(makeThread({ messages: [message] }));
    vi.spyOn(environmentThreadDetails, "detailAtom").mockReturnValue(atom);
    const result = waitForRevertedMessage(
      { environmentId, threadId },
      message.id,
      0,
      async () => {},
      20,
    );
    const timeoutIndex = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 20);
    const rewindTimeout = setTimeoutSpy.mock.results[timeoutIndex]?.value;
    expect(rewindTimeout).toBeDefined();
    const rejection = expect(result).rejects.toThrow("Timed out waiting");
    await vi.advanceTimersByTimeAsync(20);
    await rejection;
    expect(clearTimeoutSpy).toHaveBeenCalledWith(rewindTimeout);
  });

  it("copies attachment bytes before rewind into a fresh file", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("original bytes"));
    vi.stubGlobal("fetch", fetchMock);
    const files = await prepareRevertedMessageAttachments({
      message: {
        ...message,
        attachments: [
          {
            type: "file",
            id: "old-attachment",
            name: "notes.txt",
            mimeType: "text/plain",
            sizeBytes: 14,
          },
        ],
      },
      environmentId,
      httpBaseUrl: "https://server.test",
      createAssetUrl: async () =>
        AsyncResult.success({ relativeUrl: "/asset/signed", expiresAt: Date.now() + 60_000 }),
    });
    expect(files[0]).toBeInstanceOf(File);
    expect(files[0]?.name).toBe("notes.txt");
    expect(await files[0]?.text()).toBe("original bytes");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://server.test/asset/signed");
  });
});

describe("restorePlanFollowUpComposer", () => {
  it("writes back every field a cleared plan follow-up composer held", () => {
    const snapshot = {
      prompt: "Follow up on the plan",
      terminalContexts: [
        {
          id: "terminal-1",
          threadId: ThreadId.make("thread-1"),
          createdAt: "2026-09-11T00:00:00.000Z",
          terminalId: "main",
          terminalLabel: "Main",
          lineStart: 1,
          lineEnd: 2,
          text: "output",
        },
      ],
      reviewComments: [
        {
          id: "review-1",
          sectionId: "file:a.ts",
          sectionTitle: "File comment",
          filePath: "a.ts",
          startIndex: 0,
          endIndex: 0,
          rangeLabel: "L1",
          text: "look here",
          diff: "",
        },
      ],
      previewAnnotations: [],
    };
    const writePrompt = vi.fn();
    const writeTerminalContexts = vi.fn();
    const writeReviewComments = vi.fn();
    const writePreviewAnnotations = vi.fn();
    const resetCursor = vi.fn();

    restorePlanFollowUpComposer({
      snapshot,
      writePrompt,
      writeTerminalContexts,
      writeReviewComments,
      writePreviewAnnotations,
      resetCursor,
    });

    expect(writePrompt).toHaveBeenCalledTimes(1);
    expect(writePrompt).toHaveBeenCalledWith("Follow up on the plan");
    expect(writeTerminalContexts).toHaveBeenCalledTimes(1);
    expect(writeTerminalContexts).toHaveBeenCalledWith(snapshot.terminalContexts);
    expect(writeReviewComments).toHaveBeenCalledTimes(1);
    expect(writeReviewComments).toHaveBeenCalledWith(snapshot.reviewComments);
    expect(writePreviewAnnotations).toHaveBeenCalledTimes(1);
    expect(writePreviewAnnotations).toHaveBeenCalledWith(snapshot.previewAnnotations);
    expect(resetCursor).toHaveBeenCalledTimes(1);
    expect(resetCursor).toHaveBeenCalledWith({
      cursor: expect.any(Number),
      prompt: "Follow up on the plan",
      detectTrigger: true,
    });
  });
});

describe("worktree setup visibility", () => {
  const stage = (
    id: "fetch" | "checkout" | "submodules" | "setup-script" | "agent",
    status: "done" | "running" | "failed" | "pending",
  ) => ({
    id,
    status,
    startedAt: now,
    endedAt: status === "running" || status === "pending" ? null : now,
    percent: null,
    detail: null,
    tail: [],
  });
  const base = {
    threadId,
    phase: "running" as const,
    startedAt: now,
    endedAt: null,
    branch: "feature",
    baseRef: "main",
    worktreePath: null,
    setupScript: null,
    stages: [stage("checkout", "running"), stage("agent", "pending")],
    error: null,
    sequence: 1,
  };
  const settledDone = {
    ...base,
    phase: "done" as const,
    endedAt: now,
    stages: [stage("checkout", "done"), stage("setup-script", "done"), stage("agent", "done")],
  };

  it("prefers whichever snapshot is newer by sequence", () => {
    const pick = (live: WorktreeSetupSnapshot | null, recorded: WorktreeSetupSnapshot | null) =>
      resolveVisibleWorktreeSetup({ live, recorded, turnStarted: false, followUpSent: false });
    expect(pick({ ...base, sequence: 3 }, { ...settledDone, sequence: 7 })).toEqual({
      ...settledDone,
      sequence: 7,
    });
    expect(pick({ ...settledDone, sequence: 9 }, { ...base, sequence: 1 })).toEqual({
      ...settledDone,
      sequence: 9,
    });
  });
});
