// @vitest-environment jsdom

import { describe, expect, it, vi } from "vite-plus/test";

const profile = vi.hoisted(() => ({ value: null as object | null }));
vi.mock("./api", () => ({ isAldoCloud: true }));
vi.mock("./assistantApi", () => ({
  requestAldoProfile: async () => profile.value,
  saveAldoInterests: async () => null,
}));

// Another account on this browser told the welcome something without code.
window.localStorage.setItem("aldo:simple:welcome", "on");
const { useAldoOnboarding } = await import("./onboarding");
const { useAldoSimple } = await import("./simpleMode");

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("simple mode's default from the welcome", () => {
  it("shows as it was here until the account's read", () => {
    expect(useAldoSimple.getState().on).toBe(true);
  });

  it("keeps it when the account couldn't be read", async () => {
    useAldoOnboarding.setState({ onboarding: null });
    await settle();
    expect(window.localStorage.getItem("aldo:simple:welcome")).toBe("on");
    expect(useAldoSimple.getState().on).toBe(true);
  });

  it("drops another account's answer on an Aldo without the welcome", async () => {
    profile.value = { id: "user_2", email: "sam@example.com", onboarding: null };
    useAldoOnboarding.setState({ onboarding: undefined });
    useAldoOnboarding.setState({ onboarding: null });
    await settle();
    expect(window.localStorage.getItem("aldo:simple:welcome")).toBeNull();
    expect(useAldoSimple.getState().on).toBe(false);
  });

  it("follows an answer, and an account never asked", async () => {
    useAldoOnboarding.setState({ onboarding: { onboardedAt: "2026-10-20", interests: ["media"] } });
    expect(useAldoSimple.getState().on).toBe(true);
    expect(window.localStorage.getItem("aldo:simple:welcome")).toBe("on");
    useAldoOnboarding.setState({ onboarding: { onboardedAt: "2026-10-01", interests: null } });
    expect(useAldoSimple.getState().on).toBe(false);
    expect(window.localStorage.getItem("aldo:simple:welcome")).toBeNull();
  });
});
