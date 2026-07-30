import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { ManagedDevPcDisplayStatus, ManagedDevPcWorkspaceState } from "../managedDevPc";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function renderManagedStatus(input: {
  managed?: boolean;
  state: ManagedDevPcWorkspaceState;
  status?: ManagedDevPcDisplayStatus;
  ready: boolean;
}) {
  vi.stubEnv("VITE_DEVPC_MANAGED", input.managed === false ? "" : "1");
  vi.resetModules();
  vi.stubGlobal("window", {
    __DEVPC_MANAGED_BOOTSTRAP__: {
      managed: true,
      state: input.state,
      status: input.status,
      ready: input.ready,
      previewUrlTemplate: "https://{port}.preview.example.test/",
    },
  });

  const { ManagedDevPcStatus } = await import("./ManagedDevPcStatus");
  return renderToStaticMarkup(<ManagedDevPcStatus />);
}

describe("ManagedDevPcStatus", () => {
  it("renders one truthful workspace control", async () => {
    const markup = await renderManagedStatus({
      state: "ready",
      status: "running",
      ready: true,
    });

    expect(markup).toContain('data-devpc-workspace-status="running"');
    expect(markup).toContain("Workspace · Running");
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).not.toContain("Pauses after 30 minutes");
    expect(markup).not.toContain('aria-label="Restart workspace"');
    expect(markup).not.toContain("fixed");
  });

  it("renders nothing outside managed DevPC mode", async () => {
    const markup = await renderManagedStatus({ managed: false, state: "ready", ready: true });

    expect(markup).toBe("");
  });

  it("restores an ambiguous lifecycle guard after a document reload", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const setItem = vi.fn();
    vi.stubGlobal("window", {
      __DEVPC_MANAGED_BOOTSTRAP__: {
        managed: true,
        state: "ready",
        status: "running",
        ready: true,
        previewUrlTemplate: "https://{port}.preview.example.test/",
      },
      localStorage: {
        getItem: vi.fn(() =>
          JSON.stringify({
            action: "restart",
            phase: "pending",
            idempotencyKey: "restart-persisted-key",
            progressObserved: true,
            restartConfirmations: 0,
          }),
        ),
        setItem,
      },
    });

    const { ManagedDevPcStatus } = await import("./ManagedDevPcStatus");
    const markup = renderToStaticMarkup(<ManagedDevPcStatus />);

    expect(markup).toContain("Workspace · Running");
    expect(markup).not.toContain('aria-label="Restart workspace"');
    expect(setItem).toHaveBeenCalledWith(
      "devpc-managed-workspace-action",
      expect.stringContaining('"phase":"uncertain"'),
    );
  });

  it("clears an already-hydrated pause guard when bootstrap observes the paused state", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const removeItem = vi.fn();
    let clearedListener: EventListener | undefined;
    vi.stubGlobal("window", {
      __DEVPC_MANAGED_BOOTSTRAP__: {
        managed: true,
        state: "paused",
        status: "paused",
        ready: false,
        previewUrlTemplate: "https://{port}.preview.example.test/",
      },
      localStorage: {
        getItem: vi.fn(() =>
          JSON.stringify({
            action: "pause",
            phase: "pending",
            idempotencyKey: "pause-persisted-key",
            progressObserved: false,
            restartConfirmations: 0,
          }),
        ),
        setItem: vi.fn(),
        removeItem,
      },
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        if (type === "devpc-managed-workspace-action-cleared") clearedListener = listener;
      }),
    });

    await import("./ManagedDevPcStatus");
    clearedListener?.(
      new CustomEvent("devpc-managed-workspace-action-cleared", {
        detail: { action: "pause" },
      }),
    );

    expect(removeItem).toHaveBeenCalledWith("devpc-managed-workspace-action");
  });

  it("shares an uncertain lifecycle guard with other open tabs", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    let storageListener: EventListener | undefined;
    vi.stubGlobal("window", {
      __DEVPC_MANAGED_BOOTSTRAP__: {
        managed: true,
        state: "ready",
        status: "running",
        ready: true,
        previewUrlTemplate: "https://{port}.preview.example.test/",
      },
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        if (type === "storage") storageListener = listener;
      }),
    });

    const { getManagedActionSnapshot } = await import("./ManagedDevPcStatus");
    storageListener?.({
      key: "devpc-managed-workspace-action",
      newValue: JSON.stringify({
        action: "restart",
        phase: "pending",
        idempotencyKey: "restart-shared-key",
        progressObserved: false,
        restartConfirmations: 0,
      }),
    } as StorageEvent);

    expect(getManagedActionSnapshot().uncertainAction).toBe("restart");

    storageListener?.({
      key: "devpc-managed-workspace-action",
      newValue: null,
    } as StorageEvent);
    expect(getManagedActionSnapshot().uncertainAction).toBeNull();
    expect(getManagedActionSnapshot().statusUnavailable).toBe(true);
  });

  it.each([
    ["starting", "starting", "Starting…"],
    ["ready", "reconnecting", "Reconnecting…"],
    ["ready", "unreachable", "Unreachable"],
    ["paused", "paused", "Paused"],
    ["error", "attention", "Needs attention"],
  ] as const)("renders the %s workspace state", async (state, status, label) => {
    const markup = await renderManagedStatus({ state, status, ready: false });

    expect(markup).toContain(`data-devpc-workspace-status="${status}"`);
    expect(markup).toContain(`Workspace · ${label}`);
  });

  it("does not preserve a running label after a status request becomes unavailable", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const { displayStatus } = await import("./ManagedDevPcStatus");

    expect(
      displayStatus(
        {
          managed: true,
          state: "ready",
          status: "running",
          ready: true,
          previewUrlTemplate: "https://{port}.preview.example.test/",
        },
        null,
        true,
      ),
    ).toBe("unreachable");
    expect(
      displayStatus(
        {
          managed: true,
          state: "restarting",
          status: "restarting",
          ready: false,
          previewUrlTemplate: "https://{port}.preview.example.test/",
        },
        "restart",
        true,
      ),
    ).toBe("unreachable");
    expect(
      displayStatus(
        {
          managed: true,
          state: "ready",
          status: "unreachable",
          ready: false,
          previewUrlTemplate: "https://{port}.preview.example.test/",
        },
        "restart",
      ),
    ).toBe("unreachable");
  });

  it("falls back safely when the server returns an unknown status", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const { displayStatus } = await import("./ManagedDevPcStatus");

    expect(
      displayStatus({
        managed: true,
        state: "ready",
        status: "future-status" as ManagedDevPcDisplayStatus,
        ready: true,
        previewUrlTemplate: "https://{port}.preview.example.test/",
      }),
    ).toBe("attention");
  });

  it("rolls back only the idle timeout on a newer workspace snapshot", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const { withIdleTimeout } = await import("./ManagedDevPcStatus");
    const latest = {
      managed: true as const,
      state: "paused" as const,
      status: "paused" as const,
      ready: false,
      idleTimeoutMinutes: 15,
      lastHeartbeatAt: "2026-07-30T07:00:00.000Z",
      previewUrlTemplate: "https://{port}.preview.example.test/",
    };

    expect(withIdleTimeout(latest, 30)).toEqual({
      ...latest,
      idleTimeoutMinutes: 30,
    });
    expect(withIdleTimeout(latest, undefined)).not.toHaveProperty("idleTimeoutMinutes");
  });

  it("keeps a confirmed idle timeout projected until status observes it", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const { reconcileIdleTimeoutProjection } = await import("./ManagedDevPcStatus");

    expect(reconcileIdleTimeoutProjection(30, { minutes: 60, mismatches: 0 }, false)).toEqual({
      effectiveIdleTimeoutMinutes: 60,
      projection: { minutes: 60, mismatches: 1 },
    });
    expect(reconcileIdleTimeoutProjection(60, { minutes: 60, mismatches: 1 }, false)).toEqual({
      effectiveIdleTimeoutMinutes: 60,
      projection: null,
    });
    expect(reconcileIdleTimeoutProjection(60, { minutes: 60, mismatches: 0 }, true)).toEqual({
      effectiveIdleTimeoutMinutes: 60,
      projection: { minutes: 60, mismatches: 0 },
    });
    expect(reconcileIdleTimeoutProjection(30, { minutes: 60, mismatches: 2 }, false)).toEqual({
      effectiveIdleTimeoutMinutes: 30,
      projection: null,
    });
  });

  it("counts only serialized idle-timeout mismatch confirmations", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const { reconcileIdleTimeoutRefresh } = await import("./ManagedDevPcStatus");
    const projectionAtRequestStart = { minutes: 60, mismatches: 0 };
    const projectionAfterEarlierResponse = { minutes: 60, mismatches: 1 };

    expect(
      reconcileIdleTimeoutRefresh(
        30,
        projectionAtRequestStart,
        projectionAfterEarlierResponse,
        false,
        60,
      ),
    ).toEqual({
      effectiveIdleTimeoutMinutes: 60,
      projection: projectionAfterEarlierResponse,
    });
    expect(
      reconcileIdleTimeoutRefresh(
        30,
        projectionAfterEarlierResponse,
        projectionAfterEarlierResponse,
        false,
        60,
      ),
    ).toEqual({
      effectiveIdleTimeoutMinutes: 60,
      projection: { minutes: 60, mismatches: 2 },
    });
  });

  it("does not invent a default idle timeout when settings metadata is absent", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const { idleTimeoutLabel } = await import("./ManagedDevPcStatus");

    expect(idleTimeoutLabel(undefined)).toBe("Unavailable");
    expect(idleTimeoutLabel(30)).toBe("30 minutes");
  });

  it("explains that stopped workspaces must be resumed", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const { autoPauseDescription } = await import("./ManagedDevPcStatus");

    expect(autoPauseDescription("stopped", 30, "10:30")).toBe("Stopped until you resume.");
    expect(autoPauseDescription("paused", 30, "10:30")).toBe("Paused until you resume.");
  });

  it("keeps an interrupted action locked until status confirms progress or completion", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const { actionSnapshotResult } = await import("./ManagedDevPcStatus");
    const running = {
      managed: true as const,
      state: "ready" as const,
      status: "running" as const,
      ready: true,
      previewUrlTemplate: "https://{port}.preview.example.test/",
    };

    expect(actionSnapshotResult("pause", running)).toBe("pending");
    expect(actionSnapshotResult("restart", running)).toBe("pending");
    expect(actionSnapshotResult("restart", running, true)).toBe("pending");
    expect(actionSnapshotResult("restart", running, true, 1)).toBe("resolved");
    expect(
      actionSnapshotResult("restart", {
        ...running,
        state: "error",
        status: "attention",
        ready: false,
      }),
    ).toBe("failed");
    expect(
      actionSnapshotResult("pause", {
        ...running,
        state: "paused",
        status: "paused",
        ready: false,
      }),
    ).toBe("resolved");
    expect(
      actionSnapshotResult("resume", {
        ...running,
        status: "starting",
      }),
    ).toBe("progressing");
    expect(
      actionSnapshotResult(
        "restart",
        {
          ...running,
          status: "reconnecting",
        },
        true,
        1,
      ),
    ).toBe("pending");
  });

  it("makes an accepted but ineffective pause or resume retryable after bounded polls", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const { ineffectiveActionPollResult } = await import("./ManagedDevPcStatus");

    expect(ineffectiveActionPollResult(true, 4, 4)).toEqual({
      polls: 5,
      retryable: false,
    });
    expect(ineffectiveActionPollResult(true, 5, 5)).toEqual({
      polls: 6,
      retryable: true,
    });
    expect(ineffectiveActionPollResult(true, 5, 4)).toBeNull();
    expect(ineffectiveActionPollResult(false, 5, 5)).toBeNull();
  });

  it("cleans up only the lifecycle request that still owns the action key", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const { ownsManagedActionRequest } = await import("./ManagedDevPcStatus");

    expect(ownsManagedActionRequest("pause-original", "pause-original")).toBe(true);
    expect(ownsManagedActionRequest("pause-newer-tab", "pause-original")).toBe(false);
    expect(ownsManagedActionRequest(undefined, "pause-original")).toBe(false);
  });

  it("treats gateway failures as ambiguous lifecycle outcomes", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const { isAmbiguousLifecycleResponse } = await import("../managedDevPc");

    expect(isAmbiguousLifecycleResponse(408)).toBe(true);
    expect(isAmbiguousLifecycleResponse(500)).toBe(true);
    expect(isAmbiguousLifecycleResponse(502)).toBe(true);
    expect(isAmbiguousLifecycleResponse(504)).toBe(true);
    expect(isAmbiguousLifecycleResponse(409)).toBe(false);
    expect(isAmbiguousLifecycleResponse(422)).toBe(false);
  });
});
