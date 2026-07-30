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
    expect(markup).not.toContain('aria-label="Restart workspace"');
    expect(markup).not.toContain("fixed");
  });

  it("renders nothing outside managed DevPC mode", async () => {
    const markup = await renderManagedStatus({ managed: false, state: "ready", ready: true });

    expect(markup).toBe("");
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
});
