import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";

import { applyClaudeRuntimeAuthenticationState } from "./ClaudeDriver.ts";

const readyClaudeProvider: ServerProvider = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  driver: ProviderDriverKind.make("claudeAgent"),
  displayName: "Claude",
  enabled: true,
  installed: true,
  version: "2.1.226",
  status: "ready",
  auth: {
    status: "authenticated",
    type: "max",
    label: "Claude Max Subscription",
  },
  checkedAt: "2026-08-08T18:58:33.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};

it("latches a runtime authentication failure into the provider snapshot", () => {
  expect(applyClaudeRuntimeAuthenticationState(readyClaudeProvider, true)).toMatchObject({
    status: "error",
    auth: {
      status: "unauthenticated",
      type: "max",
      label: "Claude Max Subscription",
    },
    message:
      "Your Claude sign-in expired. Reconnect Claude to retry the last message automatically.",
  });
});

it("leaves a healthy provider snapshot unchanged", () => {
  expect(applyClaudeRuntimeAuthenticationState(readyClaudeProvider, false)).toBe(
    readyClaudeProvider,
  );
});
