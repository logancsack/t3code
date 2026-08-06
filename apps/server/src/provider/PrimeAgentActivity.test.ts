import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  clearPrimeAgentSessionActivity,
  hasRunningPrimeAgentSubagents,
  hasRunningPrimeAgentSubagentsForThread,
  parsePrimeAgentSessionMetadata,
  updatePrimeAgentSubagentActivity,
} from "./PrimeAgentActivity.ts";

const sessionKey = "primeAgent:thread-1";
const threadId = ThreadId.make("thread-1");
const providerInstanceId = ProviderInstanceId.make("primeAgent");
const otherProviderInstanceId = ProviderInstanceId.make("primeAgent-work");
const meta = (id: string, status: string) => ({
  "ai.primeintellect.prime-agent": {
    subagents: [{ id, status }],
  },
});

afterEach(() => clearPrimeAgentSessionActivity(sessionKey));

describe("PrimeAgentActivity", () => {
  it("tracks only queued and running subagents until terminal metadata arrives", () => {
    updatePrimeAgentSubagentActivity(sessionKey, meta("child-1", "queued"), {
      threadId,
      providerInstanceId,
    });
    expect(hasRunningPrimeAgentSubagents()).toBe(true);
    expect(hasRunningPrimeAgentSubagentsForThread(threadId, providerInstanceId)).toBe(true);
    expect(hasRunningPrimeAgentSubagentsForThread(threadId, otherProviderInstanceId)).toBe(false);
    expect(hasRunningPrimeAgentSubagentsForThread(threadId, null)).toBe(true);
    expect(
      hasRunningPrimeAgentSubagentsForThread(ThreadId.make("thread-2"), providerInstanceId),
    ).toBe(false);

    updatePrimeAgentSubagentActivity(sessionKey, meta("child-1", "done"));
    expect(hasRunningPrimeAgentSubagents()).toBe(false);

    updatePrimeAgentSubagentActivity(sessionKey, meta("child-2", "running"));
    expect(hasRunningPrimeAgentSubagents()).toBe(true);
    expect(hasRunningPrimeAgentSubagentsForThread(threadId, null)).toBe(false);
    clearPrimeAgentSessionActivity(sessionKey);
    expect(hasRunningPrimeAgentSubagents()).toBe(false);
  });

  it("parses only Prime Agent namespaced session metadata", () => {
    expect(parsePrimeAgentSessionMetadata(meta("child-1", "running"))).toMatchObject({
      subagents: [{ id: "child-1", status: "running" }],
    });
    expect(parsePrimeAgentSessionMetadata({ subagents: [] })).toBeUndefined();
  });
});
