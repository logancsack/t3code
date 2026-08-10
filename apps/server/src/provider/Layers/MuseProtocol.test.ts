import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  filterMuseLaunchArgs,
  isMuseUserVisibleTaskKind,
  museOutputDelta,
  museTaskLifecycle,
  museTerminalRecord,
  parseMuseJsonLine,
} from "./MuseProtocol.ts";

const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const envelope = (payloadType: string, payload: Record<string, unknown>) =>
  encodeUnknownJson({
    schema_version: 1,
    id: "018f0000-0000-7000-8000-00000000c372",
    stream: { kind: "session", id: "33333333-3333-4333-8333-333333333333" },
    sequence: 19,
    recorded_at: 1_780_531_400_000_034,
    record_type: "status",
    durability: "ephemeral",
    causation_id: "96a206f2-8207-4f7a-9796-6b3fc98bcb22",
    payload_type: payloadType,
    payload_schema_version: 1,
    payload,
  });

describe("MuseProtocol", () => {
  it("only preserves bounded, non-authoritative launch tuning", () => {
    expect(
      filterMuseLaunchArgs(
        [
          "--max-model-steps=6",
          "--max-tool-output-bytes 8192",
          "--context-compaction-strategy prefix-extension-summary/v1",
          "--context-compaction-hard-threshold .9",
          "--disable-web-tools",
          "--yolo",
          "--sandbox-network enabled",
          "--workspace /",
          "--unknown-future-flag value",
        ].join(" "),
      ),
    ).toEqual([
      "--max-model-steps",
      "6",
      "--max-tool-output-bytes",
      "8192",
      "--context-compaction-strategy",
      "prefix-extension-summary/v1",
      "--context-compaction-hard-threshold",
      ".9",
      "--disable-web-tools",
    ]);
  });

  it("decodes output and terminal records from Muse JSONL", () => {
    const delta = parseMuseJsonLine(
      envelope("run.output.delta", { kind: "run_output_delta", text: "hello" }),
    );
    expect(delta.kind).toBe("event");
    if (delta.kind !== "event") return;
    expect(museOutputDelta(delta.event)).toBe("hello");

    const terminal = parseMuseJsonLine(
      envelope("run.terminal.completed", {
        kind: "run_terminal",
        terminal: "completed",
        text: "hello",
        reason: null,
      }),
    );
    expect(terminal.kind).toBe("event");
    if (terminal.kind !== "event") return;
    expect(museTerminalRecord(terminal.event)).toEqual({
      terminal: "completed",
      text: "hello",
    });
  });

  it("preserves non-JSON stdout as a diagnostic", () => {
    expect(parseMuseJsonLine("muse: starting")).toEqual({
      kind: "diagnostic",
      text: "muse: starting",
    });
  });

  it("extracts task lifecycle metadata and filters internal reminder/model tasks", () => {
    const parsed = parseMuseJsonLine(
      envelope("task.lifecycle.proposed", {
        task_id: "task-1",
        event: { kind: "proposed", task_id: "task-1", task_kind: "tool.workspace.shell" },
      }),
    );
    expect(parsed.kind).toBe("event");
    if (parsed.kind !== "event") return;
    expect(museTaskLifecycle(parsed.event)).toEqual({
      taskId: "task-1",
      lifecycle: "proposed",
      taskKind: "tool.workspace.shell",
    });
    expect(isMuseUserVisibleTaskKind("tool.workspace.shell")).toBe(true);
    expect(isMuseUserVisibleTaskKind("model.unknown.response")).toBe(false);
    expect(isMuseUserVisibleTaskKind("reminder.agent.plugin:verify-reminder")).toBe(false);
  });
});
