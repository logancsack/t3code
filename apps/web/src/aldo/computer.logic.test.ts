import { describe, expect, it } from "vite-plus/test";

import {
  aldoComputerToastThread,
  aldoComputerAskDescription,
  aldoComputerKeptAnswer,
  aldoComputerNotice,
  aldoComputerStartOutcome,
  aldoComputerStoppable,
  aldoDesktopScreen,
  aldoDesktopScreenUrl,
  type AldoComputer,
  type AldoComputerStatus,
} from "./computer.logic";

const computer = (status: AldoComputerStatus, extra: Partial<AldoComputer> = {}): AldoComputer => ({
  kind: "windows",
  status,
  why: null,
  creditsPerHour: 3,
  error: null,
  ...extra,
});

describe("aldoComputerNotice", () => {
  it("asks while the thread's agent asks and this tab hasn't answered", () => {
    expect(aldoComputerNotice(computer("asked", { why: "Run the VBA" }), undefined)).toBe("ask");
  });

  it("doesn't ask again once answered, while the directory still reports the ask", () => {
    expect(aldoComputerNotice(computer("asked"), false)).toBeNull();
    // Agreeing says it's starting at once, before the directory does.
    expect(aldoComputerNotice(computer("asked"), true)).toBe("starting");
  });

  it("says it's starting only while it starts", () => {
    expect(aldoComputerNotice(computer("starting"), undefined)).toBe("starting");
    for (const status of ["new", "running", "stopping", "stopped", "failed"] as const) {
      expect(aldoComputerNotice(computer(status), undefined)).toBeNull();
    }
  });

  it("shows nothing without a computer, as with an Aldo that doesn't report one", () => {
    expect(aldoComputerNotice(null, undefined)).toBeNull();
    expect(aldoComputerNotice(undefined, undefined)).toBeNull();
    expect(aldoComputerNotice(undefined, true)).toBeNull();
  });
});

describe("aldoComputerKeptAnswer", () => {
  it("keeps an answer while the directory still reports the ask", () => {
    expect(aldoComputerKeptAnswer(computer("asked"), true)).toBe(true);
    expect(aldoComputerKeptAnswer(computer("asked"), false)).toBe(false);
  });

  it("drops it once the ask is gone, so a later ask is asked again", () => {
    expect(aldoComputerKeptAnswer(computer("starting"), true)).toBeUndefined();
    expect(aldoComputerKeptAnswer(null, false)).toBeUndefined();
    const later = aldoComputerKeptAnswer(null, false);
    expect(aldoComputerNotice(computer("asked"), later)).toBe("ask");
  });
});

describe("aldoComputerStartOutcome", () => {
  it("tells a start that got there from one that failed or was called off", () => {
    expect(aldoComputerStartOutcome(computer("running"))).toBe("ready");
    expect(aldoComputerStartOutcome(computer("failed", { error: "No quota" }))).toBe("failed");
    expect(aldoComputerStartOutcome(computer("stopped"))).toBeNull();
    expect(aldoComputerStartOutcome(null)).toBeNull();
  });
});

describe("aldoComputerStoppable", () => {
  it("offers stopping it only while it starts or runs", () => {
    expect(aldoComputerStoppable(computer("starting"))).toBe(true);
    expect(aldoComputerStoppable(computer("running"))).toBe(true);
    for (const status of ["asked", "new", "stopping", "stopped", "failed"] as const) {
      expect(aldoComputerStoppable(computer(status))).toBe(false);
    }
    expect(aldoComputerStoppable(null)).toBe(false);
  });
});

describe("aldoComputerAskDescription", () => {
  it("gives the agent's reason, then what it costs", () => {
    expect(
      aldoComputerAskDescription({ why: "To run the macros in Q3.xlsm", creditsPerHour: 3 }),
    ).toBe(
      "To run the macros in Q3.xlsm. 3 credits an hour while it runs. It stops when the thread is done.",
    );
    expect(aldoComputerAskDescription({ why: " Refresh Power Query! ", creditsPerHour: 3 })).toBe(
      "Refresh Power Query! 3 credits an hour while it runs. It stops when the thread is done.",
    );
  });

  it("says what it costs without a reason, in the right number", () => {
    expect(aldoComputerAskDescription({ why: null, creditsPerHour: 1 })).toBe(
      "1 credit an hour while it runs. It stops when the thread is done.",
    );
    expect(aldoComputerAskDescription({ why: "  ", creditsPerHour: 2.5 })).toBe(
      "2.5 credits an hour while it runs. It stops when the thread is done.",
    );
  });
});

describe("aldoDesktopScreen", () => {
  it("shows Windows only while it's chosen and the computer runs", () => {
    expect(aldoDesktopScreen("windows", computer("running"))).toBe("windows");
    expect(aldoDesktopScreen("machine", computer("running"))).toBe("machine");
  });

  it("goes back to this machine once the computer stops running", () => {
    for (const status of ["stopping", "stopped", "failed", "starting", "asked"] as const) {
      expect(aldoDesktopScreen("windows", computer(status))).toBe("machine");
    }
    expect(aldoDesktopScreen("windows", null)).toBe("machine");
    expect(aldoDesktopScreen("windows", undefined)).toBe("machine");
  });
});

describe("aldoDesktopScreenUrl", () => {
  const desktopUrl = "wss://agent.example/desktop?token=abc%3D";

  it("uses the desktop stream as it is for this machine", () => {
    expect(aldoDesktopScreenUrl(desktopUrl, "machine")).toBe(desktopUrl);
  });

  it("asks the same stream for the Windows screen", () => {
    expect(aldoDesktopScreenUrl(desktopUrl, "windows")).toBe(`${desktopUrl}&screen=windows`);
    expect(aldoDesktopScreenUrl("wss://agent.example/desktop", "windows")).toBe(
      "wss://agent.example/desktop?screen=windows",
    );
  });
});

describe("aldoComputerToastThread", () => {
  const base = {
    kind: "windows",
    status: "asked",
    why: "Refresh the model",
    creditsPerHour: 2,
    error: null,
  } as const;
  it("belongs to the thread that asks", () => {
    expect(aldoComputerToastThread({ ...base, t3ThreadId: "t3-asking" }, "t3-open")).toBe(
      "t3-asking",
    );
  });
  it("falls back to the open thread with an older Aldo", () => {
    expect(aldoComputerToastThread(base, "t3-open")).toBe("t3-open");
    expect(aldoComputerToastThread({ ...base, t3ThreadId: null }, "t3-open")).toBe("t3-open");
    expect(aldoComputerToastThread(null, "t3-open")).toBe("t3-open");
  });
});
