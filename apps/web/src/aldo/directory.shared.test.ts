// Tabs on screen share their directory reads (directory.ts sharedReads): a
// read one tab makes counts as the others' too, so windows side by side read
// it once each 15 seconds, not once each per window. A hidden tab takes none,
// and none takes a read begun before what it has, or before a change of its own.
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { it } from "@effect/vitest";
import { afterEach, expect, vi } from "vite-plus/test";

vi.mock("@t3tools/client-runtime/state/runtime", () => ({ runAtomCommand: vi.fn() }));
vi.mock("../connection/catalog", () => ({ environmentCatalog: { retryNow: "retry" } }));
vi.mock("../rpc/atomRegistry", () => ({ appAtomRegistry: { get: () => new Map() } }));
vi.mock("../state/presentation", () => ({
  environmentPresentations: { presentationsAtom: "presentations" },
}));

/** This browser's other tabs, as the page's channel sees them: what it posted, and a way to send it theirs. */
class OtherTabs {
  static channels: OtherTabs[] = [];
  readonly posted: unknown[] = [];
  private readonly listeners = new Set<(event: { data: unknown }) => void>();
  constructor(readonly name: string) {
    OtherTabs.channels.push(this);
  }
  addEventListener(_type: "message", listener: (event: { data: unknown }) => void): void {
    this.listeners.add(listener);
  }
  postMessage(data: unknown): void {
    this.posted.push(structuredClone(data));
  }
  send(data: unknown): void {
    for (const listener of this.listeners) listener({ data });
  }
  close(): void {}
}

afterEach(() => {
  OtherTabs.channels = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

const machine = (environmentId: string, label = "Thread") => ({
  environmentId,
  threadId: environmentId.replace(/^aldo-/, ""),
  label,
  repo: "",
  branch: `aldo/${environmentId}`,
  state: "sleeping",
});

const directory = Effect.gen(function* () {
  vi.useFakeTimers();
  vi.stubEnv("VITE_ALDO_CLOUD", "1");
  const page = { visibilityState: "visible" };
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  vi.stubGlobal("BroadcastChannel", OtherTabs);
  const fetch = vi.fn(async () => Response.json({ environments: [machine("aldo-a")] }));
  vi.stubGlobal("fetch", fetch);
  const api = yield* Effect.promise(() => import("./directory"));
  const emissions: Array<ReadonlyArray<unknown>> = [];
  yield* Stream.runForEach(api.aldoPlatformRegistrations(), (value) =>
    Effect.sync(() => {
      emissions.push(value);
    }),
  ).pipe(Effect.forkScoped);
  yield* Effect.promise(() => vi.advanceTimersByTimeAsync(251));
  const [tabs] = OtherTabs.channels;
  return { api, page, fetch, emissions, tabs: tabs! };
});

const wait = (ms: number) => Effect.promise(() => vi.advanceTimersByTimeAsync(ms));
/** The page's clock (faked), as the tabs read it. */
const now = () => Date.now();

it.live("shares each read with the other tabs, with when it began", () =>
  Effect.gen(function* () {
    const { tabs, fetch } = yield* directory;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(tabs.name).toBe("aldo-directory");
    expect(tabs.posted).toEqual([
      { startedAt: expect.any(Number), body: { environments: [machine("aldo-a")] } },
    ]);
  }),
);

it.live("a tab on screen takes another's read as its own, and reads only once that tab stops", () =>
  Effect.gen(function* () {
    const { api, tabs, fetch, emissions } = yield* directory;
    const listener = vi.fn();
    api.subscribeAldoEnvironments(listener);
    const before = emissions.length;
    // Another tab reads every 15 seconds for a minute: this one reads none of its own.
    for (let read = 1; read <= 4; read++) {
      yield* wait(14_000);
      tabs.send({
        startedAt: now(),
        body: { environments: [machine("aldo-a"), machine("aldo-b", `B${read}`)] },
      });
      yield* wait(1_000);
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(api.getAldoEnvironments()?.map((entry) => entry.label)).toEqual(["Thread", "B4"]);
    expect(listener).toHaveBeenCalledTimes(4);
    expect(emissions.length).toBe(before + 4);
    // That tab goes: this one reads once its own clock says so, a little after the other's would have.
    yield* wait(15_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    yield* wait(2_500);
    expect(fetch).toHaveBeenCalledTimes(2);
  }),
);

it.live("a hidden tab takes no one's read, and reads its own once back on screen", () =>
  Effect.gen(function* () {
    const { api, page, tabs, fetch } = yield* directory;
    page.visibilityState = "hidden";
    yield* wait(250);
    tabs.send({ startedAt: now(), body: { environments: [machine("aldo-b")] } });
    expect(api.getAldoEnvironments()?.map((entry) => entry.environmentId)).toEqual(["aldo-a"]);
    page.visibilityState = "visible";
    yield* wait(250);
    expect(fetch).toHaveBeenCalledTimes(2);
  }),
);

it.live("a read begun before this tab's own, or before a machine it added, isn't taken", () =>
  Effect.gen(function* () {
    const { api, tabs, fetch } = yield* directory;
    const ours = (tabs.posted[0] as { startedAt: number }).startedAt;
    tabs.send({ startedAt: ours - 1, body: { environments: [] } });
    expect(api.getAldoEnvironments()?.map((entry) => entry.environmentId)).toEqual(["aldo-a"]);

    yield* wait(1_000);
    const begun = now();
    yield* wait(1_000);
    api.releaseAldoEnvironment("aldo-new", machine("aldo-new") as never);
    // Read before the new machine was made: it would take the machine out again.
    tabs.send({ startedAt: begun, body: { environments: [machine("aldo-a")] } });
    expect(api.getAldoEnvironments()?.map((entry) => entry.environmentId)).toEqual([
      "aldo-new",
      "aldo-a",
    ]);
    // One begun after it is taken.
    yield* wait(1_000);
    tabs.send({
      startedAt: now(),
      body: { environments: [machine("aldo-new"), machine("aldo-a")] },
    });
    expect(api.getAldoEnvironments()?.map((entry) => entry.environmentId)).toEqual([
      "aldo-new",
      "aldo-a",
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  }),
);

it.live("another tab's read while this one's is under way is left to this one's", () =>
  Effect.gen(function* () {
    const { api, tabs, fetch } = yield* directory;
    let answer!: (response: Response) => void;
    fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)));
    api.requestAldoDirectoryRefresh();
    yield* wait(250);
    expect(fetch).toHaveBeenCalledTimes(2);
    tabs.send({ startedAt: now(), body: { environments: [machine("aldo-other")] } });
    answer(Response.json({ environments: [machine("aldo-mine")] }));
    yield* wait(250);
    expect(api.getAldoEnvironments()?.map((entry) => entry.environmentId)).toEqual(["aldo-mine"]);
  }),
);

it.live("tells Aldo how long the first view took with the next read, once", () =>
  Effect.gen(function* () {
    const { api, fetch } = yield* directory;
    const header = (call: number) =>
      new Headers((fetch.mock.calls[call] as unknown as [string, RequestInit])[1].headers).get(
        "x-aldo-first-view",
      );
    expect(header(0)).toBeNull();
    api.noteAldoFirstView(812.4);
    api.requestAldoDirectoryRefresh();
    yield* wait(250);
    expect(header(1)).toBe("812");
    api.requestAldoDirectoryRefresh();
    yield* wait(250);
    expect(header(2)).toBeNull();
  }),
);

it.live("a tab taking another's reads still makes its own once, to tell its first view", () =>
  Effect.gen(function* () {
    const { api, tabs, fetch } = yield* directory;
    api.noteAldoFirstView(640);
    for (let read = 1; read <= 2; read++) {
      yield* wait(10_000);
      tabs.send({ startedAt: now(), body: { environments: [machine("aldo-a")] } });
    }
    // Its own read went on time, with the first view, while it took the other's.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      new Headers((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].headers).get(
        "x-aldo-first-view",
      ),
    ).toBe("640");
    // Then it takes them as its own again.
    for (let read = 1; read <= 3; read++) {
      yield* wait(14_000);
      tabs.send({ startedAt: now(), body: { environments: [machine("aldo-a")] } });
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  }),
);
