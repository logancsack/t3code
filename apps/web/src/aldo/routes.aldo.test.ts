import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("./cloud", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cloud")>()),
  isAldoCloud: true,
}));

/** Runs a route's beforeLoad and returns where it redirects to, if anywhere. */
async function redirectOf(
  route: { options: { beforeLoad?: unknown } },
  location: { pathname: string; searchStr?: string; hash?: string } = { pathname: "/" },
): Promise<string | null> {
  const beforeLoad = route.options.beforeLoad as ((input: unknown) => unknown) | undefined;
  if (!beforeLoad) return null;
  try {
    await beforeLoad({
      context: { authGateState: { status: "hosted-static" } },
      location: { searchStr: "", hash: "", ...location },
    });
    return null;
  } catch (error) {
    if (!isRedirect(error)) throw error;
    return String(error.options.href ?? error.options.to);
  }
}

describe("routes Aldo replaces", () => {
  it("sends /welcome home, since Aldo sets up each machine's agents", async () => {
    const { Route } = await import("../routes/welcome");
    expect(await redirectOf(Route)).toBe("/");
  });

  it("keeps Connections, where Aldo lists the user's accounts and apps", async () => {
    const { Route } = await import("../routes/settings.connections");
    expect(await redirectOf(Route, { pathname: "/settings/connections" })).toBeNull();
    const general = await import("../routes/settings.general");
    expect(await redirectOf(general.Route, { pathname: "/settings/general" })).toBeNull();
  });

  it("opens Settings on Agents", async () => {
    const { Route } = await import("../routes/settings");
    expect(await redirectOf(Route, { pathname: "/settings" })).toBe("/settings/agents");
  });

  it("sends a sign-in's return to Integrations on to Connections, with its result", async () => {
    const { Route } = await import("../routes/settings.integrations");
    expect(
      await redirectOf(Route, {
        pathname: "/settings/integrations",
        searchStr: "?integration=google&status=connected",
      }),
    ).toBe("/settings/connections?integration=google&status=connected");
    expect(
      await redirectOf(Route, { pathname: "/settings/integrations", hash: "aldo-agent-inbox" }),
    ).toBe("/settings/agents#aldo-agent-inbox");
    expect(
      await redirectOf(Route, {
        pathname: "/settings/integrations",
        hash: "aldo-integration-link",
      }),
    ).toBe("/settings/connections#aldo-integration-link");
    expect(
      await redirectOf(Route, { pathname: "/settings/integrations/", hash: "aldo-phone" }),
    ).toBe("/settings/phone");
  });

  it("sends the old pages to where they are now", async () => {
    const providers = await import("../routes/settings.providers");
    expect(await redirectOf(providers.Route, { pathname: "/settings/providers" })).toBe(
      "/settings/agents",
    );
    const sourceControl = await import("../routes/settings.source-control");
    expect(await redirectOf(sourceControl.Route, { pathname: "/settings/source-control" })).toBe(
      "/settings/connections",
    );
    const environments = await import("../routes/settings.environments");
    expect(await redirectOf(environments.Route, { pathname: "/settings/environments" })).toBe(
      "/settings/code",
    );
    expect(
      await redirectOf(environments.Route, {
        pathname: "/settings/environments",
        hash: "aldo-environments",
      }),
    ).toBe("/settings/code#aldo-environments");
    const shared = await import("../routes/settings.shared");
    expect(await redirectOf(shared.Route, { pathname: "/settings/shared" })).toBe("/library");
  });

  it("brings a Stripe checkout back to Account", async () => {
    const { Route } = await import("../routes/usage");
    expect(await redirectOf(Route, { pathname: "/usage", searchStr: "?checkout=done" })).toBe(
      "/settings/account?checkout=done",
    );
    expect(await redirectOf(Route, { pathname: "/usage" })).toBeNull();
  });
});
