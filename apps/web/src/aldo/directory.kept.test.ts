import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { it } from "@effect/vitest";
import { afterEach, expect, vi } from "vite-plus/test";

// The listing this device kept (directory.ts keepListing): the sidebar draws
// from it as the page opens, only for whoever it was kept for, until Aldo's
// read answers.
vi.mock("@t3tools/client-runtime/state/runtime", () => ({ runAtomCommand: vi.fn() }));
vi.mock("../connection/catalog", () => ({ environmentCatalog: { retryNow: "retry" } }));
vi.mock("../rpc/atomRegistry", () => ({ appAtomRegistry: { get: () => new Map() } }));
vi.mock("../state/presentation", () => ({
  environmentPresentations: { presentationsAtom: "presentations" },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

const ME = "a".repeat(32);
const machine = (id: string, state = "stopped") => ({
  environmentId: `aldo-${id}`,
  threadId: id,
  label: `Thread ${id}`,
  repo: "",
  branch: `aldo/${id}`,
  state,
});

const KEY = "aldo-directory-copy";
/** What the device keeps, as it's stored. */
const keptCopy = (stored: Map<string, string>) =>
  JSON.parse(stored.get(KEY)!) as { who: string; listing: [unknown[], unknown] };
/** A device keeping one machine's listing, for `who`, kept `age` ago. */
const keptBy = (who: string, age = 0) =>
  new Map([[KEY, JSON.stringify({ who, at: Date.now() - age, listing: [[machine("a")], {}] })]]);

/** A page opening on a device that keeps `stored`, signed in as `who`, with Aldo's read held until `answer`. */
const opening = (stored: Map<string, string>, who: string | null) =>
  Effect.gen(function* () {
    vi.useFakeTimers();
    vi.stubEnv("VITE_ALDO_CLOUD", "1");
    vi.stubGlobal("document", {
      visibilityState: "visible",
      cookie: who ? `aldo-who=${who}` : "",
    });
    vi.stubGlobal("window", { setTimeout, clearTimeout, location: { href: "https://aldo.test/" } });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    });
    vi.stubGlobal("BroadcastChannel", undefined);
    let answer: (response: Response) => void = () => {};
    const fetch = vi.fn(() => new Promise<Response>((resolve) => (answer = resolve)));
    vi.stubGlobal("fetch", fetch);
    const api = yield* Effect.promise(() => import("./directory"));
    api.startAldoDirectory();
    const emissions: Array<ReadonlyArray<{ readonly target: { readonly environmentId: string } }>> =
      [];
    yield* Stream.runForEach(api.aldoPlatformRegistrations(), (value) =>
      Effect.sync(() => {
        emissions.push(value as never);
      }),
    ).pipe(Effect.forkScoped);
    yield* Effect.promise(() => vi.advanceTimersByTimeAsync(251));
    const ids = () => emissions.map((each) => each.map((r) => r.target.environmentId));
    const respond = (response: Response) =>
      Effect.promise(async () => {
        answer(response);
        await vi.advanceTimersByTimeAsync(251);
      });
    return { api, fetch, ids, respond };
  });

it.live(
  "the sidebar draws from the listing kept here before Aldo's read answers, then from the read",
  () =>
    Effect.gen(function* () {
      const stored = new Map<string, string>();
      const first = yield* opening(stored, ME);
      expect(first.api.getAldoEnvironments()).toBeNull();
      yield* first.respond(
        Response.json({ environments: [machine("a"), machine("b")], features: { general: true } }),
      );
      expect(first.ids()).toEqual([["aldo-a", "aldo-b"]]);
      expect(keptCopy(stored)).toMatchObject({ who: ME });

      vi.resetModules();
      const next = yield* opening(stored, ME);
      // Before the read: the kept machines, registered, and what that Aldo could do.
      expect(next.api.getAldoEnvironments()?.map((e) => e.environmentId)).toEqual([
        "aldo-a",
        "aldo-b",
      ]);
      expect(next.api.aldoSupportsGeneralThreads()).toBe(true);
      expect(next.ids()).toEqual([["aldo-a", "aldo-b"]]);
      expect(next.fetch).toHaveBeenCalledTimes(1);
      // The read in: what it lists, kept for the next open.
      yield* next.respond(Response.json({ environments: [machine("b"), machine("c", "ready")] }));
      expect(next.ids()).toEqual([
        ["aldo-a", "aldo-b"],
        ["aldo-b", "aldo-c"],
      ]);
      expect(next.api.aldoSupportsGeneralThreads()).toBe(false);
      expect(keptCopy(stored).listing[0]).toHaveLength(2);
    }),
);

it.live("no one else's listing draws, nor one kept with no one known or a week unchanged", () =>
  Effect.gen(function* () {
    for (const [stored, who] of [
      [keptBy("b".repeat(32)), ME],
      [keptBy(ME), null],
      [keptBy(ME, 8 * 24 * 60 * 60_000), ME],
    ] as const) {
      const page = yield* opening(stored, who);
      expect(page.api.getAldoEnvironments()).toBeNull();
      expect(page.ids()).toEqual([]);
      vi.resetModules();
    }
  }),
);

it.live("signing out leaves no listing kept", () =>
  Effect.gen(function* () {
    const stored = keptBy(ME);
    const page = yield* opening(stored, ME);
    // api.ts sends a 401 to sign in.
    window.location.assign = vi.fn();
    yield* page.respond(new Response(null, { status: 401 }));
    expect(stored.has(KEY)).toBe(false);
  }),
);
