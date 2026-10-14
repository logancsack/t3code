import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../aldo/cloud", () => ({ isAldoCloud: true }));

import { readUsagePagePreferences, saveUsagePagePreferences } from "./usagePagePreferences";

describe("Aldo Usage page preferences", () => {
  it("opens on Cost the first time, since Aldo has no Limits tab", () => {
    expect(readUsagePagePreferences().metric).toBe("cost");
  });

  it("opens on Cost when Limits was picked before", () => {
    saveUsagePagePreferences({ metric: "limits", windowDays: 7 });
    expect(readUsagePagePreferences()).toEqual({ metric: "cost", windowDays: 7 });
  });

  it("keeps any other tab", () => {
    saveUsagePagePreferences({ metric: "tokens", windowDays: 90 });
    expect(readUsagePagePreferences()).toEqual({ metric: "tokens", windowDays: 90 });
  });
});
