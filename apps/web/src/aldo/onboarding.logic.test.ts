import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { fetchAldoProfile } from "./assistantApi";
import {
  aldoDeveloperToolsShown,
  aldoFirstName,
  aldoInterestsFrom,
  aldoOnboardingFrom,
  aldoSimpleByDefault,
  aldoWelcomeShows,
} from "./onboarding.logic";
import { ALDO_SETTINGS_NAV, aldoSettingsNav } from "./settings.logic";
import { simpleModeFrom } from "./simpleMode.logic";
import { aldoSurfacesForWork } from "./surfaces";

const account = {
  id: "user_1",
  email: "maya@example.com",
  name: "Maya Ortiz",
  imageUrl: null,
  manageUrl: "/account",
  signOutUrl: "/sign-out",
};

describe("the welcome shows only when Aldo says it's waiting", () => {
  it("reads Aldo's account: waiting, answered, skipped, and an older Aldo without it", () => {
    expect(aldoOnboardingFrom({ ...account, onboardedAt: null, interests: null })).toEqual({
      onboardedAt: null,
      interests: null,
    });
    expect(
      aldoOnboardingFrom({ onboardedAt: "2026-10-20T10:00:00.000Z", interests: ["code"] }),
    ).toEqual({ onboardedAt: "2026-10-20T10:00:00.000Z", interests: ["code"] });
    expect(aldoOnboardingFrom({ onboardedAt: "2026-10-20T10:00:00.000Z", interests: [] })).toEqual({
      onboardedAt: "2026-10-20T10:00:00.000Z",
      interests: [],
    });
    // An older Aldo: no onboardedAt at all.
    expect(aldoOnboardingFrom(account)).toBeNull();
    for (const body of [null, "html", 7, { onboardedAt: 1 }, { onboardedAt: "" }]) {
      expect(aldoOnboardingFrom(body)).toBeNull();
    }
  });

  it("asks only for a waiting answer, never while it's unknown or on an older Aldo", () => {
    expect(aldoWelcomeShows({ onboardedAt: null, interests: null })).toBe(true);
    expect(aldoWelcomeShows({ onboardedAt: "2026-10-20T10:00:00.000Z", interests: [] })).toBe(
      false,
    );
    expect(aldoWelcomeShows(undefined)).toBe(false);
    expect(aldoWelcomeShows(null)).toBe(false);
  });

  it("keeps known interests once each, in the welcome's order", () => {
    expect(aldoInterestsFrom(["code", "media", "spreadsheets", "media", 3])).toEqual([
      "media",
      "code",
    ]);
    expect(aldoInterestsFrom("code")).toBeNull();
    expect(aldoInterestsFrom(null)).toBeNull();
  });

  it("calls them by their first name, or not at all", () => {
    expect(aldoFirstName("  Maya   Ortiz ")).toBe("Maya");
    expect(aldoFirstName("")).toBeNull();
    expect(aldoFirstName(null)).toBeNull();
  });
});

describe("the account read", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const answer = (body: unknown) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );

  it("carries the welcome's state from an Aldo that has it", async () => {
    answer({ ...account, onboardedAt: null, interests: null });
    expect((await fetchAldoProfile())?.onboarding).toEqual({ onboardedAt: null, interests: null });
  });

  it("has none from an older Aldo, so nothing changes", async () => {
    answer(account);
    const profile = await fetchAldoProfile();
    expect(profile?.email).toBe("maya@example.com");
    expect(profile?.onboarding).toBeNull();
  });
});

describe("simple mode", () => {
  it("follows the welcome's answer until the user sets it", () => {
    expect(simpleModeFrom(null, ["business", "media"])).toBe(true);
    expect(simpleModeFrom(null, [])).toBe(true);
    expect(simpleModeFrom(null, ["research", "code"])).toBe(false);
    // Accounts from before the welcome, and an answer not known yet: off, as before.
    expect(simpleModeFrom(null, null)).toBe(false);
    expect(simpleModeFrom(undefined)).toBe(false);
  });

  it("keeps the user's own choice either way", () => {
    expect(simpleModeFrom("off", ["business"])).toBe(false);
    expect(simpleModeFrom("on", ["code"])).toBe(true);
    expect(simpleModeFrom("on", null)).toBe(true);
    expect(aldoSimpleByDefault(["documents"])).toBe(true);
  });
});

describe("the developer tools", () => {
  it("show for code, a git host, and accounts from before the welcome", () => {
    expect(aldoDeveloperToolsShown({ interests: null, gitHost: null })).toBe(true);
    expect(aldoDeveloperToolsShown({ interests: ["code"], gitHost: false })).toBe(true);
    expect(aldoDeveloperToolsShown({ interests: ["business"], gitHost: true })).toBe(true);
    expect(aldoDeveloperToolsShown({ interests: ["business"], gitHost: false })).toBe(false);
    expect(aldoDeveloperToolsShown({ interests: [], gitHost: false })).toBe(false);
  });

  it("wait, unknown, until the account and its git hosts are read", () => {
    expect(aldoDeveloperToolsShown({ interests: undefined, gitHost: null })).toBeUndefined();
    expect(aldoDeveloperToolsShown({ interests: undefined, gitHost: true })).toBeUndefined();
    expect(aldoDeveloperToolsShown({ interests: [], gitHost: null })).toBeUndefined();
    expect(aldoDeveloperToolsShown({ interests: ["code"], gitHost: null })).toBe(true);
  });

  const actions = ["Browser", "Files", "Terminal", "Diff", "Agents"].map((label) => ({
    label,
    shortcut: label[0]!,
  }));

  it("leave the Terminal and the Diff out of a thread without them", () => {
    const without = aldoSurfacesForWork(actions, { developer: false });
    expect([...without.first, ...without.more].map((a) => a.label)).toEqual([
      "Browser",
      "Files",
      "Helpers",
    ]);
    const shown = aldoSurfacesForWork(actions, { developer: true });
    expect(shown.more.map((a) => a.label)).toEqual(["Terminal", "Diff", "Helpers"]);
    // Callers that don't say keep them.
    expect(aldoSurfacesForWork(actions).more.map((a) => a.label)).toContain("Terminal");
  });

  it("leave Code out of the settings nav without them", () => {
    const paths = (developer: boolean) =>
      aldoSettingsNav({ developer }).flatMap((group) => group.items.map((item) => item.to));
    expect(paths(false)).not.toContain("/settings/code");
    expect(paths(false)).toContain("/settings/general");
    expect(paths(true)).toContain("/settings/code");
    expect(aldoSettingsNav({ developer: true })).toBe(ALDO_SETTINGS_NAV);
  });
});
