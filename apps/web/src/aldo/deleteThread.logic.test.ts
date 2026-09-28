import { describe, expect, it } from "vite-plus/test";

import { aldoThreadIsAloneOnMachine } from "./deleteThread.logic";

describe("aldoThreadIsAloneOnMachine", () => {
  it("is true for the only thread on its machine", () => {
    expect(aldoThreadIsAloneOnMachine({ threadId: "a", machineThreadIds: ["a"] })).toBe(true);
  });

  it("is false when the machine hosts other threads", () => {
    expect(aldoThreadIsAloneOnMachine({ threadId: "a", machineThreadIds: ["a", "b"] })).toBe(false);
  });

  it("doesn't count threads already deleted in the same batch", () => {
    expect(
      aldoThreadIsAloneOnMachine({
        threadId: "b",
        machineThreadIds: ["a", "b"],
        deletedThreadIds: new Set(["a"]),
      }),
    ).toBe(true);
    expect(
      aldoThreadIsAloneOnMachine({
        threadId: "b",
        machineThreadIds: ["a", "b", "c"],
        deletedThreadIds: new Set(["a"]),
      }),
    ).toBe(false);
  });

  it("is false for a thread the client doesn't know on the machine", () => {
    expect(aldoThreadIsAloneOnMachine({ threadId: "a", machineThreadIds: [] })).toBe(false);
    expect(aldoThreadIsAloneOnMachine({ threadId: "a", machineThreadIds: ["b"] })).toBe(false);
  });
});
