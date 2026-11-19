import { afterEach, expect, it, vi } from "vite-plus/test";

vi.mock("../rpc/atomRegistry", () => ({ appAtomRegistry: { get: () => new Map() } }));
vi.mock("../state/presentation", () => ({
  environmentPresentations: { presentationsAtom: "presentations" },
}));
vi.mock("../state/server", () => ({ environmentServerConfigsAtom: "configs" }));
vi.mock("./directory", () => ({ aldoEnvironmentIdFor: (id: string) => `aldo-${id}` }));
vi.mock("./settingsData", () => ({ settingsAccounts: { load: async () => null } }));
vi.mock("./machineSettings", () => ({ loadAldoMachineSettings: async () => ({}) }));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const catalog = (checkedAt: string, ...models: string[]) => ({
  environment: { environmentId: "source" },
  providers: [{ instanceId: "codex", driver: "codex", checkedAt, models }],
});
const initial = catalog("2026-11-19T01:00:00Z", "incumbent");
const updated = catalog("2026-11-19T02:00:00Z", "incumbent", "future");

it("returns a cached template during a slow refresh, then adopts the refreshed models", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ config: initial }));
  vi.stubGlobal("fetch", fetch);
  const { aldoServerConfigFor, newestAldoProviders } = await import("./serverConfig");
  await aldoServerConfigFor("aldo-first");
  vi.setSystemTime(Date.now() + 60_001);

  let finish!: (response: Response) => void;
  fetch.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let returned = false;
  const opening = aldoServerConfigFor("aldo-next").then((config) => {
    returned = true;
    return config;
  });
  try {
    // Drain resolved work while the optional network read remains deliberately pending.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(returned).toBe(true);
    expect((await opening)?.environment.environmentId).toBe("aldo-next");
    expect(await newestAldoProviders()).toEqual(initial.providers);
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    finish(Response.json({ config: updated }));
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(await newestAldoProviders()).toEqual(updated.providers);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("coalesces cold catalog requests", async () => {
  let finish!: (response: Response) => void;
  const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const { aldoServerConfigFor } = await import("./serverConfig");
  const one = aldoServerConfigFor("aldo-one");
  const two = aldoServerConfigFor("aldo-two");
  finish(Response.json({ config: initial }));
  expect((await one)?.providers).toEqual(initial.providers);
  expect((await two)?.providers).toEqual(initial.providers);
  expect(fetch).toHaveBeenCalledOnce();
});

it("keeps the usable catalog after a failed refresh and retries after a minute", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ config: initial }));
  vi.stubGlobal("fetch", fetch);
  const { newestAldoProviders } = await import("./serverConfig");
  await newestAldoProviders();
  vi.setSystemTime(Date.now() + 60_001);
  fetch.mockRejectedValueOnce(new TypeError("offline"));
  expect(await newestAldoProviders()).toEqual(initial.providers);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(await newestAldoProviders()).toEqual(initial.providers);
  expect(fetch).toHaveBeenCalledTimes(2);
  vi.setSystemTime(Date.now() + 60_001);
  fetch.mockResolvedValueOnce(Response.json({ config: updated }));
  await newestAldoProviders();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(await newestAldoProviders()).toEqual(updated.providers);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it.each(["headers", "body"])("bounds a cold catalog request with stalled %s", async (stalled) => {
  vi.useFakeTimers();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
    return controller.signal;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((_path: string, init?: RequestInit) => {
      if (stalled === "headers") {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        });
      }
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
            },
          }),
        ),
      );
    }),
  );
  const { aldoServerConfigFor } = await import("./serverConfig");
  const opening = aldoServerConfigFor("aldo-cold");
  expect(timeout).toHaveBeenCalledWith(10_000);
  await vi.advanceTimersByTimeAsync(10_000);
  await expect(opening).resolves.toBeNull();
});
