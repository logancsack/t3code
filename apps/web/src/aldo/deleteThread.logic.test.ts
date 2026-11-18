import { expect, it } from "vite-plus/test";

import { aldoThreadIsAloneOnMachine } from "./deleteThread.logic";

it("only permits machine deletion after its last known thread is removed", () => {
  expect(aldoThreadIsAloneOnMachine({ threadId: "a", machineThreadIds: ["a"] })).toBe(true);
  expect(aldoThreadIsAloneOnMachine({ threadId: "a", machineThreadIds: ["a", "b"] })).toBe(false);
  expect(aldoThreadIsAloneOnMachine({ threadId: "a", machineThreadIds: ["b"] })).toBe(false);
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
