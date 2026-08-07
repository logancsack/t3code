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

  it("shows the default person mark until a profile picture arrives", async () => {
    const markup = await renderAccountButton(true);

    expect(markup).not.toContain("data-devpc-account-avatar");
    expect(markup).toContain("<svg");
  });

  it("renders nothing outside managed DevPC mode", async () => {
    expect(await renderAccountButton(false)).toBe("");
  });
});

describe("sameOriginAccountImage", () => {
  async function load() {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    vi.stubGlobal("window", {});
    return (await import("./ManagedDevPcAccount")).sameOriginAccountImage;
  }

  it("accepts the gateway's same-origin avatar path", async () => {
    const sameOriginAccountImage = await load();

    expect(sameOriginAccountImage("/_devpc/account/avatar?v=abc123")).toBe(
      "/_devpc/account/avatar?v=abc123",
    );
    expect(sameOriginAccountImage("  /_devpc/account/avatar  ")).toBe("/_devpc/account/avatar");
  });

  it("falls back to the default mark for missing or off-origin images", async () => {
    const sameOriginAccountImage = await load();

    expect(sameOriginAccountImage(null)).toBeNull();
    expect(sameOriginAccountImage(undefined)).toBeNull();
    expect(sameOriginAccountImage("   ")).toBeNull();
    expect(sameOriginAccountImage("https://img.clerk.com/abc.png")).toBeNull();
    expect(sameOriginAccountImage("//img.clerk.com/abc.png")).toBeNull();
    expect(sameOriginAccountImage("javascript:alert(1)")).toBeNull();
    // URL parsing folds a backslash into a slash: `/\host` resolves to `//host`.
    expect(sameOriginAccountImage("/\\img.clerk.com/abc.png")).toBeNull();
    expect(sameOriginAccountImage("\\\\img.clerk.com/abc.png")).toBeNull();
    // It deletes tabs and newlines outright, rejoining the slashes around them.
    expect(sameOriginAccountImage("/\t/img.clerk.com/abc.png")).toBeNull();
    expect(sameOriginAccountImage("/\n/img.clerk.com/abc.png")).toBeNull();
    expect(sameOriginAccountImage("/\r/img.clerk.com/abc.png")).toBeNull();
    expect(sameOriginAccountImage("/\t\\img.clerk.com/abc.png")).toBeNull();
  });
});
