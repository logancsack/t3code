import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function renderManagedStatus(input: {
  managed?: boolean;
  state: "starting" | "ready" | "restarting" | "stopped" | "error";
  ready: boolean;
}) {
  vi.stubEnv("VITE_DEVPC_MANAGED", input.managed === false ? "" : "1");
  vi.resetModules();
  vi.stubGlobal("window", {
    __DEVPC_MANAGED_BOOTSTRAP__: {
      managed: true,
      state: input.state,
      ready: input.ready,
      previewUrlTemplate: "https://{port}.preview.example.test/",
    },
  });

  const { ManagedDevPcStatus } = await import("./ManagedDevPcStatus");
  return renderToStaticMarkup(<ManagedDevPcStatus />);
}

describe("ManagedDevPcStatus", () => {
  it("renders workspace state and restart as sidebar utility controls", async () => {
    const markup = await renderManagedStatus({ state: "ready", ready: true });

    expect(markup).toContain('data-devpc-workspace-status="ready"');
    expect(markup).toContain("Workspace · Online");
    expect(markup).toContain('aria-label="Restart workspace"');
    expect(markup).not.toContain("fixed");
  });

  it("renders nothing outside managed DevPC mode", async () => {
    const markup = await renderManagedStatus({ managed: false, state: "ready", ready: true });

    expect(markup).toBe("");
  });

  it.each([
    ["starting", "Starting"],
    ["error", "Needs attention"],
  ] as const)("disables restart while the workspace is %s", async (state, label) => {
    const markup = await renderManagedStatus({ state, ready: false });

    expect(markup).toContain(`data-devpc-workspace-status="${state}"`);
    expect(markup).toContain(`Workspace · ${label}`);
    expect(markup).toContain('aria-label="Restart workspace"');
    expect(markup).toContain("disabled");
  });
});
