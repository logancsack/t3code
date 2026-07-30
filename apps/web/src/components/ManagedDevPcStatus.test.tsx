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
      sessionStorage: {
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

  it("does not invent a default idle timeout when settings metadata is absent", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const { idleTimeoutLabel } = await import("./ManagedDevPcStatus");

    expect(idleTimeoutLabel(undefined)).toBe("Unavailable");
    expect(idleTimeoutLabel(30)).toBe("30 minutes");
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
