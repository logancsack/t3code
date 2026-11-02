// @vitest-environment jsdom
import { afterAll, expect, it, vi } from "vite-plus/test";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

const original = vi.hoisted(() => ({ now: Date.now }));
vi.mock("../state/entities", () => ({ setActiveEnvironmentId: vi.fn() }));
import { applyWorkReplay, type WorkReplayScript } from "./workReplay";

afterAll(() => {
  Date.now = original.now;
});

it("keeps the native connection clock valid for fractional animation frames and loop resets", async () => {
  const script: WorkReplayScript = {
    id: "clock",
    title: "Clock",
    project: "Test",
    request: "Hello",
    reply: "Working",
    result: "Done",
    steps: [],
    files: [],
    timing: { sent: 3000, reply: 4400, thread: 7200, result: 23000, home: 28000, end: 41000 },
  };
  for (const at of [0, 7200.2, 20500.75, 30000.1, 0.3]) {
    applyWorkReplay(script, at);
    expect(Number.isInteger(Date.now())).toBe(true);
    expect(typeof (await Effect.runPromise(Clock.currentTimeNanos))).toBe("bigint");
  }
});
