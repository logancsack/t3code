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

it.live("asks Aldo to connect only a few threads at a time, and all of them in the end", () =>
  Effect.gen(function* () {
    vi.stubEnv("VITE_ALDO_CLOUD", "1");
    vi.stubGlobal("window", { location: { assign: vi.fn(), href: "https://aldo.test/" } });
    const open: Array<() => void> = [];
    let asking = 0;
    let most = 0;
    let finished = 0;
    const allFinished = () => finished === 30;
    const fetch = vi.fn(async () => {
      most = Math.max(most, ++asking);
      await new Promise<void>((resolve) => open.push(resolve));
      asking--;
      finished++;
      return Response.json({ state: "stopped" });
    });
    vi.stubGlobal("fetch", fetch);
    const { aldoEnvironmentGateway } = yield* Effect.promise(() => import("./directory"));
    const connects = Array.from({ length: 30 }, (_, index) =>
      aldoEnvironmentGateway
        .prepare({ connectionId: `aldo:t${index}`, environmentId: `aldo-t${index}` as never })
        .pipe(Effect.ignore, Effect.runPromise),
    );
    const settle = Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 0)));
    yield* settle;
    expect(fetch).toHaveBeenCalledTimes(8);
    while (!allFinished()) {
      open.splice(0).forEach((resolve) => resolve());
      yield* settle;
    }
    yield* Effect.promise(() => Promise.all(connects));
    expect(fetch).toHaveBeenCalledTimes(30);
    expect(most).toBe(8);
  }),
);
