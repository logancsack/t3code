// Opening the app connects every thread; Aldo's database has few connection
// slots, so only a few connect requests may be out at once (directory.ts).
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
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

/**
 * Aldo, stubbed: every ask is held until the test answers it, and the test
 * waits for asks to arrive, not for time.
 */
const aldoStub = Effect.gen(function* () {
  vi.stubEnv("VITE_ALDO_CLOUD", "1");
  vi.stubGlobal("window", { location: { assign: vi.fn(), href: "https://aldo.test/" } });

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
    await new Promise<void>((resolve) =>
      answers.push(() => {
        waiting -= 1;
        resolve();
      }),
    );
    return Response.json({ state: "stopped" });
  });
  vi.stubGlobal("fetch", fetch);
  // One page: no other tab shares its reads (directory.shared.test.ts).
  vi.stubGlobal("BroadcastChannel", undefined);

  const { aldoEnvironmentGateway } = yield* Effect.promise(() => import("./directory"));
  const prepare = (index: number) =>
    aldoEnvironmentGateway
      .prepare({ connectionId: `aldo:t${index}`, environmentId: `aldo-t${index}` as never })
      .pipe(Effect.ignore);
  return { answers, fetch, prepare, untilAsked, most: () => most };
});

it.live("asks Aldo to connect only a few threads at a time, and all of them in the end", () =>
  Effect.gen(function* () {
    const threads = 30;
    const aldo = yield* aldoStub;
    const connects = yield* Effect.forEach(
      Array.from({ length: threads }, (_, index) => index),
      (index) => Effect.forkChild(aldo.prepare(index)),
    );

    yield* Effect.promise(() => aldo.untilAsked(8));
    expect(aldo.fetch).toHaveBeenCalledTimes(8);

    // Answer what's out; the next ones are asked as these finish.
    let answered = 0;
    while (answered < threads) {
      const batch = aldo.answers.splice(0);
      batch.forEach((answer) => answer());
      answered += batch.length;
      if (answered < threads) {
        yield* Effect.promise(() => aldo.untilAsked(Math.min(threads, answered + 8)));
      }
    }

    yield* Fiber.joinAll(connects);
    expect(aldo.fetch).toHaveBeenCalledTimes(threads);
    expect(aldo.most()).toBe(8);
  }),
);

it.live("an ask an attempt gave up on keeps its place until Aldo answers it", () =>
  Effect.gen(function* () {
    const aldo = yield* aldoStub;
    const attempts = yield* Effect.forEach(
      Array.from({ length: 9 }, (_, index) => index),
      (index) => Effect.forkChild(aldo.prepare(index)),
    );

    yield* Effect.promise(() => aldo.untilAsked(8));
    // The supervisor gives up on the first one after 15 s; its request is still out.
    yield* Fiber.interrupt(attempts[0]!);
    // Let the ninth take the place if the interruption freed it.
    yield* Effect.yieldNow.pipe(Effect.repeat({ times: 20 }));
    expect(aldo.fetch).toHaveBeenCalledTimes(8);

    // Aldo answers that request, and now the ninth is asked.
    aldo.answers[0]!();
    yield* Effect.promise(() => aldo.untilAsked(9));
    expect(aldo.most()).toBe(8);

    aldo.answers.splice(0).forEach((answer) => answer());
    yield* Fiber.joinAll(attempts.slice(1));
    expect(aldo.fetch).toHaveBeenCalledTimes(9);
  }),
);
