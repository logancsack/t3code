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

  it("renders persistent reconnect guidance for explicit authentication errors", () => {
    const status = {
      ...warningProvider(),
      status: "error" as const,
      auth: { status: "unauthenticated" as const },
      message: "Reconnect Claude to retry the last message automatically.",
    };
    const markup = renderToStaticMarkup(
      <ProviderStatusBanner
        status={status}
        onDismiss={() => {}}
        action={<button type="button">Reconnect Claude</button>}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("alert-glass");
    expect(markup).toContain("Reconnect Claude to retry the last message automatically.");
    expect(markup).toContain("Reconnect Claude</button>");
    expect(markup).not.toContain('aria-label="Dismiss Codex provider error"');
    expect(shouldShowProviderStatusBanner(status, getProviderStatusBannerKey(status))).toBe(true);
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
