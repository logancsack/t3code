// @vitest-environment jsdom
import { afterAll, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

const original = vi.hoisted(() => ({ now: Date.now }));
vi.mock("../state/entities", () => ({ setActiveEnvironmentId: vi.fn() }));
import { workReplaySnapshots } from "./runtime";
import { resolveSidebarThreadStatus } from "../components/Sidebar.logic";
import { aldoOpenShareNow } from "../aldo/shareViewer";
import { useAldoAssistant } from "../aldo/assistantSession";
import { applyWorkReplay, homeFor, sourceTime, type WorkReplayScript } from "./workReplay";

afterAll(() => {
  Date.now = original.now;
});

it.live(
  "keeps the native connection clock valid for fractional animation frames and loop resets",
  () =>
    Effect.gen(function* () {
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
        const browserTime = yield* Effect.sync(Date.now);
        expect(Number.isInteger(browserTime)).toBe(true);
        expect(typeof (yield* Clock.currentTimeNanos)).toBe("bigint");
      }
    }),
);

it("keeps concurrent jobs on Home with distinct identities, source clocks and staggered results", () => {
  const task: WorkReplayScript = {
    id: "one",
    title: "One",
    project: "Test",
    request: "Work",
    reply: "Working",
    result: "Done",
    steps: [{ at: 8000, active: "Checking", complete: "Checked", detail: "Source check" }],
    files: [],
    timing: { sent: 3000, reply: 4400, thread: 7200, result: 120000, home: 125000, end: 140000 },
  };
  const script: WorkReplayScript = {
    ...task,
    id: "session",
    elapsed: [
      { at: 0, ms: 0 },
      { at: 20000, ms: 200000 },
    ],
    session: Array.from({ length: 7 }, (_, i) => ({
      script: { ...task, id: `job-${i}` },
      start: i * 7000,
      sourceStart: "2026-11-01T00:00:00Z",
      sourceEnd: "2026-11-01T00:02:00Z",
    })),
  };
  expect(sourceTime(script, 10000.25)).toBe(100003);
  applyWorkReplay(script, 7000);
  let home = homeFor(script, 7000);
  expect(home.conversations).toHaveLength(7);
  expect(new Set(home.conversations.map((c) => c.thread.threadId)).size).toBe(7);
  expect(home.usage.agents.running).toBe(7);
  expect(home.conversations[0]!.summary).toContain("Source check");
  expect(location.hash).toBe("#/");
  applyWorkReplay(script, 14000);
  home = homeFor(script, 14000);
  expect(home.usage.agents.running).toBe(4);
  expect(home.conversations[0]!.state).toBe("done");
  expect(home.conversations.at(-1)!.state).toBe("working");
  applyWorkReplay(script, 20000);
  expect(homeFor(script, 20000).usage.agents.running).toBe(0);
  applyWorkReplay(script, 0.3);
  expect(homeFor(script, 0.3).conversations).toHaveLength(0);
  expect(Number.isInteger(Date.now())).toBe(true);
});

it("shows finished output previews and opens only the scheduled result, then returns Home on reset", () => {
  const task: WorkReplayScript = {
    id: "output",
    title: "Output",
    project: "Test",
    request: "Work",
    reply: "Working",
    result: "Done",
    steps: [],
    files: [{ at: 10000, title: "Binder", type: "PDF", href: "/binder.pdf" }],
    preview: { card: "/binder.png", full: "/binder-full.png", title: "Binder" },
    timing: { sent: 1000, reply: 2000, thread: 999999, result: 10000, home: 10000, end: 10000 },
  };
  const script: WorkReplayScript = {
    ...task,
    id: "present",
    elapsed: [
      { at: 0, ms: 0 },
      { at: 10000, ms: 10000 },
      { at: 40000, ms: 10000 },
    ],
    session: [{ script: task, start: 0, sourceStart: "", sourceEnd: "" }],
    viewers: [{ at: 15000, end: 31000, task: task.id }],
  };
  applyWorkReplay(script, 9000);
  expect(
    useAldoAssistant.getState().entries.some((e) => e.kind === "message" && e.artifacts?.length),
  ).toBe(false);
  applyWorkReplay(script, 10000);
  const result = useAldoAssistant.getState().entries.at(-1);
  expect(
    result?.kind === "message" && result.artifacts?.map((a) => a.kind === "file" && a.url),
  ).toEqual(["/binder.png", "/binder.pdf"]);
  applyWorkReplay(script, 15000);
  expect(aldoOpenShareNow()).toMatchObject({ url: "/binder-full.png", fullScreen: true });
  expect(document.documentElement.dataset.replayStage).toBe("viewer");
  expect(location.hash).toBe("#/");
  applyWorkReplay(script, 31000);
  expect(aldoOpenShareNow()).toBeNull();
  applyWorkReplay(script, 15000);
  applyWorkReplay(script, 0);
  expect(aldoOpenShareNow()).toBeNull();
});

it("keeps native sidebar status in sync with Home at each task start, finish and loop reset", () => {
  const task: WorkReplayScript = {
    id: "task",
    title: "Task",
    project: "Test",
    request: "Work",
    reply: "Working",
    result: "Done",
    steps: [],
    files: [],
    timing: { sent: 3000, reply: 4400, thread: 7200, result: 120000, home: 125000, end: 140000 },
  };
  const script: WorkReplayScript = {
    ...task,
    id: "sidebar-session",
    session: Array.from({ length: 7 }, (_, i) => ({
      script: { ...task, id: `job-${i}` },
      start: i * 7000,
      sourceStart: "2026-11-01T00:00:00Z",
      sourceEnd: "2026-11-01T00:02:00Z",
    })),
  };
  const boundaries = script
    .session!.flatMap(({ start }) => [
      start + task.timing.reply - 1,
      start + task.timing.reply,
      start + task.timing.result - 1,
      start + task.timing.result,
    ])
    .sort((a, b) => a - b);
  for (const at of [...boundaries, 0]) {
    applyWorkReplay(script, at);
    const home = homeFor(script, at);
    const threads = workReplaySnapshots().shell.threads;
    expect(threads).toHaveLength(home.conversations.length);
    expect(threads.filter((t) => resolveSidebarThreadStatus(t) === "working")).toHaveLength(
      home.usage.agents.running,
    );
    for (const conversation of home.conversations) {
      const thread = threads.find((t) => t.id === `replay-${conversation.ref}`)!;
      expect(resolveSidebarThreadStatus(thread)).toBe(
        conversation.state === "working" ? "working" : "ready",
      );
      expect(thread.session?.activeTurnId).toBe(
        conversation.state === "working" ? thread.latestTurn?.turnId : null,
      );
    }
  }
});
