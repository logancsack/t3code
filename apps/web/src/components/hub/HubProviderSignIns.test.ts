import type { ProviderSignInList } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { describeProviderSignIn, providerSignInFor } from "./HubProviderSignIns";

const list: ProviderSignInList = {
  signIns: [
    { connector: "claude", version: 3, updatedAt: "2026-09-26T09:00:00.000Z" },
    { connector: "codex", version: 1, updatedAt: null },
  ],
};

describe("providerSignInFor", () => {
  it("finds the stored sign-in for a provider's connector", () => {
    expect(providerSignInFor(list, "claude")?.version).toBe(3);
    expect(providerSignInFor(list, "cursor")).toBeNull();
    expect(providerSignInFor(null, "claude")).toBeNull();
  });
});

describe("describeProviderSignIn", () => {
  it("says when the sign-in was saved when the platform knows", () => {
    vi.useFakeTimers({ now: new Date("2026-09-26T11:00:00.000Z") });
    try {
      expect(describeProviderSignIn("Claude", list.signIns[0]!)).toBe(
        "Your Claude sign-in is saved (2h ago). Every thread machine starts signed in.",
      );
      expect(describeProviderSignIn("Codex", list.signIns[1]!)).toBe(
        "Your Codex sign-in is saved. Every thread machine starts signed in.",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
