import { beforeEach, expect, it, vi } from "vite-plus/test";
import type { AldoHome } from "./cloud";
import { aldoChatDecisions } from "./decisions.logic";
const call = vi.hoisted(() => ({ tell: vi.fn() }));
vi.mock("./assistantSession", () => ({
  aldoAssistantLive: () => true,
  connectAldo: vi.fn(),
  tellAldoCall: call.tell,
}));
vi.mock("./callView", () => ({ showAldoCall: vi.fn() }));
import { reconcileAldoWalkthrough, startAldoWalkthrough, useAldoWalkthrough } from "./walkthrough";
const now = Date.now();
const home = (hidden: string[] = []) =>
  ({
    conversations: ["a", "b", "c"].map((ref) => ({
      ref,
      title: ref,
      repos: [],
      branch: "test",
      state: "waiting",
      machine: "asleep",
      at: new Date(now).toISOString(),
      thread: { environmentId: ref, threadId: ref },
      plan: { id: ref, text: "A plan" },
      chatDecision: { id: ref, dismissed: hidden.includes(ref) },
    })),
    approvals: [],
    pullRequests: [],
  }) as unknown as AldoHome;
beforeEach(() => {
  useAldoWalkthrough.setState({ active: false, decisions: [], index: 0, suggestions: {} });
  call.tell.mockClear();
});
it("removes current and future hidden prompts from a minimized walkthrough without deciding them", () => {
  startAldoWalkthrough(aldoChatDecisions(home(), now));
  call.tell.mockClear();
  reconcileAldoWalkthrough(home(["a", "b"]), now);
  const state = useAldoWalkthrough.getState();
  expect(state.decisions.map((d) => d.key)).toEqual(["plan:c:c"]);
  expect(state.index).toBe(0);
  expect(call.tell).toHaveBeenCalledOnce();
  expect(call.tell.mock.calls[0]![0]).toContain("still waiting, unanswered and unapproved");
  expect(call.tell.mock.calls[0]![0]).toContain("Next, 1 of 1");
  reconcileAldoWalkthrough(home(["a", "b"]), now);
  expect(call.tell).toHaveBeenCalledOnce();
});
it("hiding the last prompt ends the walkthrough without claiming approval", () => {
  startAldoWalkthrough(aldoChatDecisions(home(), now));
  reconcileAldoWalkthrough(home(["a", "b", "c"]), now);
  expect(useAldoWalkthrough.getState().decisions).toHaveLength(0);
  expect(call.tell.mock.calls.at(-1)![0]).toContain("still waiting, unanswered and unapproved");
});
