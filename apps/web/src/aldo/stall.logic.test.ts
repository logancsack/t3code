import { describe, expect, it } from "vite-plus/test";

import {
  ALDO_STALL_AFTER_MS,
  ALDO_WAITING_WORDS,
  aldoStalledMinutes,
  aldoStallQuestion,
  aldoThreadProgress,
} from "./stall.logic";
import { aldoWorkingWords } from "./workLabels.logic";

const START = Date.parse("2026-10-13T10:00:00.000Z");
const at = (minutes: number) => new Date(START + minutes * 60_000).toISOString();

function message(
  role: "user" | "assistant",
  createdAt: string,
  fields: { updatedAt?: string; streaming?: boolean; text?: string } = {},
) {
  return {
    role,
    text: fields.text ?? "",
    streaming: fields.streaming ?? false,
    createdAt,
    updatedAt: fields.updatedAt ?? createdAt,
  };
}

describe("aldoThreadProgress", () => {
  it("takes the latest of the thread's activities and its agent's messages", () => {
    expect(
      aldoThreadProgress(
        [{ createdAt: at(1) }, { createdAt: at(3) }, { createdAt: at(2) }],
        [message("assistant", at(0), { updatedAt: at(2) })],
      ).at,
    ).toBe(at(3));
    expect(
      aldoThreadProgress(
        [{ createdAt: at(1) }],
        [message("assistant", at(1), { updatedAt: at(5) })],
      ).at,
    ).toBe(at(5));
  });

  it("leaves out the user's own messages, which aren't the agent's progress", () => {
    expect(
      aldoThreadProgress([{ createdAt: at(1) }], [message("user", at(9), { text: "Nudge" })]).at,
    ).toBe(at(1));
  });

  it("changes its key as words stream in, though their record keeps one time", () => {
    const before = aldoThreadProgress(
      [],
      [message("assistant", at(1), { streaming: true, text: "Look" })],
    );
    const after = aldoThreadProgress(
      [],
      [message("assistant", at(1), { streaming: true, text: "Looking at it" })],
    );
    expect(after.at).toBe(before.at);
    expect(after.key).not.toBe(before.key);
  });

  it("has nothing to go on in an empty thread", () => {
    expect(aldoThreadProgress([], [])).toEqual({ at: null, key: "|0" });
    expect(aldoThreadProgress([{ createdAt: "not a time" }], []).at).toBeNull();
  });
});

describe("aldoStalledMinutes", () => {
  const now = (minutes: number) => START + minutes * 60_000;

  it("says nothing before four minutes without progress", () => {
    expect(aldoStalledMinutes({ at: at(0), startedAt: null, seenAt: null, now: now(3.9) })).toBe(
      null,
    );
    expect(ALDO_STALL_AFTER_MS).toBe(4 * 60_000);
  });

  it("counts whole minutes once it has been four", () => {
    expect(aldoStalledMinutes({ at: at(0), startedAt: null, seenAt: null, now: now(4) })).toBe(4);
    expect(aldoStalledMinutes({ at: at(0), startedAt: null, seenAt: null, now: now(9.9) })).toBe(9);
  });

  it("counts from the turn's start when the thread's last activity came before it", () => {
    expect(
      aldoStalledMinutes({ at: at(0), startedAt: at(10), seenAt: null, now: now(13) }),
    ).toBeNull();
    expect(aldoStalledMinutes({ at: at(0), startedAt: at(10), seenAt: null, now: now(15) })).toBe(
      5,
    );
  });

  it("clears as soon as the page sees something new, whatever the records' clock says", () => {
    expect(
      aldoStalledMinutes({ at: at(0), startedAt: at(0), seenAt: now(8), now: now(9) }),
    ).toBeNull();
    expect(aldoStalledMinutes({ at: at(0), startedAt: at(0), seenAt: now(8), now: now(12) })).toBe(
      4,
    );
  });

  it("says nothing with no time to count from", () => {
    expect(aldoStalledMinutes({ at: null, startedAt: null, seenAt: null, now: now(60) })).toBe(
      null,
    );
    expect(
      aldoStalledMinutes({ at: "garbage", startedAt: null, seenAt: null, now: now(60) }),
    ).toBeNull();
  });
});

describe("the stall's words", () => {
  it("knows the working line's words for an open ask, which isn't a stall", () => {
    const ask = {
      label: "MCP tool call",
      tone: "tool" as const,
      itemType: "mcp_tool_call" as const,
      toolTitle: "aldo · needs_you_now",
      toolLifecycleStatus: "inProgress" as const,
      toolData: {
        type: "mcpToolCall",
        id: "x",
        server: "aldo",
        tool: "needs_you_now",
        status: "inProgress",
        arguments: { reason: "A quick check on OpenTable" },
      },
    };
    expect(aldoWorkingWords([ask])).toBe(ALDO_WAITING_WORDS);
  });

  it("asks Aldo about this thread in plain words", () => {
    expect(aldoStallQuestion(6)).toBe(
      "This thread has made no progress for 6 minutes. What's it stuck on?",
    );
  });
});
