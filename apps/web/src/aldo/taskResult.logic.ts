/** The agent's completion report. It is evidence it reported, never proof
 * that Aldo independently checked an external action. Shared by both ends. */
export type TaskResult = {
  state: "finished" | "blocked_on_user" | "unfinished";
  doneWhen: { criterion: string; met: boolean; evidence: string }[];
  checked: string[];
  notChecked: string[];
  decided: { what: string; why: string; undo: string }[];
  /** A protocol problem Aldo found, separate from the agent's own words. */
  problem?: string;
};

const STATES = new Set(["finished", "blocked_on_user", "unfinished"]);
const RESULT_BLOCK =
  /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*aldo-result[ \t]*\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$)/g;
const NEXT_BLOCK =
  /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*aldo-next[ \t]*(?:\n[\s\S]*?)?(?:\n[ \t]*\2[ \t]*(?=\n|$)|$)/g;
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;
const list = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= 12 &&
  value.every((item) => text(item, 800) && item.trim());
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Bounded validation at the cloud boundary as well as in aldod. No coercion
 * of strings to booleans, no silent truncation of the agent's evidence. */
export function checkedTaskResult(value: unknown): TaskResult | null {
  if (
    !record(value) ||
    typeof value.state !== "string" ||
    !STATES.has(value.state) ||
    !list(value.checked) ||
    !list(value.notChecked)
  )
    return null;
  if (
    !Array.isArray(value.doneWhen) ||
    value.doneWhen.length > 12 ||
    !Array.isArray(value.decided) ||
    value.decided.length > 12
  )
    return null;
  if (
    !value.doneWhen.every(
      (item) =>
        record(item) &&
        text(item.criterion, 300) &&
        item.criterion.trim() &&
        typeof item.met === "boolean" &&
        text(item.evidence, 800),
    )
  )
    return null;
  if (
    !value.decided.every(
      (item) =>
        record(item) &&
        text(item.what, 400) &&
        item.what.trim() &&
        text(item.why, 400) &&
        text(item.undo, 400),
    )
  )
    return null;
  const result: TaskResult = {
    state: value.state as TaskResult["state"],
    doneWhen: value.doneWhen.map((item) => ({
      criterion: item.criterion,
      met: item.met,
      evidence: item.evidence,
    })),
    checked: [...value.checked],
    notChecked: [...value.notChecked],
    decided: value.decided.map((item) => ({ what: item.what, why: item.why, undo: item.undo })),
    ...(text(value.problem, 200) && value.problem ? { problem: value.problem } : {}),
  };
  if (
    result.state === "finished" &&
    (!result.doneWhen.length || result.doneWhen.some((item) => !item.met || !item.evidence.trim()))
  ) {
    result.state = "unfinished";
    result.problem =
      "Completion is unverified: a done-when line is missing, unmet or has no evidence.";
  }
  return result;
}

export function withoutTaskResult(value: string): string {
  return value.includes("aldo-result") ? value.replace(RESULT_BLOCK, "$1").trimEnd() : value;
}

/** Redact decoded fields too: a secret escaped inside JSON must not escape
 * the vault filter or break the report's JSON when replaced. */
export function redactTaskResult(result: TaskResult, hide: (text: string) => string): TaskResult {
  return {
    ...result,
    doneWhen: result.doneWhen.map((item) => ({
      ...item,
      criterion: hide(item.criterion),
      evidence: hide(item.evidence),
    })),
    checked: result.checked.map(hide),
    notChecked: result.notChecked.map(hide),
    decided: result.decided.map((item) => ({
      what: hide(item.what),
      why: hide(item.why),
      undo: hide(item.undo),
    })),
    ...(result.problem ? { problem: hide(result.problem) } : {}),
  };
}

/** A final question is waiting even when no formal question tool was used.
 * Offered next steps, quoted material and code are not requests to the user. */
export function endsOnQuestion(value: string): boolean {
  const prose = withoutTaskResult(value.replace(NEXT_BLOCK, "$1"))
    .replace(/(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g, "$1")
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .trim();
  return /[?？][\s*_~)\]”’"']*$/.test(prose);
}

/** Only the last report, placed at the end before optional next steps,
 * describes the answer. An example block earlier in a message does not. */
export function taskResultOf(value: string): TaskResult | null {
  const source = value.replace(NEXT_BLOCK, "$1").trimEnd();
  const last = [...source.matchAll(RESULT_BLOCK)].at(-1);
  if (!last || last.index + last[0].length !== source.length) {
    return /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*aldo-result(?:[ \t]*\n|$)/.test(
      last ? source.slice(last.index + last[0].length) : source,
    )
      ? {
          state: "unfinished",
          doneWhen: [],
          checked: [],
          notChecked: [],
          decided: [],
          problem: "The completion report is incomplete or misplaced; completion is unverified.",
        }
      : null;
  }
  let result: TaskResult | null = null;
  const body = last[3] ?? "";
  if (body.length <= 30_000) {
    try {
      result = checkedTaskResult(JSON.parse(body));
    } catch {}
  }
  result ??= {
    state: "unfinished",
    doneWhen: [],
    checked: [],
    notChecked: [],
    decided: [],
    problem: "The completion report is invalid; completion is unverified.",
  };
  if (endsOnQuestion(source) && result.state === "finished") {
    result.state = "blocked_on_user";
    result.problem = "The reply ends on a request, so the task is waiting rather than finished.";
  }
  return result;
}

/** Hide the final protocol block as it streams; examples earlier in prose stay visible. */
export function splitTaskResult(source: string): { text: string; result: TaskResult | null } {
  const result = taskResultOf(source);
  if (!result) return { text: source, result: null };
  const start = [
    ...source.matchAll(/(^|\n)[ \t]*(?:`{3,}|~{3,})[ \t]*aldo-result(?:[ \t]*\n|$)/g),
  ].at(-1)?.index;
  return { text: start === undefined ? source : source.slice(0, start).trimEnd(), result };
}
