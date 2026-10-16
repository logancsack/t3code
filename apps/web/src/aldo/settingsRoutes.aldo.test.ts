import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  isAldoCloud: true,
}));

/** Runs a route's beforeLoad, if it has one, and returns where it redirects to. */
async function redirectOf(route: { options: { beforeLoad?: unknown } }): Promise<string | null> {
  const beforeLoad = route.options.beforeLoad as ((input: unknown) => unknown) | undefined;
  try {
    await beforeLoad?.({});
    return null;
  } catch (error) {
    if (!isRedirect(error)) throw error;
    return String(error.options.to);
  }
}

describe("settings pages Aldo hides", () => {
  it("sends SnapShots, Storage and Diagnostics to General", async () => {
    const routes = await Promise.all([
      import("../routes/settings.snap-shot"),
      import("../routes/settings.storage"),
      import("../routes/settings.diagnostics"),
    ]);
    for (const { Route } of routes) {
      expect(await redirectOf(Route)).toBe("/settings/general");
    }
  });

  it("keeps the open source licenses", async () => {
    const { Route } = await import("../routes/settings.open-source-licenses");
    expect(await redirectOf(Route)).toBeNull();
  });
});
