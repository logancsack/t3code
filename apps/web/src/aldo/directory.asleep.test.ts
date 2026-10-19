// A sleeping machine's connection is told it's asleep from the directory on
// every attempt, without asking Aldo; Aldo is asked only when the directory
// has the machine up, this tab is waking it or woke it, or something asked to
// check it (directory.ts). Coming back to the tab asked once per sleeping
// thread. A page bringing a machine up wakes it once, or follows Aldo's own
// start of a message it holds rather than waking it too (dispatch.ts).
import type { setOrchestrationCommandDispatchOverride } from "@t3tools/client-runtime/operations";
import {
  CommandId,
  MessageId,
  ModelSelection,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ClientOrchestrationCommand,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { describe, it } from "@effect/vitest";
import { afterEach, expect, vi } from "vite-plus/test";

/** What a machine's connection supervisor is told: try again, the page is back on screen or online, its socket closed. */
type Signal = "retry" | "wakeup" | "closed";

/** This tab's connections (as presented and in the catalog), and what the page does around them. */
const host = vi.hoisted(() => ({
  dispatch: null as NonNullable<
    Parameters<typeof setOrchestrationCommandDispatchOverride>[0]
  > | null,
  phases: new Map<string, string>(),
  attempts: new Map<string, number>(),
  /** Each connection told to try again (reconnect.ts, a nudge from dispatch.ts), in order. */
  retried: [] as string[],
  signal: (_environmentId: string, _signal: "retry" | "wakeup" | "closed"): void => undefined,
  /** Aldo taking a message to hold (threadApi.ts). */
  hold: (_command: { readonly threadId: string }): void => undefined,
  /** The files the next message sends (files.ts), which only Aldo can send it with. */
  files: null as ReadonlyMap<string, Blob> | null,
  toast: vi.fn(),
}));
vi.mock("@t3tools/client-runtime/operations", () => ({
  setOrchestrationCommandDispatchOverride: (dispatch: typeof host.dispatch) => {
    host.dispatch = dispatch;
  },
}));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  runAtomCommand: (_registry: unknown, _command: unknown, environmentId: string) => {
    host.retried.push(environmentId);
    host.signal(environmentId, "retry");
  },
}));
vi.mock("../connection/catalog", () => ({
  environmentCatalog: { retryNow: "retry", stateAtom: (state: string) => ({ state }) },
}));
vi.mock("../state/presentation", () => ({
  environmentPresentations: {
    presentationsAtom: "presentations",
    presentationAtom: (presentation: string) => ({ presentation }),
  },
}));
vi.mock("../rpc/atomRegistry", async () => {
  const { AsyncResult } = await import("effect/unstable/reactivity");
  const presented = (phase: string | undefined) => (phase ? { connection: { phase } } : null);
  return {
    appAtomRegistry: {
      get: (atom: "presentations" | { presentation: string } | { state: string }) => {
        if (atom === "presentations") {
          return new Map([...host.phases].map(([id, phase]) => [id, presented(phase)]));
        }
        if ("presentation" in atom) return presented(host.phases.get(atom.presentation));
        const phase = host.phases.get(atom.state);
        return phase ? AsyncResult.success({ phase }) : AsyncResult.initial();
      },
    },
  };
});
vi.mock("../composerDraftStore", () => ({
  useComposerDraftStore: { getState: () => ({ getComposerDraft: () => null }) },
}));
vi.mock("../components/ui/toast", () => ({ toastManager: { add: host.toast, close: vi.fn() } }));
vi.mock("./threadCommands", () => ({ keepAldoCommand: async () => null }));
vi.mock("./files", () => ({ aldoFilesOf: () => host.files }));
vi.mock("./outbox", () => ({
  outgoing: async () => [],
  keepOutgoing: async () => undefined,
  dropOutgoing: async () => undefined,
}));
vi.mock("./startingThreads", () => ({
  aldoMachineConnected: vi.fn(),
  releaseAldoStartingThreads: vi.fn(),
}));
vi.mock("./threadApi", () => ({
  holdAldoTurn: async (_environmentId: string, command: { readonly threadId: string }) => {
    host.hold(command);
    return "held";
  },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
  host.dispatch = null;
  host.phases.clear();
  host.attempts.clear();
  host.retried = [];
  host.signal = () => undefined;
  host.hold = () => undefined;
  host.files = null;
  host.toast.mockClear();
});

type MachineState = "new" | "ready" | "stopped";
type StartState = "starting" | "queued" | "retrying" | "failed";

/**
 * Aldo, stubbed: the directory lists each machine as it is now, with the
 * starts of messages it holds; a connect says whether it's running (the
 * next `unready` say not, as for a machine whose agent isn't answering yet); a
 * wake brings it up, or is refused with `wakeStatus`. A gated request (`read`,
 * `connect:<id>`, `wake:<id>`) waits until the test opens it.
 */
function stubAldo(machines: Record<string, MachineState>) {
  const states = new Map(Object.entries(machines));
  const starts = new Map<
    string,
    Record<string, { kind: "start" | "message"; state: StartState; detail?: string; at?: string }>
  >();
  const asks = new Map<string, number>();
  const gates = new Map<string, { opened: Promise<void>; open: () => void }>();
  const passGate = (key: string) => gates.get(key)?.opened;
  const aldo = {
    states,
    starts,
    reads: 0,
    /** When each directory read was made. */
    readTimes: [] as number[],
    wakes: 0,
    unready: 0,
    offline: false,
    readsFail: false,
    wakeStatus: 200,
    /** What Aldo says it does (`modelRouting`: it picks a new thread's model). */
    features: {} as Record<string, boolean>,
    asksFor: (threadId: string) => asks.get(threadId) ?? 0,
    allAsks: () => [...asks.values()].reduce((sum, count) => sum + count, 0),
    asked: () => [...asks.keys()].toSorted(),
    clearAsks: () => asks.clear(),
    gate: (key: string) => {
      let open = () => undefined as void;
      const opened = new Promise<void>((resolve) => (open = resolve));
      gates.set(key, { opened, open });
    },
    open: (key: string) => {
      gates.get(key)?.open();
      gates.delete(key);
    },
  };
  const fetch = vi.fn(async (path: string) => {
    // Over the network: an answer comes after what this page has under way runs.
    await new Promise((resolve) => setImmediate(resolve));
    if (aldo.offline) throw new TypeError("Failed to fetch");
    if (path === "/api/environments") {
      aldo.reads += 1;
      aldo.readTimes.push(Date.now());
      await passGate("read");
      if (aldo.offline) throw new TypeError("Failed to fetch");
      if (aldo.readsFail) return Response.json({ error: "Unavailable" }, { status: 503 });
      return Response.json({
        environments: [...states].map(([threadId, state]) => ({
          environmentId: `aldo-${threadId}`,
          threadId,
          label: threadId,
          repo: "",
          branch: `aldo/${threadId}`,
          state,
          ...(starts.has(threadId) ? { starts: starts.get(threadId) } : {}),
        })),
        features: aldo.features,
      });
    }
    const [, threadId = "", action] = /^\/api\/environments\/([^/]+)\/(\w+)$/.exec(path) ?? [];
    if (action === "connect") {
      asks.set(threadId, (asks.get(threadId) ?? 0) + 1);
      await passGate(`connect:${threadId}`);
      const unready = aldo.unready > 0;
      if (unready) aldo.unready -= 1;
      return Response.json(
        states.get(threadId) === "ready" && !unready
          ? {
              state: "running",
              httpBaseUrl: `https://${threadId}.test`,
              wsBaseUrl: `wss://${threadId}.test`,
              bearerToken: "token",
            }
          : { state: "stopped" },
      );
    }
    if (action === "wake") {
      aldo.wakes += 1;
      await passGate(`wake:${threadId}`);
      if (aldo.wakeStatus !== 200) {
        return Response.json({ error: "Too many computers at once." }, { status: aldo.wakeStatus });
      }
      states.set(threadId, "ready");
      starts.delete(threadId);
      return Response.json({ ok: true });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  return { aldo, fetch };
}

/** Lets what's runnable run (fibers resume on setImmediate, which stays real). */
const settle = Effect.promise(async () => {
  for (let round = 0; round < 20; round++) await new Promise((resolve) => setImmediate(resolve));
});

/** Moves the clock on a poll at a time, letting what each wakes run. */
const advance = (ms: number) =>
  Effect.gen(function* () {
    for (let passed = 0; passed < ms; passed += 250) {
      yield* Effect.promise(() => vi.advanceTimersByTimeAsync(Math.min(250, ms - passed)));
      yield* settle;
    }
    if (ms === 0) yield* settle;
  });

const takeOneOf = (queue: Queue.Queue<Signal>, kinds: ReadonlyArray<Signal>) =>
  Effect.gen(function* () {
    for (;;) {
      const next = yield* Queue.take(queue);
      if (kinds.includes(next)) return next;
    }
  });

/** The page with its directory, reconnects and sending as the app runs them, and Aldo behind them. */
const page = (machines: Record<string, MachineState>) =>
  Effect.gen(function* () {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    vi.stubEnv("VITE_ALDO_CLOUD", "1");
    const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
    const navigator = { onLine: true };
    vi.stubGlobal("document", document);
    vi.stubGlobal("navigator", navigator);
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), {
        setTimeout,
        clearTimeout,
        location: { assign: vi.fn(), href: "https://aldo.test/" },
      }),
    );
    const { aldo, fetch } = stubAldo(machines);
    vi.stubGlobal("fetch", fetch);
    const directory = yield* Effect.promise(() => import("./directory"));
    const { installAldoReconnect } = yield* Effect.promise(() => import("./reconnect"));
    const dispatch = yield* Effect.promise(() => import("./dispatch"));
    installAldoReconnect();
    dispatch.installAldoCommandDispatch();
    yield* Stream.runDrain(directory.aldoPlatformRegistrations()).pipe(Effect.forkScoped);

    /**
     * One attempt of a machine's connection: it shows as connecting until the
     * gateway answers, then connected, or waiting to be told to try again
     * ("available") when told it's asleep.
     */
    const attempt = (threadId: string) =>
      Effect.gen(function* () {
        const environmentId = `aldo-${threadId}`;
        host.attempts.set(environmentId, (host.attempts.get(environmentId) ?? 0) + 1);
        host.phases.set(environmentId, "connecting");
        const exit = yield* Effect.exit(
          directory.aldoEnvironmentGateway.prepare({
            connectionId: `aldo:${threadId}`,
            environmentId: environmentId as never,
          }),
        );
        const phase = Exit.isSuccess(exit)
          ? "connected"
          : exit.cause.reasons.some(
                (reason) => Cause.isFailReason(reason) && reason.error.reason === "dormant",
              )
            ? "available"
            : "reconnecting";
        host.phases.set(environmentId, phase);
        return phase;
      });

    /**
     * A machine's connection, as its supervisor runs it: an attempt, which a
     * retry cuts off and starts over; connected, a retry drops it and a closed
     * socket waits to try again; told it's asleep, any signal makes another.
     */
    const supervise = (threadId: string, signals: Queue.Queue<Signal>) =>
      Effect.gen(function* () {
        for (;;) {
          let phase: string | undefined;
          while (phase === undefined) {
            phase = yield* Effect.raceFirst(
              attempt(threadId),
              takeOneOf(signals, ["retry"]).pipe(Effect.as(undefined)),
            );
          }
          if (phase === "connected") {
            const next = yield* takeOneOf(signals, ["retry", "closed"]);
            host.phases.set(`aldo-${threadId}`, "reconnecting");
            if (next === "retry") continue;
          }
          yield* takeOneOf(signals, ["retry", "wakeup", "closed"]);
        }
      });

    const supervisors = new Map<string, Queue.Queue<Signal>>();
    host.signal = (environmentId, signal) => {
      const signals = supervisors.get(environmentId);
      if (signals) Queue.offerUnsafe(signals, signal);
    };

    // The page loads: the directory is read, and every machine's connection tries once.
    yield* advance(250);
    expect(aldo.reads).toBe(1);
    for (const threadId of aldo.states.keys()) {
      const signals = yield* Queue.unbounded<Signal>();
      supervisors.set(`aldo-${threadId}`, signals);
      yield* supervise(threadId, signals).pipe(Effect.forkScoped);
    }
    yield* advance(0);
    const up = [...aldo.states.values()].filter((state) => state === "ready").length;
    expect([...host.phases.values()].filter((phase) => phase === "connected")).toHaveLength(up);
    expect(aldo.allAsks()).toBe(up);
    aldo.clearAsks();
    host.retried = [];
    host.attempts.clear();

    /** Tells these machines' connections something, as their supervisors would be. */
    const signal = (threadIds: ReadonlyArray<string>, kind: Signal) =>
      Effect.gen(function* () {
        for (const threadId of threadIds) host.signal(`aldo-${threadId}`, kind);
        yield* advance(0);
      });
    return { aldo, directory, dispatch, document, navigator, signal };
  });

type Tab = Effect.Success<ReturnType<typeof page>>;

const phase = (threadId: string) => host.phases.get(`aldo-${threadId}`);

describe("the directory answers for sleeping machines", () => {
  const SLEEPING = Array.from({ length: 150 }, (_, index) => `s${index}`);
  const RUNNING = ["r0", "r1", "r2"];

  const fleet = (): Record<string, MachineState> =>
    Object.fromEntries([
      ...SLEEPING.map((id) => [id, "stopped" as const]),
      ...RUNNING.map((id) => [id, "ready" as const]),
    ]);

  /**
   * The tab goes away (a phone's, whose sockets close meanwhile); another
   * device wakes s0, and r2 goes to sleep. Then it's back on screen, which
   * wakes every connection up (each waiting one tries again).
   */
  const awayAndBack = (tab: Tab) =>
    Effect.gen(function* () {
      tab.document.visibilityState = "hidden";
      // Long enough that the listing it has no longer answers for sleeping machines by itself.
      yield* advance(2 * 60_000);
      tab.aldo.states.set("s0", "ready");
      tab.aldo.states.set("r2", "stopped");
      yield* tab.signal(RUNNING, "closed");
      tab.document.visibilityState = "visible";
    });

  /** One ask for each machine up now (s0, woken elsewhere; r0, r1), none for the rest: r2 went to sleep. */
  const expectAsksOnReturn = (tab: Tab) => {
    expect(tab.aldo.asked()).toEqual(["r0", "r1", "s0"]);
    expect(tab.aldo.allAsks()).toBe(3);
    const phases = [...host.phases.values()];
    expect(phases.filter((phase) => phase === "connected")).toHaveLength(3);
    expect(phases.filter((phase) => phase === "available")).toHaveLength(150);
  };

  it.live(
    "the tab back with 150 sleeping machines, the directory read first: one ask per running one",
    () =>
      Effect.gen(function* () {
        const tab = yield* page(fleet());
        yield* awayAndBack(tab);
        const reads = tab.aldo.reads;
        yield* advance(250);
        expect(tab.aldo.reads).toBe(reads + 1);
        // The read has s0 up, and tells its connection to try again (reconnect.ts).
        expect(host.retried).toEqual(["aldo-s0"]);
        expect(phase("s0")).toBe("connected");

        yield* tab.signal([...tab.aldo.states.keys()], "wakeup");
        expectAsksOnReturn(tab);
      }),
  );

  it.live(
    "the tab back with 150 sleeping machines, the wake-ups first: they wait for the read, then one ask per running one",
    () =>
      Effect.gen(function* () {
        const tab = yield* page(fleet());
        yield* awayAndBack(tab);
        const reads = tab.aldo.reads;
        yield* tab.signal([...tab.aldo.states.keys()], "wakeup");
        // Under way before the poll reads the directory: none answered yet, and none asks.
        expect(tab.aldo.reads).toBe(reads);
        expect(tab.aldo.allAsks()).toBe(0);
        expect(phase("s1")).toBe("connecting");

        yield* advance(250);
        expect(tab.aldo.reads).toBe(reads + 1);
        expectAsksOnReturn(tab);
        // Answered from the new listing, so none waits to be told to try again.
        expect(host.retried).toEqual([]);
      }),
  );

  it.live("a machine the directory lists asleep is told so on every attempt, without asking", () =>
    Effect.gen(function* () {
      const tab = yield* page({ s0: "stopped" });
      for (let tries = 0; tries < 5; tries++) yield* tab.signal(["s0"], "retry");
      yield* advance(60_000);
      for (let tries = 0; tries < 5; tries++) yield* tab.signal(["s0"], "wakeup");
      expect(host.attempts.get("aldo-s0")).toBe(10);
      expect(phase("s0")).toBe("available");
      expect(tab.aldo.allAsks()).toBe(0);
    }),
  );

  it.live("the listing turning to ready: one ask, and connected", () =>
    Effect.gen(function* () {
      const tab = yield* page({ s0: "stopped", s1: "stopped" });
      tab.aldo.states.set("s0", "ready");
      tab.directory.requestAldoDirectoryRefresh();
      yield* advance(250);
      expect(host.retried).toEqual(["aldo-s0"]);
      expect(phase("s0")).toBe("connected");
      expect(phase("s1")).toBe("available");
      expect(tab.aldo.asked()).toEqual(["s0"]);
      expect(tab.aldo.asksFor("s0")).toBe(1);
    }),
  );

  it.live(
    "the listing turning to ready just as an attempt is told it's asleep still connects it",
    () =>
      Effect.gen(function* () {
        const tab = yield* page({ s0: "stopped" });
        // Told "asleep" from the listing, but its supervisor hasn't shown it yet: still connecting.
        host.phases.set("aldo-s0", "connecting");
        expect(tab.directory.aldoToldAsleepFromListing("aldo-s0")).toBe(true);
        tab.aldo.states.set("s0", "ready");
        tab.directory.requestAldoDirectoryRefresh();
        yield* advance(250);
        expect(host.retried).toEqual(["aldo-s0"]);
        expect(phase("s0")).toBe("connected");
        expect(tab.aldo.asksFor("s0")).toBe(1);
        expect(tab.directory.aldoToldAsleepFromListing("aldo-s0")).toBe(false);
      }),
  );

  it.live(
    "a read that doesn't come in time leaves the attempt to the listing it has, and the read's retry",
    () =>
      Effect.gen(function* () {
        const tab = yield* page({ s0: "stopped" });
        tab.aldo.states.set("s0", "ready");
        tab.aldo.gate("read");
        tab.directory.requestAldoDirectoryRefresh();
        yield* tab.signal(["s0"], "wakeup");
        yield* advance(250);
        expect(phase("s0")).toBe("connecting");
        // It waits up to 2 seconds for the read.
        yield* advance(2_000);
        expect(phase("s0")).toBe("available");
        expect(tab.aldo.allAsks()).toBe(0);

        tab.aldo.open("read");
        yield* advance(0);
        expect(host.retried).toEqual(["aldo-s0"]);
        expect(phase("s0")).toBe("connected");
        expect(tab.aldo.asksFor("s0")).toBe(1);
      }),
  );

  it.live(
    "while this tab wakes a machine its attempts ask, and once woken its next attempt asks once",
    () =>
      Effect.gen(function* () {
        const tab = yield* page({ s0: "stopped" });
        tab.aldo.gate("wake:s0");
        const wake = tab.directory.wakeAldoEnvironment("aldo-s0");
        yield* tab.signal(["s0"], "retry");
        expect(phase("s0")).toBe("available");
        expect(tab.aldo.asksFor("s0")).toBe(1);

        tab.aldo.open("wake:s0");
        yield* Effect.promise(() => wake);
        tab.aldo.clearAsks();
        // The directory still has it asleep; Aldo answered the wake once it was up.
        expect(tab.directory.aldoMachineIsAsleep("aldo-s0")).toBe(true);
        yield* tab.signal(["s0"], "retry");
        expect(phase("s0")).toBe("connected");
        expect(tab.aldo.asksFor("s0")).toBe(1);
      }),
  );

  it.live("an explicit ask asks until Aldo answers, then the directory does again", () =>
    Effect.gen(function* () {
      const tab = yield* page({ s0: "stopped" });
      tab.directory.askAldoNext("aldo-s0");
      yield* tab.signal(["s0"], "retry");
      expect(phase("s0")).toBe("available");
      expect(tab.aldo.asksFor("s0")).toBe(1);
      yield* tab.signal(["s0"], "retry");
      expect(host.attempts.get("aldo-s0")).toBe(2);
      expect(tab.aldo.asksFor("s0")).toBe(1);
    }),
  );

  it.live("asked again while an ask is out, Aldo's earlier answer doesn't let it go", () =>
    Effect.gen(function* () {
      const tab = yield* page({ s0: "stopped" });
      tab.directory.askAldoNext("aldo-s0");
      tab.aldo.gate("connect:s0");
      yield* tab.signal(["s0"], "retry");
      // Asked for again as that ask is out (a wake from this tab finished, say).
      tab.directory.askAldoNext("aldo-s0");
      tab.aldo.open("connect:s0");
      yield* advance(0);
      expect(phase("s0")).toBe("available");
      tab.aldo.states.set("s0", "ready");
      yield* tab.signal(["s0"], "retry");
      expect(phase("s0")).toBe("connected");
      expect(tab.aldo.asksFor("s0")).toBe(2);
    }),
  );

  it.live("an attempt cut off while it asks: the next one asks Aldo again", () =>
    Effect.gen(function* () {
      const tab = yield* page({ s0: "stopped" });
      yield* Effect.promise(() => tab.directory.wakeAldoEnvironment("aldo-s0"));
      tab.aldo.gate("connect:s0");
      yield* tab.signal(["s0"], "retry");
      expect(tab.aldo.asksFor("s0")).toBe(1);
      // Told to try again before Aldo answers: the supervisor starts over.
      yield* tab.signal(["s0"], "retry");
      tab.aldo.open("connect:s0");
      yield* advance(0);

      // The directory still has it asleep, but the new attempt asks, and connects.
      expect(phase("s0")).toBe("connected");
      expect(host.attempts.get("aldo-s0")).toBe(2);
      expect(tab.aldo.asksFor("s0")).toBe(2);
    }),
  );

  it.live("offline and back online: the directory is read at once, and the attempts go by it", () =>
    Effect.gen(function* () {
      const tab = yield* page({ s0: "stopped", s1: "stopped" });
      tab.navigator.onLine = false;
      tab.aldo.offline = true;
      // Reads fail while offline, and back off.
      yield* advance(40_000);
      tab.aldo.states.set("s0", "ready");
      tab.aldo.offline = false;
      tab.navigator.onLine = true;
      const reads = tab.aldo.reads;

      // Back online, the connections try again.
      yield* tab.signal(["s0", "s1"], "wakeup");
      yield* advance(250);
      expect(tab.aldo.reads).toBe(reads + 1);
      expect(phase("s0")).toBe("connected");
      expect(phase("s1")).toBe("available");
      expect(tab.aldo.asked()).toEqual(["s0"]);
      expect(tab.aldo.asksFor("s0")).toBe(1);
    }),
  );

  it.live(
    "while the directory can't be read, a listing over a minute old doesn't answer for sleeping machines: Aldo does",
    () =>
      Effect.gen(function* () {
        const tab = yield* page({ s0: "stopped", s1: "stopped" });
        tab.aldo.readsFail = true;
        yield* advance(30_000);
        // Half a minute old, the listing still answers.
        yield* tab.signal(["s0", "s1"], "wakeup");
        yield* advance(2_000);
        expect(tab.aldo.allAsks()).toBe(0);

        // Woken elsewhere, a minute after the last read: Aldo is asked, and it connects.
        yield* advance(30_000);
        tab.aldo.states.set("s0", "ready");
        yield* tab.signal(["s0", "s1"], "wakeup");
        yield* advance(2_000);
        expect(phase("s0")).toBe("connected");
        expect(phase("s1")).toBe("available");
        expect(tab.aldo.asksFor("s0")).toBe(1);
        expect(tab.aldo.asksFor("s1")).toBe(1);

        // Read again, the listing answers for s1 once more.
        tab.aldo.readsFail = false;
        yield* advance(16_000);
        yield* tab.signal(["s1"], "wakeup");
        yield* advance(2_000);
        expect(phase("s1")).toBe("available");
        expect(tab.aldo.asksFor("s1")).toBe(1);
      }),
  );
});

describe("bringing a machine up from this page", () => {
  /** A message to a thread, or its first (`first`), which makes the thread. */
  function message(threadId: string, first = false): ClientOrchestrationCommand {
    const modelSelection = ModelSelection.make({
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt",
    });
    return {
      type: "thread.turn.start",
      commandId: CommandId.make(`command-${threadId}`),
      threadId: ThreadId.make(threadId),
      message: {
        messageId: MessageId.make(`message-${threadId}`),
        role: "user",
        text: "Carry on",
        attachments: [],
      },
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      ...(first
        ? {
            bootstrap: {
              createThread: {
                projectId: ProjectId.make("project"),
                title: "Carry on",
                modelSelection,
                runtimeMode: "full-access",
                interactionMode: "default",
                branch: null,
                worktreePath: null,
                createdAt: "2026-10-19T00:00:00.000Z",
              },
            },
          }
        : {}),
      createdAt: "2026-10-19T00:00:00.000Z",
    };
  }

  /** Sends a message to a machine this page isn't connected to: Aldo holds it (dispatch.ts). */
  const send = (threadId: string, first = false) =>
    host.dispatch!({
      environmentId: `aldo-${threadId}`,
      command: message(`t-${threadId}`, first),
      primary: true,
    });

  /** Aldo picks new threads' models from here on, as the next directory read says. */
  const routeModels = (tab: Tab) =>
    Effect.gen(function* () {
      tab.aldo.features.modelRouting = true;
      const read = tab.directory.readAldoDirectory();
      yield* advance(500);
      expect(yield* Effect.promise(() => read)).toBe(true);
      expect(tab.directory.aldoRoutesModels()).toBe(true);
    });

  it.live.each(["new", "stopped"] as const)(
    "a machine brought up from here (a new thread's, preloading, Try again; %s): one wake, then one ask",
    (state) =>
      Effect.gen(function* () {
        const tab = yield* page({ m: state });
        expect(phase("m")).toBe("available");

        const connecting = tab.dispatch.ensureAldoConnected("aldo-m");
        yield* advance(1_000);
        yield* Effect.promise(() => connecting);
        expect(tab.aldo.wakes).toBe(1);
        expect(tab.aldo.asksFor("m")).toBe(1);
        expect(host.attempts.get("aldo-m")).toBe(1);
        expect(phase("m")).toBe("connected");
      }),
  );

  it.live(
    "a message Aldo holds: the page follows Aldo's start without waking, and asks once it's up",
    () =>
      Effect.gen(function* () {
        const tab = yield* page({ s0: "stopped", s1: "stopped" });
        // Aldo's delivery of the message starts the machine; it's up 5 seconds later.
        host.hold = (command) => {
          tab.aldo.starts.set("s0", { [command.threadId]: { kind: "message", state: "starting" } });
          setTimeout(() => {
            tab.aldo.states.set("s0", "ready");
            tab.aldo.starts.delete("s0");
          }, 5_000);
        };
        const reads = tab.aldo.reads;
        const sent = send("s0");
        yield* advance(4_500);
        // A read every 2 seconds meanwhile, and nothing asked of Aldo.
        expect(tab.aldo.reads - reads).toBeLessThanOrEqual(3);
        expect(tab.aldo.wakes).toBe(0);
        expect(tab.aldo.allAsks()).toBe(0);

        yield* advance(3_000);
        expect(yield* Effect.promise(() => sent)).toBeNull();
        expect(tab.aldo.wakes).toBe(0);
        expect(tab.aldo.asksFor("s0")).toBe(1);
        expect(tab.aldo.allAsks()).toBe(1);
        expect(host.attempts.get("aldo-s0")).toBe(1);
        expect(phase("s0")).toBe("connected");
        expect(phase("s1")).toBe("available");
      }),
  );

  it.live.each([
    { why: "an older Aldo, which doesn't say how its start stands", start: undefined },
    { why: "a start waiting to try again", start: "retrying" as const },
  ])("a message Aldo holds, $why: the page wakes the machine, and asks once", ({ start }) =>
    Effect.gen(function* () {
      const tab = yield* page({ s0: "stopped" });
      host.hold = (command) => {
        if (start) {
          tab.aldo.starts.set("s0", { [command.threadId]: { kind: "message", state: start } });
        }
      };
      const sent = send("s0");
      yield* advance(1_500);
      expect(yield* Effect.promise(() => sent)).toBeNull();
      expect(tab.aldo.wakes).toBe(1);
      expect(tab.aldo.asksFor("s0")).toBe(1);
      expect(phase("s0")).toBe("connected");
    }),
  );

  it.live(
    "a message Aldo holds whose start fails on the way: the page wakes the machine then",
    () =>
      Effect.gen(function* () {
        const tab = yield* page({ s0: "stopped" });
        host.hold = (command) => {
          tab.aldo.starts.set("s0", { [command.threadId]: { kind: "message", state: "starting" } });
          setTimeout(
            () =>
              tab.aldo.starts.set("s0", {
                [command.threadId]: { kind: "message", state: "retrying" },
              }),
            3_000,
          );
        };
        const sent = send("s0");
        yield* advance(2_500);
        expect(tab.aldo.wakes).toBe(0);
        yield* advance(3_000);
        expect(yield* Effect.promise(() => sent)).toBeNull();
        expect(tab.aldo.wakes).toBe(1);
        expect(tab.aldo.asksFor("s0")).toBe(1);
        expect(phase("s0")).toBe("connected");
      }),
  );

  it.live(
    "a message Aldo holds while the directory can't be read: the page wakes the machine",
    () =>
      Effect.gen(function* () {
        const tab = yield* page({ s0: "stopped" });
        host.hold = (command) => {
          tab.aldo.starts.set("s0", { [command.threadId]: { kind: "message", state: "starting" } });
          tab.aldo.readsFail = true;
        };
        const sent = send("s0");
        yield* advance(1_500);
        expect(yield* Effect.promise(() => sent)).toBeNull();
        expect(tab.aldo.wakes).toBe(1);
        expect(tab.aldo.asksFor("s0")).toBe(1);
        expect(phase("s0")).toBe("connected");
      }),
  );

  it.live(
    "a message Aldo holds while no directory read comes: the page wakes the machine after 15 seconds",
    () =>
      Effect.gen(function* () {
        const tab = yield* page({ s0: "stopped" });
        host.hold = (command) => {
          tab.aldo.starts.set("s0", { [command.threadId]: { kind: "message", state: "starting" } });
          tab.aldo.gate("read");
        };
        const sent = send("s0");
        yield* advance(14_500);
        expect(tab.aldo.wakes).toBe(0);
        yield* advance(1_500);
        expect(yield* Effect.promise(() => sent)).toBeNull();
        expect(tab.aldo.wakes).toBe(1);
        expect(tab.aldo.asksFor("s0")).toBe(1);
        expect(phase("s0")).toBe("connected");
        tab.aldo.open("read");
      }),
  );

  it.live(
    "a held message waiting for room: the page stops waiting, then follows the machine without asking until it's up",
    () =>
      Effect.gen(function* () {
        const tab = yield* page({ s0: "stopped" });
        tab.aldo.wakeStatus = 409;
        host.hold = (command) => {
          tab.aldo.starts.set("s0", { [command.threadId]: { kind: "message", state: "queued" } });
        };
        const sent = send("s0");
        yield* advance(1_000);
        // The wake shows why it waits, and Aldo sends the message when there's room.
        expect(yield* Effect.promise(() => sent)).toEqual({ sequence: 0 });
        expect(tab.aldo.wakes).toBe(1);
        expect(host.toast).toHaveBeenCalledOnce();

        // Its connection is told to try again every 8 seconds, and is told it's asleep from the directory.
        const attempts = host.attempts.get("aldo-s0") ?? 0;
        yield* advance(60_000);
        expect((host.attempts.get("aldo-s0") ?? 0) - attempts).toBeGreaterThanOrEqual(7);
        expect(phase("s0")).toBe("available");
        expect(tab.aldo.allAsks()).toBe(0);

        // Aldo brings it up once there's room.
        tab.aldo.states.set("s0", "ready");
        tab.aldo.starts.delete("s0");
        yield* advance(16_000);
        expect(phase("s0")).toBe("connected");
        expect(tab.aldo.asksFor("s0")).toBe(1);
        expect(tab.aldo.wakes).toBe(1);
      }),
  );

  it.live(
    "bringing a machine up whose agent doesn't answer at first: the next nudge asks Aldo again, though the directory still has it asleep",
    () =>
      Effect.gen(function* () {
        const tab = yield* page({ m: "stopped" });
        // No new listing comes meanwhile, and the first ask after the wake finds it not answering yet.
        tab.aldo.gate("read");
        tab.aldo.unready = 1;
        const connecting = tab.dispatch.ensureAldoConnected("aldo-m");
        yield* advance(1_000);
        expect(tab.aldo.wakes).toBe(1);
        expect(tab.aldo.asksFor("m")).toBe(1);
        expect(phase("m")).toBe("available");

        yield* advance(8_000);
        expect(tab.aldo.asksFor("m")).toBe(2);
        expect(phase("m")).toBe("connected");
        yield* Effect.promise(() => connecting);
        tab.aldo.open("read");
      }),
  );

  it.live(
    "a message Aldo holds that's up before Aldo has sent it: the page waits for Aldo's delivery, then goes on",
    () =>
      Effect.gen(function* () {
        const tab = yield* page({ s0: "stopped" });
        // Up at 5 seconds, and Aldo sends the message (its settings on the machine first) at 9.
        host.hold = (command) => {
          tab.aldo.starts.set("s0", {
            [command.threadId]: { kind: "message", state: "starting" },
          });
          setTimeout(() => tab.aldo.states.set("s0", "ready"), 5_000);
          setTimeout(() => tab.aldo.starts.delete("s0"), 9_000);
        };
        let sent = false;
        const sending = send("s0").then((result) => {
          sent = true;
          return result;
        });
        yield* advance(8_500);
        expect(sent).toBe(false);
        expect(tab.aldo.wakes).toBe(0);

        yield* advance(4_000);
        expect(sent).toBe(true);
        expect(yield* Effect.promise(() => sending)).toBeNull();
        expect(tab.aldo.wakes).toBe(0);
        expect(tab.aldo.asksFor("s0")).toBe(1);
        expect(phase("s0")).toBe("connected");
      }),
  );

  it.live(
    "a long start Aldo holds: the page reads every 2 seconds, then less often, and wakes the machine after 2.5 minutes",
    () =>
      Effect.gen(function* () {
        const tab = yield* page({ s0: "stopped" });
        // Aldo's delivery stalls: the message stays on its way.
        let heldAt = 0;
        host.hold = (command) => {
          heldAt = Date.now();
          tab.aldo.starts.set("s0", {
            [command.threadId]: {
              kind: "message",
              state: "starting",
              at: new Date(heldAt).toISOString(),
            },
          });
        };
        const reads = tab.aldo.readTimes.length;
        const sent = send("s0");
        yield* advance(145_000);
        expect(tab.aldo.wakes).toBe(0);
        const gaps = tab.aldo.readTimes
          .slice(reads)
          .map((at, index, all) => at - (all[index - 1] ?? heldAt));
        // About every 2 seconds for the first 20, then growing to every 10.
        expect(gaps.slice(1, 9).every((gap) => gap >= 2_000 && gap <= 2_500)).toBe(true);
        expect(Math.max(...gaps)).toBeLessThanOrEqual(10_500);
        expect(gaps.slice(-3).every((gap) => gap >= 9_750)).toBe(true);
        expect(gaps.length).toBeLessThanOrEqual(28);

        yield* advance(10_000);
        expect(tab.aldo.wakes).toBe(1);
        expect(yield* Effect.promise(() => sent)).toBeNull();
        expect(tab.aldo.asksFor("s0")).toBe(1);
        expect(phase("s0")).toBe("connected");
      }),
  );

  it.live(
    "a message Aldo has had on its way for 2.5 minutes already: the page wakes the machine at once",
    () =>
      Effect.gen(function* () {
        const tab = yield* page({ s0: "stopped" });
        host.hold = (command) => {
          tab.aldo.starts.set("s0", {
            [command.threadId]: {
              kind: "message",
              state: "starting",
              at: new Date(Date.now() - 150_000).toISOString(),
            },
          });
        };
        const sent = send("s0");
        yield* advance(1_500);
        expect(tab.aldo.wakes).toBe(1);
        expect(tab.aldo.asksFor("s0")).toBe(1);
        expect(yield* Effect.promise(() => sent)).toBeNull();
      }),
  );

  it.live.each([
    { what: "with files", first: false, files: true },
    { what: "a new thread's first, whose model Aldo picks", first: true, files: false },
  ])(
    "a message only Aldo can send ($what) that Aldo gave up on: the page says why, without waking the machine",
    ({ first, files }) =>
      Effect.gen(function* () {
        const tab = yield* page({ s0: "stopped" });
        if (first) yield* routeModels(tab);
        if (files) host.files = new Map([["file-1", new Blob(["notes"])]]);
        host.hold = (command) => {
          tab.aldo.starts.set("s0", {
            [command.threadId]: {
              kind: first ? "start" : "message",
              state: "failed",
              detail: "No agent is available.",
            },
          });
        };
        const sent = send("s0", first).then(
          () => "sent",
          (cause: Error) => cause.message,
        );
        yield* advance(1_500);
        expect(yield* Effect.promise(() => sent)).toBe("No agent is available.");
        expect(tab.aldo.wakes).toBe(0);
        expect(tab.aldo.allAsks()).toBe(0);
        expect(phase("s0")).toBe("available");
      }),
  );

  it.live(
    "a message the page can send itself that Aldo gave up on: the page wakes the machine and sends it",
    () =>
      Effect.gen(function* () {
        const tab = yield* page({ s0: "stopped" });
        host.hold = (command) => {
          tab.aldo.starts.set("s0", {
            [command.threadId]: { kind: "message", state: "failed", detail: "It didn't start." },
          });
        };
        const sent = send("s0");
        yield* advance(1_500);
        expect(yield* Effect.promise(() => sent)).toBeNull();
        expect(tab.aldo.wakes).toBe(1);
        expect(tab.aldo.asksFor("s0")).toBe(1);
        expect(phase("s0")).toBe("connected");
      }),
  );

  it.live(
    "a message only Aldo can send that Aldo gives up on while the page wakes the machine: the page says why once it's up",
    () =>
      Effect.gen(function* () {
        const tab = yield* page({ s0: "stopped" });
        host.files = new Map([["file-1", new Blob(["notes"])]]);
        let threadId = "";
        host.hold = (command) => {
          threadId = command.threadId;
          tab.aldo.starts.set("s0", { [threadId]: { kind: "message", state: "retrying" } });
        };
        // The page wakes it, and its first ask waits while Aldo's last try fails.
        tab.aldo.gate("connect:s0");
        const sent = send("s0").then(
          () => "sent",
          (cause: Error) => cause.message,
        );
        yield* advance(1_000);
        expect(tab.aldo.wakes).toBe(1);
        expect(tab.aldo.asksFor("s0")).toBe(1);
        tab.aldo.starts.set("s0", {
          [threadId]: { kind: "message", state: "failed", detail: "It didn't start." },
        });
        tab.directory.requestAldoDirectoryRefresh();
        yield* advance(500);
        tab.aldo.open("connect:s0");
        yield* advance(1_000);
        expect(yield* Effect.promise(() => sent)).toBe("It didn't start.");
        expect(phase("s0")).toBe("connected");
      }),
  );

  it.live(
    "a message only Aldo can send to a thread whose last one Aldo gave up on: the page doesn't take that for this one's",
    () =>
      Effect.gen(function* () {
        const tab = yield* page({ s0: "stopped" });
        tab.aldo.starts.set("s0", {
          "t-s0": { kind: "message", state: "failed", detail: "It didn't start." },
        });
        const listed = tab.directory.readAldoDirectory();
        yield* advance(500);
        expect(yield* Effect.promise(() => listed)).toBe(true);
        expect(tab.directory.aldoStartState("aldo-s0", "t-s0")?.state).toBe("failed");

        // Aldo holds this one in its place, and the directory can't be read from then on.
        host.files = new Map([["file-1", new Blob(["notes"])]]);
        host.hold = (command) => {
          tab.aldo.starts.set("s0", { [command.threadId]: { kind: "message", state: "starting" } });
          tab.aldo.readsFail = true;
        };
        const sent = send("s0");
        yield* advance(20_000);
        expect(yield* Effect.promise(() => sent)).toEqual({ sequence: 0 });
        expect(tab.aldo.wakes).toBe(1);
        expect(phase("s0")).toBe("connected");
      }),
  );
});
