import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_TERMINAL_ID } from "@t3tools/contracts";

import { nextTerminalId } from "./terminalLabels.ts";

describe("nextTerminalId", () => {
  it("allocates term-1 when no terminals are listed yet", () => {
    expect(nextTerminalId([])).toBe(DEFAULT_TERMINAL_ID);
  });

  it("allocates term-2 when only term-1 exists", () => {
    expect(nextTerminalId([DEFAULT_TERMINAL_ID])).toBe("term-2");
  });

  it("skips over taken term-N slots", () => {
    expect(nextTerminalId([DEFAULT_TERMINAL_ID, "term-2", "term-3"])).toBe("term-4");
    expect(nextTerminalId([DEFAULT_TERMINAL_ID, "term-3"])).toBe("term-2");
    expect(nextTerminalId(["term-2", "term-3"])).toBe("term-1");
  });

  it("ignores blank/whitespace-only ids", () => {
    expect(nextTerminalId(["", "  ", DEFAULT_TERMINAL_ID])).toBe("term-2");
    expect(nextTerminalId(["", "  "])).toBe("term-1");
  });
});
