import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("./cloud", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cloud")>()),
  isAldoCloud: true,
}));

/** Runs a route's beforeLoad and returns where it redirects to, if anywhere. */
async function redirectOf(route: { options: { beforeLoad?: unknown } }): Promise<string | null> {
  const beforeLoad = route.options.beforeLoad as (input: unknown) => unknown;
  try {
    await beforeLoad({ context: { authGateState: { status: "hosted-static" } } });
    return null;
  } catch (error) {
    if (!isRedirect(error)) throw error;
    return String(error.options.to);
  }
}

describe("routes Aldo replaces", () => {
  it("sends /welcome home, since Aldo sets up each machine's agents", async () => {
    const { Route } = await import("../routes/welcome");
    expect(await redirectOf(Route)).toBe("/");
  });

  it("sends Connections to General, since Aldo connects to its machines itself", async () => {
    const { Route } = await import("../routes/settings.connections");
    expect(await redirectOf(Route)).toBe("/settings/general");
  });
});
