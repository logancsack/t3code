import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type {
  ManagedDevPcBootstrap,
  ManagedDevPcDisplayStatus,
  ManagedDevPcTelemetry,
  ManagedDevPcWorkspaceState,
} from "../managedDevPc";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => () => Promise.resolve(),
    useLocation: ({ select }: { select: (location: { hash: string }) => unknown }) =>
      select({ hash: "" }),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function renderManagedStatus(input: {
  managed?: boolean;
  state: ManagedDevPcWorkspaceState;
  status?: ManagedDevPcDisplayStatus;
  ready: boolean;
  view?: "indicator" | "settings";
  lastActivityAt?: string | null;
  telemetry?: ManagedDevPcTelemetry | null;
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
      lastActivityAt: input.lastActivityAt,
      telemetry: input.telemetry,
    },
  });

  const { ManagedDevPcStatus } = await import("./ManagedDevPcStatus");
  return renderToStaticMarkup(<ManagedDevPcStatus {...(input.view ? { view: input.view } : {})} />);
}

describe("ManagedDevPcStatus", () => {
  it("renders one truthful workspace control", async () => {
    const markup = await renderManagedStatus({
      state: "ready",
      status: "running",
      ready: true,
    });

    expect(markup).toContain('data-devpc-workspace-status="running"');
    expect(markup).toContain("Workspace — Running");
    expect(markup).toContain("Open workspace settings");
    expect(markup).not.toContain("Pauses after 30 minutes");
    expect(markup).not.toContain('aria-label="Restart workspace"');
    expect(markup).not.toContain("fixed");
  });

  it("allows controls when explicit running status overrides stale legacy state", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const { canOperateManagedWorkspace, displayStatus } = await import("./ManagedDevPcStatus");
    const status = displayStatus({
      managed: true,
      state: "restarting",
      status: "running",
      ready: true,
      previewUrlTemplate: "https://{port}.preview.example.test/",
    });

    expect(status).toBe("running");
    expect(canOperateManagedWorkspace(status, null, null)).toBe(true);
    expect(canOperateManagedWorkspace(status, "restart", null)).toBe(false);
  });

  it("renders nothing outside managed DevPC mode", async () => {
    const markup = await renderManagedStatus({ managed: false, state: "ready", ready: true });

    expect(markup).toBe("");
  });

  it("renders the workspace controls on the settings page instead of in the indicator", async () => {
    const markup = await renderManagedStatus({
      state: "ready",
      status: "running",
      ready: true,
      view: "settings",
    });

    expect(markup).toContain("data-devpc-workspace-control-center");
    expect(markup).toContain("Pauses after 15 minutes of inactivity");
    expect(markup).toContain("This timing is fixed");
    expect(markup).not.toContain("combobox");
    expect(markup).toContain(">Restart<");
    expect(markup).toContain(">Pause<");
    expect(markup).not.toContain("data-devpc-workspace-status");
  });

  it("reports lifecycle activity instead of guest uptime", async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const markup = await renderManagedStatus({
      state: "ready",
      status: "running",
      ready: true,
      view: "settings",
      lastActivityAt: oneHourAgo,
      telemetry: {
        sampledAt: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
        cpuPercent: 0,
        memory: { usedBytes: 1, totalBytes: 2 },
        disks: { root: null, workspace: null },
        uptimeSeconds: 8 * 60 * 60,
        t3Healthy: true,
      },
    });

    expect(markup).toContain("Last activity");
    expect(markup).toContain("1h ago");
    expect(markup).not.toContain("8h ago");
    expect(markup).not.toContain(">Uptime<");
    expect(markup).not.toContain("8 hours");
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

    expect(markup).toContain("Workspace — Running");
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
    expect(markup).toContain(`Workspace — ${label.replace("…", "")}`);
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

  it("keeps gateway-minted bootstrap fields across a status poll", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const { mergeBootstrapStatus } = await import("./ManagedDevPcStatus");
    const bootstrap = {
      managed: true as const,
      state: "ready" as const,
      status: "running" as const,
      ready: true,
      previewUrlTemplate: "https://{port}.preview.example.test/",
      previewUrls: { "6080": "/_devpc/browser", "3000": "https://3000.preview.example.test/" },
      pairingToken: "pairing-token",
    };
    // The status endpoint returns lifecycle fields only — no previewUrlTemplate,
    // previewUrls, or pairingToken — which is why the poll is a merge, not a
    // replacement. Modeled with a cast, as refresh() casts the parsed JSON.
    const statusPoll = {
      managed: true as const,
      state: "paused" as const,
      status: "paused" as const,
      ready: false,
    } as ManagedDevPcBootstrap;

    const merged = mergeBootstrapStatus(bootstrap, statusPoll);

    expect(merged.status).toBe("paused");
    expect(merged.ready).toBe(false);
    expect(merged.previewUrlTemplate).toBe(bootstrap.previewUrlTemplate);
    expect(merged.previewUrls).toEqual(bootstrap.previewUrls);
    expect(merged.pairingToken).toBe("pairing-token");
    expect(mergeBootstrapStatus(undefined, statusPoll)).toEqual(statusPoll);
  });

  it("always describes the fixed idle timeout when no stop clock is available", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const { autoPauseDescription } = await import("./ManagedDevPcStatus");

    expect(autoPauseDescription("running", null)).toBe("Pauses after 15 minutes of inactivity.");
  });

  it("explains that stopped workspaces must be resumed", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const { autoPauseDescription } = await import("./ManagedDevPcStatus");

    expect(autoPauseDescription("stopped", "10:30")).toBe("Stopped until you resume.");
    expect(autoPauseDescription("paused", "10:30")).toBe("Paused until you resume.");
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
        status: "running",
      }),
    ).toBe("pending");
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
      actionSnapshotResult("restart", {
        ...running,
        state: "ready",
        status: "paused",
        ready: false,
      }),
    ).toBe("failed");
    expect(
      actionSnapshotResult("restart", {
        ...running,
        state: "ready",
        status: "stopped",
        ready: false,
      }),
    ).toBe("failed");
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

  it("names a runtime update instead of a generic start while a wake installs one", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const { managedStatusLabel, managedStatusDescription } = await import("./ManagedDevPcStatus");

    expect(managedStatusLabel("starting", { runtimeUpdating: true })).toBe("Updating…");
    expect(managedStatusDescription("starting", { runtimeUpdating: true })).toBe(
      "Installing the latest Aldo runtime before opening…",
    );
    // Only a start that is actually installing an update presents as one.
    expect(managedStatusLabel("starting", { runtimeUpdating: false })).toBe("Starting…");
    expect(managedStatusLabel("starting")).toBe("Starting…");
    expect(managedStatusLabel("running", { runtimeUpdating: true })).toBe("Running");
    expect(managedStatusDescription("running", { runtimeUpdating: true })).toBe(
      "Connected and ready.",
    );
  });
});
