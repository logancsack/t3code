import { describe, expect, it } from "vite-plus/test";

import { presenceLine } from "./presence.logic";

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
        waiting: 3,
      }),
    ).toEqual({ text: "Q3 board deck · 1 more working", mood: "working" });
    expect(
      presenceLine({
        ...idle,
        working: [{ title: "Book dinner", browsing: { site: "opentable.com", at: "" } }],
      }).text,
    ).toBe("On opentable.com");
  });

  it("then what waits on the user, or that nothing does", () => {
    expect(presenceLine({ ...idle, waiting: 1 }).text).toBe("1 thing needs you");
    expect(presenceLine({ ...idle, waiting: 4 }).text).toBe("4 things need you");
    expect(presenceLine(idle).text).toBe("All caught up");
  });
});
