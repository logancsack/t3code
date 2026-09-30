import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  parseThreadCheckoutPath,
  projectVirtualRoot,
  runnerProtocolsOverlap,
  ThreadMachineStatus,
  threadCheckoutPath,
} from "./runner.ts";

describe("thread checkout paths", () => {
  it("round-trips a thread id through its checkout path", () => {
    expect(threadCheckoutPath("thread-1")).toBe("/workspace/t/thread-1");
    expect(parseThreadCheckoutPath("/workspace/t/thread-1")).toBe("thread-1");
  });

  it("routes paths inside a checkout to its thread", () => {
    expect(parseThreadCheckoutPath("/workspace/t/thread-1/src/index.ts")).toBe("thread-1");
  });

  it("encodes ids that are not a single safe path segment", () => {
    const path = threadCheckoutPath("handoff/a b");
    expect(path).toBe("/workspace/t/handoff%2Fa%20b");
    expect(parseThreadCheckoutPath(path)).toBe("handoff/a b");
    expect(threadCheckoutPath("..")).toBe("/workspace/t/%2E%2E");
    expect(parseThreadCheckoutPath(threadCheckoutPath(".."))).toBe("..");
  });

  it("rejects paths that are not a thread checkout", () => {
    expect(parseThreadCheckoutPath("/workspace/t")).toBeNull();
    expect(parseThreadCheckoutPath("/workspace/t/")).toBeNull();
    expect(parseThreadCheckoutPath("/workspace/tt/thread-1")).toBeNull();
    expect(parseThreadCheckoutPath("/workspace/p/project-1")).toBeNull();
    expect(parseThreadCheckoutPath("/workspace/t/thread-1/../thread-2")).toBeNull();
    expect(parseThreadCheckoutPath("/workspace/t/%E0%A4%A")).toBeNull();
  });

  it("honors a custom checkout root", () => {
    const path = threadCheckoutPath("thread-1", "/tmp/hub/t/");
    expect(path).toBe("/tmp/hub/t/thread-1");
    expect(parseThreadCheckoutPath(path, "/tmp/hub/t")).toBe("thread-1");
    expect(parseThreadCheckoutPath(path)).toBeNull();
  });

  it("names virtual project roots under /workspace/p", () => {
    expect(projectVirtualRoot("project-1")).toBe("/workspace/p/project-1");
  });
});

describe("runner protocol negotiation", () => {
  it("accepts overlapping version ranges and refuses disjoint ones", () => {
    const base = { hubProtocolVersion: 2, hubMinProtocolVersion: 1 };
    expect(
      runnerProtocolsOverlap({ ...base, runnerProtocolVersion: 1, runnerMinProtocolVersion: 1 }),
    ).toBe(true);
    expect(
      runnerProtocolsOverlap({ ...base, runnerProtocolVersion: 3, runnerMinProtocolVersion: 2 }),
    ).toBe(true);
    expect(
      runnerProtocolsOverlap({ ...base, runnerProtocolVersion: 4, runnerMinProtocolVersion: 3 }),
    ).toBe(false);
    expect(
      runnerProtocolsOverlap({
        hubProtocolVersion: 5,
        hubMinProtocolVersion: 4,
        runnerProtocolVersion: 3,
        runnerMinProtocolVersion: 1,
      }),
    ).toBe(false);
  });
});

describe("machine directory status", () => {
  it("decodes the documented response shapes", () => {
    const decode = Schema.decodeUnknownSync(ThreadMachineStatus);
    expect(decode({ state: "paused", bootId: "boot-1", detail: null })).toEqual({
      state: "paused",
      bootId: "boot-1",
      detail: null,
    });
    expect(
      decode({
        state: "running",
        runner: { url: "wss://runner", token: "t", expiresAt: "2026-09-25T00:00:00.000Z" },
        bootId: "boot-2",
      }).runner?.url,
    ).toBe("wss://runner");
    expect(() => decode({ state: "sleeping" })).toThrow();
  });
});
