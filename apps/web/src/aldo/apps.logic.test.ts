import { describe, expect, it } from "vite-plus/test";

import { normalizeAldoAppUrl, parseAldoAppMessage } from "./apps.logic";

describe("parseAldoAppMessage", () => {
  it("reads an app sign-in's result, and nothing else", () => {
    expect(parseAldoAppMessage({ type: "aldo:app", ok: true, title: "Notion" })).toEqual({
      ok: true,
      title: "Notion",
    });
    expect(parseAldoAppMessage({ type: "aldo:app", ok: false, message: "Cancelled." })).toEqual({
      ok: false,
      message: "Cancelled.",
    });
    expect(parseAldoAppMessage({ type: "aldo:integration", ok: true })).toBeNull();
    expect(parseAldoAppMessage("aldo:app")).toBeNull();
  });
});

describe("normalizeAldoAppUrl", () => {
  it("takes an https address, adding the scheme when it's left off", () => {
    expect(normalizeAldoAppUrl(" mcp.example.com/mcp ")).toBe("https://mcp.example.com/mcp");
    expect(normalizeAldoAppUrl("https://mcp.linear.app/mcp")).toBe("https://mcp.linear.app/mcp");
    expect(normalizeAldoAppUrl("http://mcp.example.com")).toBeNull();
    expect(normalizeAldoAppUrl("localhost:3000")).toBeNull();
    expect(normalizeAldoAppUrl("")).toBeNull();
  });
});
