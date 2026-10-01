import { describe, expect, it } from "vite-plus/test";

import {
  aldoIntegrationResultFilter,
  parseAldoIntegrationMessage,
  parseAldoIntegrationRedirect,
  withoutAldoIntegrationRedirect,
} from "./integrations.logic";

describe("parseAldoIntegrationMessage", () => {
  it("reads a result from Aldo's callback page", () => {
    expect(
      parseAldoIntegrationMessage({ type: "aldo:integration", provider: "microsoft", ok: true }),
    ).toEqual({ provider: "microsoft", ok: true, message: null });
    expect(
      parseAldoIntegrationMessage({
        type: "aldo:integration",
        provider: "microsoft",
        ok: false,
        message: " You cancelled the sign-in. ",
      }),
    ).toEqual({ provider: "microsoft", ok: false, message: "You cancelled the sign-in." });
  });

  it("ignores other messages", () => {
    expect(parseAldoIntegrationMessage(null)).toBeNull();
    expect(parseAldoIntegrationMessage("aldo:integration")).toBeNull();
    expect(
      parseAldoIntegrationMessage({ type: "other", provider: "microsoft", ok: true }),
    ).toBeNull();
    expect(parseAldoIntegrationMessage({ type: "aldo:integration", ok: true })).toBeNull();
    expect(
      parseAldoIntegrationMessage({ type: "aldo:integration", provider: "microsoft", ok: "yes" }),
    ).toBeNull();
  });

  it("leaves out a message that isn't text", () => {
    expect(
      parseAldoIntegrationMessage({
        type: "aldo:integration",
        provider: "microsoft",
        ok: false,
        message: 42,
      }),
    ).toEqual({ provider: "microsoft", ok: false, message: null });
  });
});

describe("parseAldoIntegrationRedirect", () => {
  it("reads a connected or failed sign-in", () => {
    expect(parseAldoIntegrationRedirect("?integration=microsoft&status=connected")).toEqual({
      provider: "microsoft",
      ok: true,
      message: null,
    });
    expect(
      parseAldoIntegrationRedirect(
        "?integration=microsoft&status=error&message=Microsoft+said+no%3A+admin+approval+required",
      ),
    ).toEqual({
      provider: "microsoft",
      ok: false,
      message: "Microsoft said no: admin approval required",
    });
  });

  it("is null without a provider or a known status", () => {
    expect(parseAldoIntegrationRedirect("")).toBeNull();
    expect(parseAldoIntegrationRedirect("?status=connected")).toBeNull();
    expect(parseAldoIntegrationRedirect("?integration=microsoft")).toBeNull();
    expect(parseAldoIntegrationRedirect("?integration=microsoft&status=pending")).toBeNull();
  });
});

describe("withoutAldoIntegrationRedirect", () => {
  it("takes out the result and keeps the rest of the query", () => {
    expect(withoutAldoIntegrationRedirect("?integration=microsoft&status=connected")).toBe("");
    expect(
      withoutAldoIntegrationRedirect("?tab=1&integration=microsoft&status=error&message=No"),
    ).toBe("?tab=1");
  });
});

describe("aldoIntegrationResultFilter", () => {
  const failed = { provider: "microsoft", ok: false, message: "Cancelled" };

  it("tells the same result once when it comes twice in a second", () => {
    const isNew = aldoIntegrationResultFilter();
    expect(isNew(failed, 1_000)).toBe(true);
    expect(isNew(failed, 1_400)).toBe(false);
    expect(isNew(failed, 2_500)).toBe(true);
  });

  it("tells a different result right away", () => {
    const isNew = aldoIntegrationResultFilter();
    expect(isNew(failed, 1_000)).toBe(true);
    expect(isNew({ ...failed, message: "Admin approval required" }, 1_100)).toBe(true);
    expect(isNew({ provider: "microsoft", ok: true, message: null }, 1_200)).toBe(true);
  });
});
