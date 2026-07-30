import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function renderManagedStatus(input: {
  managed?: boolean;
  state: "starting" | "ready" | "restarting" | "paused" | "stopped" | "error";
  status?:
    | "running"
    | "starting"
    | "restarting"
    | "pausing"
    | "paused"
    | "stopped"
    | "restoring"
    | "reconnecting"
    | "unreachable"
    | "attention";
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
});
