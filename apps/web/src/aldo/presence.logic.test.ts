import { describe, expect, it } from "vite-plus/test";

import { phaseMood, presenceLine } from "./presence.logic";

const idle = { phase: "idle" as const, replying: false, working: [], waiting: 0 };

describe("presenceLine", () => {
  it("says what Aldo is doing first", () => {
    expect(presenceLine({ ...idle, phase: "listening", waiting: 2 })).toEqual({
      text: "Listening…",
      mood: "listening",
    });
    expect(presenceLine({ ...idle, replying: true }).text).toBe("Typing…");
  });

  it("then what its agents are at, the newest by name", () => {
    expect(
      presenceLine({
        ...idle,
        working: [{ title: "Q3 board deck" }, { title: "Stripe meters" }],
      }),
    ).toEqual({ text: "Q3 board deck · 1 more working", mood: "working" });
    expect(
      presenceLine({
        ...idle,
        working: [{ title: "Book dinner", browsing: { site: "opentable.com", at: "" } }],
      }).text,
    ).toBe("On opentable.com");
  });

  it("leads with what needs the user while agents work", () => {
    expect(
      presenceLine({
        ...idle,
        working: [{ title: "Q3 board deck" }, { title: "Stripe meters" }],
        waiting: 3,
      }),
    ).toEqual({ text: "3 need you · 2 working", mood: "working" });
    expect(presenceLine({ ...idle, working: [{ title: "Q3 board deck" }], waiting: 1 }).text).toBe(
      "1 needs you · 1 working",
    );
  });

  it("then what waits on the user, or that nothing does", () => {
    expect(presenceLine({ ...idle, waiting: 1 }).text).toBe("1 thing needs you");
    expect(presenceLine({ ...idle, waiting: 4 }).text).toBe("4 things need you");
    expect(presenceLine(idle).text).toBe("All caught up");
  });

  it("never says all caught up when nothing could be read", () => {
    expect(presenceLine({ ...idle, unread: true }).text).toBe("Couldn't check on your agents");
  });
});

describe("phaseMood", () => {
  it("shows where a conversation with Aldo is", () => {
    expect(phaseMood("connecting")).toBe("thinking");
    expect(phaseMood("thinking")).toBe("thinking");
    expect(phaseMood("hearing")).toBe("listening");
    expect(phaseMood("speaking")).toBe("speaking");
    expect(phaseMood("error")).toBe("idle");
  });
});
