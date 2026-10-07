import { describe, expect, it } from "vite-plus/test";

import { AldoLiveTranscript, idleCall, livePhase } from "./liveTranscript.logic";

describe("AldoLiveTranscript", () => {
  it("groups fragments into a speaker's turn until they pause, with both speakers at once", () => {
    const turns: string[] = [];
    const transcript = new AldoLiveTranscript((turn) => turns.push(`${turn.role}: ${turn.text}`));
    transcript.add("user", " Hey", 1600, 1800, 0);
    transcript.add("user", ", what's on", 2200, 2400, 600);
    transcript.add("assistant", " Mm-hmm.", 2400, 2600, 800);
    transcript.add("user", " my calendar?", 2600, 3000, 1000);
    expect(turns).toEqual([]);
    expect(transcript.saying("user")).toBe("Hey, what's on my calendar?");
    expect(transcript.quietFor("user", 1500)).toBe(500);
    transcript.settle(2500);
    expect(turns).toEqual(["user: Hey, what's on my calendar?", "assistant: Mm-hmm."]);
  });

  it("starts a new turn after a long pause, and keeps what's still being said in the conversation", () => {
    const transcript = new AldoLiveTranscript();
    transcript.add("assistant", " Sure.", 5000, 5400, 0);
    transcript.add("assistant", " One sec.", 8000, 8400, 3000);
    expect(transcript.turns).toEqual([{ role: "assistant", text: "Sure." }]);
    expect(transcript.all()).toEqual([
      { role: "assistant", text: "Sure." },
      { role: "assistant", text: "One sec." },
    ]);
  });

  it("flushes one speaker for a delegation, and takes typed words as a turn of their own", () => {
    const turns: string[] = [];
    const transcript = new AldoLiveTranscript((turn) => turns.push(turn.text));
    transcript.add("assistant", " Let me check.", 0, 400, 0);
    transcript.add("user", " Is the checkout", 300, 900, 0);
    transcript.flush("user");
    expect(turns).toEqual(["Is the checkout"]);
    expect(transcript.saying("assistant")).toBe("Let me check.");
    transcript.note({ role: "user", text: " the one in aldo " });
    expect(transcript.all().map((turn) => turn.text)).toEqual([
      "Is the checkout",
      "the one in aldo",
      "Let me check.",
    ]);
    expect(transcript.quietFor("user")).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("livePhase", () => {
  const listening = {
    phase: "listening" as const,
    userQuietMs: 5000,
    aldoQuietMs: 5000,
    delegating: 0,
  };
  it("shows who spoke last, then work, then listening", () => {
    expect(livePhase(listening)).toBe("listening");
    expect(livePhase({ ...listening, userQuietMs: 100 })).toBe("hearing");
    expect(livePhase({ ...listening, aldoQuietMs: 100 })).toBe("speaking");
    expect(livePhase({ ...listening, userQuietMs: 300, aldoQuietMs: 100 })).toBe("speaking");
    expect(livePhase({ ...listening, delegating: 1 })).toBe("thinking");
  });
  it("leaves a call that isn't connected alone", () => {
    expect(livePhase({ ...listening, phase: "connecting", userQuietMs: 0 })).toBe("connecting");
    expect(livePhase({ ...listening, phase: "idle" })).toBe("idle");
  });
});

describe("idleCall", () => {
  it("hangs up a call nobody's used for a while, unless work is running", () => {
    expect(idleCall({ lastSpokeAt: 0, delegating: 0, now: 89_000, idleMs: 90_000 })).toBe(false);
    expect(idleCall({ lastSpokeAt: 0, delegating: 0, now: 90_000, idleMs: 90_000 })).toBe(true);
    expect(idleCall({ lastSpokeAt: 0, delegating: 1, now: 900_000, idleMs: 90_000 })).toBe(false);
  });
});
