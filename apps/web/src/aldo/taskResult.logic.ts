/** The agent's completion report. It is evidence it reported, never proof
 * that Aldo independently checked an external action. Shared by both ends. */
const TASK_RESULT_SCHEMA = 1;

export type TaskResult = {
  schemaVersion?: 1;
  state: "finished" | "blocked_on_user" | "unfinished";
  doneWhen: { criterion: string; met: boolean; evidence: string }[];
  checked: string[];
  notChecked: string[];
  decided: { what: string; why: string; undo: string }[];
  ask?: { question: string; options: string[] };
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
    (value.schemaVersion !== undefined && value.schemaVersion !== TASK_RESULT_SCHEMA) ||
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
  if (
    value.state === "unfinished" &&
    Array.isArray(value.doneWhen) &&
    !value.doneWhen.length &&
    /^(?:The completion report is (?:invalid|incomplete or misplaced|missing); completion is unverified\.)$/.test(
      String(value.problem),
    )
  )
    return null;
  const result: TaskResult = {
    ...(value.schemaVersion === TASK_RESULT_SCHEMA ? { schemaVersion: TASK_RESULT_SCHEMA } : {}),
    state: value.state as TaskResult["state"],
    ...(record(value.ask) &&
    text(value.ask.question, 300) &&
    Array.isArray(value.ask.options) &&
    value.ask.options.length >= 2 &&
    value.ask.options.length <= 4 &&
    value.ask.options.every((o) => text(o, 100) && o.trim())
      ? { ask: { question: value.ask.question, options: value.ask.options as string[] } }
      : {}),
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

/** A final question is waiting even when no formal question tool was used.
 * Offered next steps, quoted material and code are not requests to the user. */
export function endsOnRequest(value: string): boolean {
  const prose = withoutTaskResult(value.replace(NEXT_BLOCK, "$1"))
    .replace(/(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g, "$1")
    .split("\n")
    .filter(
      (line) => !/^\s*>/.test(line) && !/^\s*!?\[[^\]]+\]\([^)]*\)(?:\s*[-—–].*)?\s*$/.test(line),
    )
    .join("\n")
    .trim();
  if (/[?？][\s*_~)\]”’"']*$/.test(prose)) return true;
  const ending = prose.split(/\n\s*\n/).at(-1) ?? "";
  // A question followed by its terms, or an explicit final instruction to
  // the user, is still an ask. Quoted text, code and follow-up chips above
  // remain excluded. Do not infer an ask just from "not checked" or a URL.
  return (
    /\b(?:(?:do|would|could|can|will) you|(?:should|may|can) I)\b[^?？]*[?？]/i.test(ending) ||
    /(?:^|[.!]\s+)(?:please (?:provide|send|confirm|approve|choose|tell)|let me know|tell me|reply (?:yes|with)|say ["“]?(?:yes|approve))\b/i.test(
      ending,
    ) ||
    /\b(?:waiting|stopping|paused|blocked)\b[^.!?]{0,100}\b(?:your (?:yes|approval|confirmation|answer)|you (?:approve|confirm|answer))\b/i.test(
      ending,
    )
  );
}

type TaskReport = {
  status: "missing" | "valid" | "invalid" | "unsupported";
  version: number | null;
  result: TaskResult | null;
};

/** Only the final report is evidence. Unsupported or malformed formats are
 * unknown, never a negative task verdict, even after the format was supplied. */
function taskReportOf(value: string): TaskReport {
  const source = value.replace(NEXT_BLOCK, "$1").trimEnd();
  const last = [...source.matchAll(RESULT_BLOCK)].at(-1);
  if (!last || last.index + last[0].length !== source.length) {
    const open = /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*aldo-result(?:[ \t]*\n|$)/.test(
      last ? source.slice(last.index + last[0].length) : source,
    );
    return { status: open ? "invalid" : "missing", version: null, result: null };
  }
  let raw: unknown = null;
  const body = last[3] ?? "";
  if (body.length <= 300_000)
    try {
      raw = JSON.parse(body);
    } catch {}
  const version =
    record(raw) && Number.isSafeInteger(raw.schemaVersion) && Number(raw.schemaVersion) > 0
      ? Number(raw.schemaVersion)
      : null;
  if (version !== null && version !== TASK_RESULT_SCHEMA)
    return { status: "unsupported", version, result: null };
  const result = checkedTaskResult(raw);
  if (!result) return { status: "invalid", version, result: null };
  if (endsOnRequest(source) && result.state === "finished") {
    result.state = "blocked_on_user";
    result.problem = "The reply ends on a request, so the task is waiting rather than finished.";
  }
  return { status: "valid", version: version ?? TASK_RESULT_SCHEMA, result };
}

export function taskResultOf(value: string): TaskResult | null {
  return taskReportOf(value).result;
}

/** Hide only the trailing protocol payload, including an unreadable report. */
export function splitTaskResult(source: string): { text: string; result: TaskResult | null } {
  const report = taskReportOf(source);
  if (report.status === "missing") return { text: source, result: null };
  const start = [
    ...source.matchAll(/(^|\n)[ \t]*(?:`{3,}|~{3,})[ \t]*aldo-result(?:[ \t]*\n|$)/g),
  ].at(-1)?.index;
  return {
    text: start === undefined ? source : source.slice(0, start).trimEnd(),
    result: report.result,
  };
}
