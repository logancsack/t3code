import { describe, expect, it } from "vite-plus/test";
import { presenceLine, presenceState, voicePresenceState } from "./presence.logic";

const quiet = { phase: "idle" as const, replying: false, working: [], waiting: 0 };
describe("Aldo presence states", () => {
  it("keeps needs-you and working counts together while showing the attention state", () => {
    expect(
      presenceLine({
        ...quiet,
        waiting: 2,
        working: [{ title: "Close September", browsing: null }],
      }),
    ).toEqual({ text: "2 need you · 1 working", state: "needs-you" });
    expect(presenceLine({ ...quiet, waiting: 1 }).state).toBe("needs-you");
  });
  it("distinguishes connecting and real errors from an idle mark", () => {
    expect(presenceLine({ ...quiet, phase: "connecting" }).state).toBe("connecting");
    expect(presenceLine({ ...quiet, phase: "error" }).state).toBe("error");
    expect(presenceLine({ ...quiet, unread: true }).state).toBe("error");
    expect(presenceLine(quiet).state).toBe("idle");
    expect(voicePresenceState("hearing")).toBe("listening");
  });
  it("never lets local success or typing mask a voice state or error", () => {
    for (const state of ["connecting", "thinking", "listening", "speaking", "error"] as const)
      expect(presenceState(state, { reading: true, success: true })).toBe(state);
    expect(presenceState("working", { reading: true, success: true })).toBe("success");
    expect(presenceState("needs-you", { reading: true, success: false })).toBe("reading");
  });
});
