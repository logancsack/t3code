import { describe, expect, it } from "vite-plus/test";

import { isLandingDemo } from "./mode";

describe("landing demo mode", () => {
  it("is enabled only by the explicit anonymous demo flag", () => {
    expect(isLandingDemo(new URL("https://aldoagent.com/demo/t3?aldoDemo=1"))).toBe(true);
    expect(isLandingDemo(new URL("https://aldoagent.com/demo/t3"))).toBe(false);
    expect(isLandingDemo(new URL("https://aldoagent.com/demo/t3?aldoDemo=0"))).toBe(false);
  });
});
