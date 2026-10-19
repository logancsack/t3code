import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { it } from "@effect/vitest";
import { afterEach, expect, vi } from "vite-plus/test";

const connection = vi.hoisted(() => ({ phase: "available", retry: vi.fn() }));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  runAtomCommand: (...args: unknown[]) => connection.retry(...args),
}));
vi.mock("../connection/catalog", () => ({ environmentCatalog: { retryNow: "retry" } }));
vi.mock("../rpc/atomRegistry", () => ({
  appAtomRegistry: {
    get: () => new Map([["aldo-t", { connection: { phase: connection.phase } }]]),
  },
}));
vi.mock("../state/presentation", () => ({
  environmentPresentations: { presentationsAtom: "presentations" },
}));

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

const directory = Effect.gen(function* () {
  vi.useFakeTimers();
  vi.stubEnv("VITE_ALDO_CLOUD", "1");
  const page = { visibilityState: "visible" };
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  const environment = {
    environmentId: "aldo-t",
    threadId: "t",
    label: "Thread",
    repo: "",
    branch: "aldo/t",
    state: "ready",
  };
  const fetch = vi.fn(async () => Response.json({ environments: [environment] }));
  vi.stubGlobal("fetch", fetch);
  // One page: no other tab shares its reads (directory.shared.test.ts).
  vi.stubGlobal("BroadcastChannel", undefined);
  const api = yield* Effect.promise(() => import("./directory"));
  const emissions: unknown[] = [];
  yield* Stream.runForEach(api.aldoPlatformRegistrations(), (value) =>
    Effect.sync(() => {
      emissions.push(value);
    }),
  ).pipe(Effect.forkScoped);
  yield* Effect.promise(() => vi.advanceTimersByTimeAsync(251));
  return { api, page, fetch, emissions, environment };
});

it.live(
  "pauses routine refreshes in hidden tabs, resumes promptly, and keeps explicit refreshes",
  () =>
    Effect.gen(function* () {
      const { api, page, fetch } = yield* directory;
      expect(fetch).toHaveBeenCalledTimes(1);
      page.visibilityState = "hidden";
      yield* Effect.promise(() => vi.advanceTimersByTimeAsync(60_000));
      expect(fetch).toHaveBeenCalledTimes(1);
      api.requestAldoDirectoryRefresh();
      yield* Effect.promise(() => vi.advanceTimersByTimeAsync(250));
      expect(fetch).toHaveBeenCalledTimes(2);
      page.visibilityState = "visible";
      yield* Effect.promise(() => vi.advanceTimersByTimeAsync(250));
      expect(fetch).toHaveBeenCalledTimes(3);
    }),
);

it.live("keeps the last directory and backs off failed reads without hidden retries", () =>
  Effect.gen(function* () {
    const { api, page, fetch } = yield* directory;
    const cached = api.getAldoEnvironments();
    fetch.mockRejectedValue(new Error("offline"));
    api.requestAldoDirectoryRefresh();
    yield* Effect.promise(() => vi.advanceTimersByTimeAsync(250));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(api.getAldoEnvironments()).toBe(cached);
    page.visibilityState = "hidden";
    yield* Effect.promise(() => vi.advanceTimersByTimeAsync(60_000));
    expect(fetch).toHaveBeenCalledTimes(2);
    page.visibilityState = "visible";
    yield* Effect.promise(() => vi.advanceTimersByTimeAsync(250));
    expect(fetch).toHaveBeenCalledTimes(3);
  }),
);

it.live("notifies subscribers only when directory data or capabilities change", () =>
  Effect.gen(function* () {
    const { api, fetch, environment } = yield* directory;
    const listener = vi.fn();
    const unsubscribe = api.subscribeAldoEnvironments(listener);
    const cached = api.getAldoEnvironments();
    yield* Effect.promise(() => vi.advanceTimersByTimeAsync(16_000));
    expect(api.getAldoEnvironments()).toBe(cached);
    expect(listener).not.toHaveBeenCalled();
    fetch.mockImplementation(async () =>
      Response.json({
        environments: [{ ...environment, label: "Renamed" }],
        features: { projects: true },
      }),
    );
    api.requestAldoDirectoryRefresh();
    yield* Effect.promise(() => vi.advanceTimersByTimeAsync(250));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(api.getAldoEnvironments()?.[0]?.label).toBe("Renamed");
    expect(api.aldoSupportsProjects()).toBe(true);
    unsubscribe();
  }),
);

it.live("retries an unchanged ready machine after a reconnect still reports dormant", () =>
  Effect.gen(function* () {
    const { api, page } = yield* directory;
    const cached = api.getAldoEnvironments();
    connection.phase = "available";
    connection.retry.mockReset();
    connection.retry.mockImplementationOnce(async () => {
      connection.phase = "available";
    });
    connection.retry.mockImplementationOnce(async () => {
      connection.phase = "connected";
    });
    const { installAldoReconnect } = yield* Effect.promise(() => import("./reconnect"));
    installAldoReconnect();
    yield* Effect.promise(() => vi.advanceTimersByTimeAsync(16_000));
    expect(connection.retry).toHaveBeenCalledTimes(1);
    expect(connection.phase).toBe("available");
    expect(api.getAldoEnvironments()).toBe(cached);
    yield* Effect.promise(() => vi.advanceTimersByTimeAsync(16_000));
    expect(connection.retry).toHaveBeenCalledTimes(2);
    expect(connection.phase).toBe("connected");
    yield* Effect.promise(() => vi.advanceTimersByTimeAsync(16_000));
    expect(connection.retry).toHaveBeenCalledTimes(2);
    page.visibilityState = "hidden";
    connection.phase = "available";
    yield* Effect.promise(() => vi.advanceTimersByTimeAsync(60_000));
    expect(connection.retry).toHaveBeenCalledTimes(2);
  }),
);

it.live("registers machines without waiting for other machines' shell downloads", () =>
  Effect.gen(function* () {
    const { api, emissions } = yield* directory;
    const sync = vi.fn(() => new Promise<void>(() => {}));
    api.setAldoDirectorySync(sync);
    api.requestAldoDirectoryRefresh();
    yield* Effect.promise(() => vi.advanceTimersByTimeAsync(250));
    expect(sync).toHaveBeenCalledOnce();
    expect(emissions).toHaveLength(2);
  }),
);
