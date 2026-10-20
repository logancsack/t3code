import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import type { AldoTestState } from "./notifications.logic";

// A device with a subscription, a fake service worker that posts messages to
// the page, and Aldo's test route; timers are fake, so the timeout is exact.
let listeners: Array<(event: MessageEvent) => void> = [];
let unsubscribed = 0;
let posted: Array<{ url: string; body: Record<string, unknown> }> = [];
let answer: () => Response = () => Response.json({ sent: true });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("VITE_ALDO_CLOUD", "1");
  listeners = [];
  unsubscribed = 0;
  posted = [];
  answer = () => Response.json({ sent: true });
  const subscription = {
    endpoint: "https://fcm.googleapis.com/fcm/send/device",
    unsubscribe: async () => {
      unsubscribed++;
      return true;
    },
  };
  vi.stubGlobal("navigator", {
    userAgent: "",
    platform: "",
    maxTouchPoints: 0,
    serviceWorker: {
      addEventListener: (_type: string, listener: (event: MessageEvent) => void) =>
        listeners.push(listener),
      removeEventListener: (_type: string, listener: (event: MessageEvent) => void) => {
        listeners = listeners.filter((l) => l !== listener);
      },
      getRegistration: async () => ({ pushManager: { getSubscription: async () => subscription } }),
    },
  });
  vi.stubGlobal("location", { pathname: "/aldo-t1/c1", search: "", hash: "" });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    posted.push({ url, body: JSON.parse(String(init.body)) });
    return answer();
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Starts a test and collects what it reports. */
async function start() {
  const { testAldoNotifications } = await import("./notifications");
  const states: AldoTestState[] = [];
  const stop = testAldoNotifications((state) => states.push(state));
  // Let the subscription lookup and Aldo's answer come.
  await vi.advanceTimersByTimeAsync(0);
  const worker = (data: unknown) => {
    for (const listener of listeners) listener({ data } as MessageEvent);
  };
  return { states, stop, worker, id: String(posted[0]?.body.id) };
}

it("sends this device's test and says it arrived once its worker shows it", async () => {
  const test = await start();
  expect(posted).toEqual([
    {
      url: "/api/push/test",
      body: {
        endpoint: "https://fcm.googleapis.com/fcm/send/device",
        id: test.id,
        url: "/aldo-t1/c1",
      },
    },
  ]);
  expect(test.states.map((s) => s.phase)).toEqual(["sending", "waiting"]);
  // Another test's word, or a malformed one, isn't this one's.
  test.worker({ type: "aldo-test", id: "someone-else", shown: true });
  test.worker(null);
  expect(test.states.at(-1)?.phase).toBe("waiting");
  test.worker({ type: "aldo-test", id: test.id, shown: true });
  expect(test.states.at(-1)?.phase).toBe("arrived");
  // Done: it stops listening.
  expect(listeners).toHaveLength(0);
});

it("after 15 seconds without a word, says where to look, and still counts a late arrival", async () => {
  const test = await start();
  await vi.advanceTimersByTimeAsync(14_999);
  expect(test.states.at(-1)?.phase).toBe("waiting");
  await vi.advanceTimersByTimeAsync(1);
  expect(test.states.at(-1)?.phase).toBe("not-seen");
  test.worker({ type: "aldo-test", id: test.id, shown: true });
  expect(test.states.at(-1)?.phase).toBe("arrived");
});

it("stops listening after two minutes", async () => {
  const test = await start();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(listeners).toHaveLength(0);
  expect(test.states.at(-1)?.phase).toBe("not-seen");
});

it("takes an older worker's word that a push came", async () => {
  const test = await start();
  test.worker({ type: "aldo-push", url: "/aldo-t1/c1" });
  expect(test.states.at(-1)?.phase).toBe("arrived");
});

it("says the browser didn't show it when the worker couldn't", async () => {
  const test = await start();
  test.worker({ type: "aldo-test", id: test.id, shown: false });
  expect(test.states.at(-1)?.phase).toBe("not-shown");
});

it("says why Aldo didn't send it, and lets go of a subscription Aldo says is gone", async () => {
  answer = () =>
    Response.json(
      { error: "A test just went to this browser. Try again in a few seconds." },
      { status: 429 },
    );
  const limited = await start();
  expect(limited.states.at(-1)).toEqual({
    phase: "failed",
    message: "A test just went to this browser. Try again in a few seconds.",
  });
  expect(unsubscribed).toBe(0);
  limited.stop();
  posted = [];
  answer = () =>
    Response.json(
      { error: "This browser’s notifications had expired. Turn them on again." },
      { status: 410 },
    );
  const gone = await start();
  expect(gone.states.at(-1)?.phase).toBe("failed");
  expect(unsubscribed).toBe(1);
});

it("says Aldo can't be reached when the request fails", async () => {
  vi.stubGlobal("fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  const test = await start();
  expect(test.states.at(-1)).toEqual({
    phase: "failed",
    message: "Aldo can’t be reached just now. Try again.",
  });
});
