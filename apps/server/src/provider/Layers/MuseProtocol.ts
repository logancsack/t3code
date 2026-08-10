/**
 * Small, defensive decoder for `muse exec --json` records.
 *
 * Muse's JSONL stream is versioned by the CLI, but the package is not
 * published as a TypeScript dependency. Keep the boundary structural and
 * preserve unknown payload fields so a newer CLI can add records without
 * breaking an existing T3 Code build.
 */

import { tokenizeCliArgs } from "@t3tools/shared/cliArgs";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const decodeUnknownJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const MUSE_CONTEXT_COMPACTION_STRATEGIES = new Set([
  "summary-preserved-suffix/v1",
  "prefix-extension-summary/v1",
  "prefix-extension-inventory-summary/v1",
]);

const MUSE_SAFE_BOOLEAN_LAUNCH_ARGS = new Set([
  "--disable-web-tools",
  "--no-foreign-personal-context",
]);

const MUSE_SAFE_VALUE_LAUNCH_ARGS: Readonly<Record<string, (value: string) => boolean>> = {
  "--context-compaction-strategy": (value) => MUSE_CONTEXT_COMPACTION_STRATEGIES.has(value),
  "--context-compaction-soft-threshold": isMuseCompactionThreshold,
  "--context-compaction-hard-threshold": isMuseCompactionThreshold,
  "--max-model-steps": isPositiveInteger,
  "--max-tool-output-bytes": isPositiveInteger,
};

function isPositiveInteger(value: string): boolean {
  return /^[1-9]\d*$/u.test(value);
}

function isMuseCompactionThreshold(value: string): boolean {
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/u.test(value)) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1;
}

/**
 * Keep provider launch configuration useful without allowing it to replace
 * T3 Code's prompt, workspace, provider, session, or runtime safety policy.
 * Unknown options are deliberately dropped so a future Muse flag cannot
 * silently weaken an older T3 Code build's safety guarantees.
 */
export function filterMuseLaunchArgs(input: string | undefined): ReadonlyArray<string> {
  const tokens = tokenizeCliArgs(input);
  const filtered: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const equalsIndex = token.indexOf("=");
    const name = equalsIndex >= 0 ? token.slice(0, equalsIndex) : token;
    const inlineValue = equalsIndex >= 0 ? token.slice(equalsIndex + 1) : undefined;

    if (MUSE_SAFE_BOOLEAN_LAUNCH_ARGS.has(name)) {
      if (inlineValue === undefined) filtered.push(name);
      continue;
    }

    const validateValue = MUSE_SAFE_VALUE_LAUNCH_ARGS[name];
    if (!validateValue) continue;

    if (inlineValue !== undefined) {
      if (validateValue(inlineValue)) filtered.push(name, inlineValue);
      continue;
    }

    const next = tokens[index + 1];
    if (next === undefined || next.startsWith("-")) continue;
    index += 1;
    if (validateValue(next)) filtered.push(name, next);
  }

  return filtered;
}

export interface MuseJsonEvent {
  readonly schema_version: number;
  readonly id: string;
  readonly sequence: number;
  readonly recorded_at: number;
  readonly record_type: string;
  readonly durability: string;
  readonly causation_id?: string | null | undefined;
  readonly payload_type: string;
  readonly payload_schema_version: number;
  readonly stream: {
    readonly kind: string;
    readonly id: string;
  };
  readonly payload: Readonly<Record<string, unknown>>;
}

export type MuseJsonLine =
  | { readonly kind: "event"; readonly event: MuseJsonEvent }
  | { readonly kind: "diagnostic"; readonly text: string };

export interface MuseTerminalRecord {
  readonly terminal: string;
  readonly text?: string | undefined;
  readonly reason?: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseMuseJsonLine(line: string): MuseJsonLine {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return { kind: "diagnostic", text: "" };
  }

  const decoded = Option.getOrUndefined(decodeUnknownJson(trimmed));
  if (decoded === undefined) {
    return { kind: "diagnostic", text: trimmed };
  }

  if (!isRecord(decoded)) {
    return { kind: "diagnostic", text: trimmed };
  }
  const stream = decoded.stream;
  const payload = decoded.payload;
  if (
    decoded.schema_version !== 1 ||
    typeof decoded.id !== "string" ||
    typeof decoded.sequence !== "number" ||
    typeof decoded.recorded_at !== "number" ||
    typeof decoded.record_type !== "string" ||
    typeof decoded.durability !== "string" ||
    typeof decoded.payload_type !== "string" ||
    typeof decoded.payload_schema_version !== "number" ||
    !isRecord(stream) ||
    typeof stream.kind !== "string" ||
    typeof stream.id !== "string" ||
    !isRecord(payload)
  ) {
    return { kind: "diagnostic", text: trimmed };
  }

  return {
    kind: "event",
    event: {
      schema_version: decoded.schema_version,
      id: decoded.id,
      sequence: decoded.sequence,
      recorded_at: decoded.recorded_at,
      record_type: decoded.record_type,
      durability: decoded.durability,
      ...(typeof decoded.causation_id === "string" || decoded.causation_id === null
        ? { causation_id: decoded.causation_id }
        : {}),
      payload_type: decoded.payload_type,
      payload_schema_version: decoded.payload_schema_version,
      stream: {
        kind: stream.kind,
        id: stream.id,
      },
      payload,
    },
  };
}

export function museEventText(event: MuseJsonEvent): string | undefined {
  return typeof event.payload.text === "string" ? event.payload.text : undefined;
}

export function museOutputDelta(event: MuseJsonEvent): string | undefined {
  return event.payload_type === "run.output.delta" ? museEventText(event) : undefined;
}

export function museReasoningDelta(event: MuseJsonEvent): string | undefined {
  if (!event.payload_type.includes("reasoning") || !event.payload_type.endsWith(".delta")) {
    return undefined;
  }
  return museEventText(event);
}

export function musePlanDelta(event: MuseJsonEvent): string | undefined {
  if (!event.payload_type.includes("plan") || !event.payload_type.endsWith(".delta")) {
    return undefined;
  }
  return museEventText(event);
}

export function museTerminalRecord(event: MuseJsonEvent): MuseTerminalRecord | undefined {
  if (!event.payload_type.startsWith("run.terminal.")) {
    return undefined;
  }
  const terminal = nonEmptyString(event.payload.terminal) ?? event.payload_type.slice(13);
  const text = typeof event.payload.text === "string" ? event.payload.text : undefined;
  const reason = nonEmptyString(event.payload.reason);
  return {
    terminal,
    ...(text !== undefined ? { text } : {}),
    ...(reason !== undefined ? { reason } : {}),
  };
}

export function museTaskId(event: MuseJsonEvent): string | undefined {
  return nonEmptyString(event.payload.task_id);
}

export function museTaskLifecycle(event: MuseJsonEvent):
  | {
      readonly taskId: string;
      readonly lifecycle: string;
      readonly taskKind?: string | undefined;
      readonly operation?: string | undefined;
      readonly reason?: string | undefined;
    }
  | undefined {
  if (!event.payload_type.startsWith("task.lifecycle.")) {
    return undefined;
  }
  const taskId = museTaskId(event);
  const nestedEvent = isRecord(event.payload.event) ? event.payload.event : undefined;
  if (!taskId || !nestedEvent) {
    return undefined;
  }
  return {
    taskId,
    lifecycle: event.payload_type.slice("task.lifecycle.".length),
    ...(nonEmptyString(nestedEvent.task_kind)
      ? { taskKind: nonEmptyString(nestedEvent.task_kind) }
      : {}),
    ...(nonEmptyString(nestedEvent.operation)
      ? { operation: nonEmptyString(nestedEvent.operation) }
      : {}),
    ...(nonEmptyString(nestedEvent.reason) ? { reason: nonEmptyString(nestedEvent.reason) } : {}),
  };
}

/** Internal model/reminder work is intentionally hidden from the work log. */
export function isMuseUserVisibleTaskKind(taskKind: string): boolean {
  const normalized = taskKind.toLowerCase();
  if (normalized.startsWith("model.") || normalized.startsWith("reminder.")) {
    return false;
  }
  return (
    normalized.includes("tool") ||
    normalized.includes("shell") ||
    normalized.includes("command") ||
    normalized.includes("write") ||
    normalized.includes("edit") ||
    normalized.includes("patch") ||
    normalized.includes("web") ||
    normalized.includes("image") ||
    normalized.includes("agent") ||
    normalized.includes("workflow")
  );
}
