import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const sent = vi.hoisted(
  () =>
    [] as Array<{
      environmentId: string;
      presence: { thread: string; focused: boolean } | undefined;
      keepalive: boolean;
    }>,
);
const page = vi.hoisted(() => ({ usedAt: 0 }));

vi.mock("./cloud", () => ({
  isAldoCloud: true,
  isAldoEnvironmentId: (id: string) => id.startsWith("aldo-"),
  touchAldoEnvironment: (
    environmentId: string,
    presence?: { thread: string; focused: boolean },
    options: { keepalive?: boolean } = {},
  ) => sent.push({ environmentId, presence, keepalive: options.keepalive ?? false }),
}));
vi.mock("./preload", () => ({ aldoPageUsedAt: () => page.usedAt }));

import { watchAldoFocus } from "./focus";
import { ALDO_FOCUS_IDLE_MS } from "./focus.logic";

const A = { environmentId: "aldo-a", thread: "t-a" };
const B = { environmentId: "aldo-b", thread: "t-b" };

let win: EventTarget;
let doc: EventTarget & { visibilityState: string; hasFocus: () => boolean };
let focused = true;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  page.usedAt = Date.now();
  focused = true;
  win = Object.assign(new EventTarget(), {
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (id: number) => clearInterval(id),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: number) => clearTimeout(id),
  });
  doc = Object.assign(new EventTarget(), {
    visibilityState: "visible",
    hasFocus: () => focused,
  });
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  sent.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const said = () =>
  sent.map((s) => `${s.environmentId}:${s.presence?.thread}:${s.presence?.focused}`);

describe("watchAldoFocus", () => {
  it("says the conversation is on screen at once, and again within the minute", () => {
    doc.visibilityState = "hidden";
    const background = watchAldoFocus(A);
    vi.advanceTimersByTime(60_000);
    expect(said()).toEqual([]);
    background();
    doc.visibilityState = "visible";
    focused = false;
    const unfocused = watchAldoFocus(A);
    expect(said()).toEqual([]);
    unfocused();
    focused = true;
    const stop = watchAldoFocus(A);
    expect(said()).toEqual(["aldo-a:t-a:true"]);
    vi.advanceTimersByTime(30_000);
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(30_000);
    expect(said()).toEqual(["aldo-a:t-a:true", "aldo-a:t-a:true"]);
    stop();
  });

  it("says once that it isn't when the window loses focus, and again when it's back", () => {
    const stop = watchAldoFocus(A);
    focused = false;
    win.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(1_000);
    vi.advanceTimersByTime(60_000);
    expect(said()).toEqual(["aldo-a:t-a:true", "aldo-a:t-a:false"]);
    focused = true;
    win.dispatchEvent(new Event("focus"));
    expect(said().at(-1)).toBe("aldo-a:t-a:true");
    stop();
  });

  it("doesn't count focus going into a frame on the page as leaving it", () => {
    const stop = watchAldoFocus(A);
    // The window blurs, then the page has focus again (inside the frame).
    win.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(1_000);
    expect(said()).toEqual(["aldo-a:t-a:true"]);
    stop();
  });

  it("says it isn't as the page is hidden or goes away, so the words still go out", () => {
    const stop = watchAldoFocus(A);
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(sent.at(-1)).toEqual({
      environmentId: "aldo-a",
      presence: { thread: "t-a", focused: false },
      keepalive: true,
    });
    stop();

    sent.length = 0;
    doc.visibilityState = "visible";
    const again = watchAldoFocus(A);
    win.dispatchEvent(new Event("pagehide"));
    expect(sent.at(-1)).toEqual({
      environmentId: "aldo-a",
      presence: { thread: "t-a", focused: false },
      keepalive: true,
    });
    // Back from the back-forward cache.
    win.dispatchEvent(new Event("pageshow"));
    expect(said().at(-1)).toBe("aldo-a:t-a:true");
    again();
  });

  it("lets a page left alone ring again, and says so once it's used", () => {
    const stop = watchAldoFocus(A);
    vi.advanceTimersByTime(ALDO_FOCUS_IDLE_MS + 15_000);
    expect(said().at(-1)).toBe("aldo-a:t-a:false");
    page.usedAt = Date.now();
    win.dispatchEvent(new Event("keydown"));
    expect(said().at(-1)).toBe("aldo-a:t-a:true");
    stop();
  });

  it("moves with the user to another thread, and stops when they leave", () => {
    const stopA = watchAldoFocus(A);
    stopA();
    const stopA2 = watchAldoFocus({ environmentId: "aldo-a", thread: "t-a2" });
    expect(said()).toEqual(["aldo-a:t-a:true", "aldo-a:t-a:false", "aldo-a:t-a2:true"]);
    stopA2();
    const stopB = watchAldoFocus(B);
    expect(said().slice(-2)).toEqual(["aldo-a:t-a2:false", "aldo-b:t-b:true"]);
    stopB();
    expect(said().at(-1)).toBe("aldo-b:t-b:false");
    vi.advanceTimersByTime(120_000);
    expect(sent).toHaveLength(6);
  });
});
