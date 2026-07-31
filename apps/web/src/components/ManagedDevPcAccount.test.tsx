import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function renderAccountButton(managed: boolean) {
  vi.stubEnv("VITE_DEVPC_MANAGED", managed ? "1" : "");
  vi.resetModules();
  vi.stubGlobal("window", {});

  const { ManagedDevPcAccountButton } = await import("./ManagedDevPcAccount");
  return renderToStaticMarkup(<ManagedDevPcAccountButton />);
}

describe("ManagedDevPcAccountButton", () => {
  it("renders a native account trigger and defers the iframe until opened", async () => {
    const markup = await renderAccountButton(true);

    expect(markup).toContain("data-devpc-account-button");
    expect(markup).toContain("Open account settings for Account");
    expect(markup).not.toContain("data-devpc-account-frame");
  });

  it("renders nothing outside managed DevPC mode", async () => {
    expect(await renderAccountButton(false)).toBe("");
  });
});
