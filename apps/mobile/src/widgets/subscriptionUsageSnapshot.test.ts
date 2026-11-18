import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { buildSubscriptionUsageSnapshot } from "./subscriptionUsageSnapshot";

const checkedAt = "2026-09-05T12:00:00.000Z";
const now = Date.parse(checkedAt);
const window = {
  id: "session",
  kind: "session",
  label: "5 hours",
  usedPercent: 40,
  resetsAt: "2026-09-05T12:10:00.000Z",
} as const;
const limits = { checkedAt, windows: [window] };
const deepLink = "t3code-dev://settings/usage?tab=limits";
function provider(overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated", email: "private@example.com" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits: limits,
    ...overrides,
  };
}
function presentations(providers: readonly ServerProvider[] = [provider()]) {
  return new Map([
    [
      EnvironmentId.make("env"),
      { entry: { target: { label: "Remote" } }, serverConfig: { providers } },
    ],
  ]);
}

it("keeps unavailable quotas distinct from zero usage and omits provider error messages", () => {
  const snapshot = buildSubscriptionUsageSnapshot(
    presentations([
      provider({
        usageLimits: {
          ...limits,
          unavailable: { reason: "probeFailed", message: "token secret" },
        },
      }),
    ]),
    deepLink,
  );
  expect(snapshot.providers[0]?.name).toBe("Codex");
  expect(snapshot.providers[0]?.windows).toEqual([]);
  expect(JSON.stringify(snapshot)).not.toContain("token secret");
  expect(JSON.stringify(snapshot)).not.toContain("private@example.com");
  expect(
    buildSubscriptionUsageSnapshot(
      presentations([
        provider({ usageLimits: { checkedAt, windows: [{ ...window, usedPercent: 0 }] } }),
      ]),
      deepLink,
    ).providers[0]?.windows[0]?.remaining,
  ).toBe(100);
});
