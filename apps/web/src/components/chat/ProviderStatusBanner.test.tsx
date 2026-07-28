import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  getProviderStatusBannerKey,
  ProviderStatusBanner,
  shouldShowProviderStatusBanner,
} from "./ProviderStatusBanner";

function warningProvider(): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    displayName: "Codex",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "warning",
    auth: { status: "authenticated" },
    checkedAt: "2026-07-23T12:00:00.000Z",
    message: "Provider is temporarily degraded.",
    models: [],
    slashCommands: [],
    skills: [],
  };
}

describe("ProviderStatusBanner", () => {
  it("does not show a global banner for non-actionable provider warnings", () => {
    const status = warningProvider();

    expect(getProviderStatusBannerKey(status)).toBeNull();
    expect(shouldShowProviderStatusBanner(status, null)).toBe(false);
  });

  it("does not render non-actionable provider errors", () => {
    const markup = renderToStaticMarkup(
      <ProviderStatusBanner
        status={{ ...warningProvider(), status: "error", auth: { status: "unknown" } }}
        onDismiss={() => {}}
      />,
    );

    expect(markup).toBe("");
  });

  it("renders an accessible dismiss control for explicit authentication errors", () => {
    const markup = renderToStaticMarkup(
      <ProviderStatusBanner
        status={{ ...warningProvider(), status: "error", auth: { status: "unauthenticated" } }}
        onDismiss={() => {}}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-label="Dismiss Codex provider error"');
    expect(markup).toContain("absolute top-2 right-2");
    expect(markup).toContain("alert-glass");
  });

  it("renders missing providers as actionable errors", () => {
    const markup = renderToStaticMarkup(
      <ProviderStatusBanner
        status={{
          ...warningProvider(),
          status: "error",
          installed: false,
          auth: { status: "unknown" },
        }}
        onDismiss={() => {}}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-label="Dismiss Codex provider error"');
  });
});
