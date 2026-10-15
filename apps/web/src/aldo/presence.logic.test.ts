import { describe, expect, it } from "vite-plus/test";

import { faceMood, presenceLine } from "./presence.logic";

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
});

describe("faceMood", () => {
  it("shows what Aldo's at first, then how it reacts to the user", () => {
    expect(faceMood("thinking", { reading: true, pleased: true })).toBe("thinking");
    expect(faceMood("working", { reading: true, pleased: true })).toBe("pleased");
    expect(faceMood("working", { reading: true, pleased: false })).toBe("reading");
    expect(faceMood("working", { reading: false, pleased: false })).toBe("working");
  });
});
