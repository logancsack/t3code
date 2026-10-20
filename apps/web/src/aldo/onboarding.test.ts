import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const save = vi.hoisted(() => vi.fn());
vi.mock("./assistantApi", () => ({
  requestAldoProfile: async () => null,
  saveAldoInterests: save,
}));

import { saveAldoOnboarding, useAldoOnboarding } from "./onboarding";
import { aldoWelcomeShows } from "./onboarding.logic";

const waiting = { onboardedAt: null, interests: null };
const at = "2026-10-20T10:00:00.000Z";

beforeEach(() => {
  save.mockReset();
  useAldoOnboarding.setState({ onboarding: waiting });
});

describe("answering the welcome", () => {
  it("ends it at once, then keeps what Aldo kept", async () => {
    let finish!: (value: unknown) => void;
    save.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const saved = saveAldoOnboarding(["business", "media"]);
    expect(aldoWelcomeShows(useAldoOnboarding.getState().onboarding)).toBe(false);
    expect(useAldoOnboarding.getState().onboarding?.interests).toEqual(["business", "media"]);
    finish({ onboardedAt: at, interests: ["business", "media"] });
    expect(await saved).toBe(true);
    expect(useAldoOnboarding.getState().onboarding).toEqual({
      onboardedAt: at,
      interests: ["business", "media"],
    });
    expect(save).toHaveBeenCalledWith(["business", "media"]);
  });

  it("a skip is an empty answer", async () => {
    save.mockResolvedValueOnce({ onboardedAt: at, interests: [] });
    await saveAldoOnboarding([]);
    expect(save).toHaveBeenCalledWith([]);
    expect(useAldoOnboarding.getState().onboarding).toEqual({ onboardedAt: at, interests: [] });
  });

  it("a failed save doesn't bring the welcome back on this page", async () => {
    save.mockRejectedValueOnce(new Error("offline"));
    expect(await saveAldoOnboarding(["research"])).toBe(false);
    expect(aldoWelcomeShows(useAldoOnboarding.getState().onboarding)).toBe(false);
  });
});

describe("changing it in settings", () => {
  it("puts back what was there when it fails", async () => {
    useAldoOnboarding.setState({ onboarding: { onboardedAt: at, interests: ["code"] } });
    save.mockRejectedValueOnce(new Error("offline"));
    expect(await saveAldoOnboarding(["code", "media"], { revert: true })).toBe(false);
    expect(useAldoOnboarding.getState().onboarding).toEqual({
      onboardedAt: at,
      interests: ["code"],
    });
  });

  it("sends changes one at a time, so Aldo keeps the latest", async () => {
    useAldoOnboarding.setState({ onboarding: { onboardedAt: at, interests: [] } });
    let first!: (value: unknown) => void;
    save.mockReturnValueOnce(new Promise((resolve) => (first = resolve)));
    save.mockResolvedValueOnce({ onboardedAt: at, interests: ["finance", "media"] });
    const earlier = saveAldoOnboarding(["finance"], { revert: true });
    const later = saveAldoOnboarding(["finance", "media"], { revert: true });
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    first({ onboardedAt: at, interests: ["finance"] });
    // Aldo's answer to the first doesn't undo the second while it's on its way.
    expect(await earlier).toBe(true);
    expect(useAldoOnboarding.getState().onboarding?.interests).toEqual(["finance", "media"]);
    expect(await later).toBe(true);
    expect(save.mock.calls).toEqual([[["finance"]], [["finance", "media"]]]);
    expect(useAldoOnboarding.getState().onboarding?.interests).toEqual(["finance", "media"]);
  });

  it("goes back to what Aldo last kept when the changes after it fail", async () => {
    useAldoOnboarding.setState({ onboarding: { onboardedAt: at, interests: ["code"] } });
    save.mockRejectedValueOnce(new Error("offline"));
    save.mockRejectedValueOnce(new Error("offline"));
    const earlier = saveAldoOnboarding(["code", "media"], { revert: true });
    const later = saveAldoOnboarding(["code", "media", "research"], { revert: true });
    expect(await earlier).toBe(false);
    expect(await later).toBe(false);
    expect(useAldoOnboarding.getState().onboarding?.interests).toEqual(["code"]);

    save.mockResolvedValueOnce({ onboardedAt: at, interests: ["code", "media"] });
    save.mockRejectedValueOnce(new Error("offline"));
    const kept = saveAldoOnboarding(["code", "media"], { revert: true });
    const lost = saveAldoOnboarding(["media"], { revert: true });
    expect(await kept).toBe(true);
    expect(await lost).toBe(false);
    expect(useAldoOnboarding.getState().onboarding?.interests).toEqual(["code", "media"]);
  });
});
