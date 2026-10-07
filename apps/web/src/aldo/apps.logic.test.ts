import { describe, expect, it } from "vite-plus/test";

import {
  aldoAppResultFilter,
  normalizeAldoAppUrl,
  parseAldoAppMessage,
  parseAldoAppRedirect,
  withoutAldoAppRedirect,
} from "./apps.logic";

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
    // Aldo decides about the rest.
    expect(normalizeAldoAppUrl("https://[2001:db8::1]/mcp")).toBe("https://[2001:db8::1]/mcp");
    expect(normalizeAldoAppUrl("https://intranet-mcp/mcp")).toBe("https://intranet-mcp/mcp");
  });
});

describe("a sign-in's result", () => {
  it("is read from the query without a popup, and taken out after", () => {
    expect(parseAldoAppRedirect("?app=error&message=Cancelled.")).toEqual({
      ok: false,
      message: "Cancelled.",
    });
    expect(parseAldoAppRedirect("?app=connected")).toEqual({ ok: true });
    expect(parseAldoAppRedirect("?integration=google&status=connected")).toBeNull();
    expect(withoutAldoAppRedirect("?app=error&message=x&tab=1")).toBe("?tab=1");
    expect(withoutAldoAppRedirect("?integration=google&status=error&message=x&app=error")).toBe(
      "?integration=google&status=error&message=x",
    );
  });

  it("is told once when it arrives both ways", () => {
    const isNew = aldoAppResultFilter();
    const result = { ok: false, message: "Cancelled." };
    expect(isNew(result, 1_000)).toBe(true);
    expect(isNew({ ...result }, 1_200)).toBe(false);
    expect(isNew({ ...result }, 2_500)).toBe(true);
  });
});
