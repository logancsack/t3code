// Opening the app connects every thread; Aldo's database has few connection
// slots, so only a few connect requests may be out at once (directory.ts).
import * as Effect from "effect/Effect";
import { it } from "@effect/vitest";
import { afterEach, expect, vi } from "vite-plus/test";

vi.mock("@t3tools/client-runtime/state/runtime", () => ({ runAtomCommand: vi.fn() }));
vi.mock("../connection/catalog", () => ({ environmentCatalog: { retryNow: "retry" } }));
vi.mock("../rpc/atomRegistry", () => ({ appAtomRegistry: { get: () => new Map() } }));
vi.mock("../state/presentation", () => ({
  environmentPresentations: { presentationsAtom: "presentations" },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

const THREADS = 30;

it.live("asks Aldo to connect only a few threads at a time, and all of them in the end", () =>
  Effect.gen(function* () {
    vi.stubEnv("VITE_ALDO_CLOUD", "1");
    vi.stubGlobal("window", { location: { assign: vi.fn(), href: "https://aldo.test/" } });

    // Every ask is held until the test answers it; the test waits for asks, not for time.
    const answers: Array<() => void> = [];
    const watchers: Array<{ asks: number; wake: () => void }> = [];
    let asks = 0;
    let waiting = 0;
    let most = 0;
    const untilAsked = (count: number) =>
      new Promise<void>((resolve) => {
        if (asks >= count) resolve();
        else watchers.push({ asks: count, wake: resolve });
      });
    const fetch = vi.fn(async () => {
      asks += 1;
      waiting += 1;
      most = Math.max(most, waiting);
      for (const watcher of watchers.filter((entry) => asks >= entry.asks)) watcher.wake();
      await new Promise<void>((resolve) => answers.push(resolve));
      waiting -= 1;
      return Response.json({ state: "stopped" });
    });
    vi.stubGlobal("fetch", fetch);

    const { aldoEnvironmentGateway } = yield* Effect.promise(() => import("./directory"));
    const connects = Array.from({ length: THREADS }, (_, index) =>
      aldoEnvironmentGateway
        .prepare({ connectionId: `aldo:t${index}`, environmentId: `aldo-t${index}` as never })
        .pipe(Effect.ignore, Effect.runPromise),
    );

    yield* Effect.promise(() => untilAsked(8));
    expect(fetch).toHaveBeenCalledTimes(8);

    // Answer what's out; the next ones are asked as these finish.
    let answered = 0;
    while (answered < THREADS) {
      const batch = answers.splice(0);
      batch.forEach((answer) => answer());
      answered += batch.length;
      if (answered < THREADS)
        yield* Effect.promise(() => untilAsked(Math.min(THREADS, answered + 8)));
    }

    yield* Effect.promise(() => Promise.all(connects));
    expect(fetch).toHaveBeenCalledTimes(THREADS);
    expect(most).toBe(8);
  }),
);
