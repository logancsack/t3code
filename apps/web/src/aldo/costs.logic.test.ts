import { describe, expect, it } from "vite-plus/test";

import { aldoCostLine, isAldoCost } from "./costs.logic";

describe("aldoCostLine", () => {
  const cost = { usd: 30, conversations: { a: 22.5, b: 7.5 } };

  it("says a conversation's share, and its machine's when it shares one", () => {
    expect(aldoCostLine(cost, "a")).toBe(
      "So far: about $22.50 at API prices ($30.00 for this machine)",
    );
    expect(aldoCostLine({ usd: 4, conversations: { a: 4 } }, "a")).toBe(
      "So far: about $4.00 at API prices",
    );
  });

  it("says only the machine's for a conversation with no turns recorded, and nothing with no cost", () => {
    expect(aldoCostLine({ usd: 4, conversations: {} }, "a")).toBe(
      "So far: about $4.00 at API prices for this machine",
    );
    expect(aldoCostLine(cost, "c")).toBe("So far: about $30.00 at API prices for this machine");
    expect(aldoCostLine({ usd: 0, conversations: {} }, "a")).toBeNull();
    expect(aldoCostLine(null, "a")).toBeNull();
  });

  it("takes only what Aldo answers as a cost", () => {
    expect(isAldoCost(cost)).toBe(true);
    expect(isAldoCost({ usd: "30" })).toBe(false);
    expect(isAldoCost({ usd: 30, conversations: { a: "22.5", b: 7.5 } })).toBe(false);
    expect(isAldoCost({ usd: 30, conversations: [1] })).toBe(false);
    expect(isAldoCost({ usd: Number.NaN, conversations: {} })).toBe(false);
    expect(isAldoCost(null)).toBe(false);
  });
});
