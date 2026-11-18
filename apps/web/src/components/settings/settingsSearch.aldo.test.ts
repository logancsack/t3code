import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../aldo/api", () => ({ isAldoCloud: true }));

const { filterAvailableSettingsSearchItems } = await import("./settingsSearch");

const availability = {
  hasCloudPublicConfig: false,
  hasEnvironment: true,
  hasProviderSettingsEnvironment: true,
  hasMacProviderSettingsEnvironment: false,
  canManageLocalBackend: false,
  isWslSettingsRowVisible: false,
  hasThreadAutoSettlement: false,
};

const ids = (more: Partial<Parameters<typeof filterAvailableSettingsSearchItems>[0]>) =>
  filterAvailableSettingsSearchItems({ ...availability, ...more });

describe("Aldo's settings search", () => {
  it("finds Code's rows only with the developer tools", () => {
    const code = (items: ReturnType<typeof ids>) =>
      items.filter((item) => item.to === "/settings/code").map((item) => item.id);
    expect(code(ids({ aldoDeveloperTools: true }))).toEqual(
      expect.arrayContaining(["aldo-environments", "diff-layout"]),
    );
    expect(code(ids({ aldoDeveloperTools: false }))).toEqual([]);
  });

  it("finds accounts and publishing in your name only where Aldo takes them", () => {
    const found = (items: ReturnType<typeof ids>) =>
      items
        .filter((item) => item.id === "aldo-accounts" || item.id === "aldo-publishing")
        .map((item) => item.id);
    expect(found(ids({ aldoPolicyRules: ["merge", "accounts", "publishing"] }))).toEqual([
      "aldo-accounts",
      "aldo-publishing",
    ]);
    expect(found(ids({ aldoPolicyRules: ["merge", "accounts"] }))).toEqual(["aldo-accounts"]);
    expect(found(ids({ aldoPolicyRules: ["merge"] }))).toEqual([]);
    expect(found(ids({}))).toEqual([]);
    // The rules the page has always had are found on any Aldo.
    expect(ids({}).some((item) => item.id === "aldo-spend-threshold")).toBe(true);
  });

  it("finds what they hand Aldo only where Aldo keeps it", () => {
    const interests = (items: ReturnType<typeof ids>) =>
      items.some((item) => item.id === "aldo-interests");
    expect(interests(ids({ hasAldoOnboarding: true }))).toBe(true);
    expect(interests(ids({ hasAldoOnboarding: false }))).toBe(false);
    expect(interests(ids({}))).toBe(false);
  });
});
