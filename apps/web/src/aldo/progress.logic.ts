// The working line in threads that aren't code: one line that says where the
// turn is, in words. With a plan (the agent's todo list, T3's
// `turn.plan.updated`): "Step 5 of 6 · Setting up your seller account ·
// 18 min". Without one: the step under way in plain words (workLabels.logic.ts)
// and the time, "Working on fiverr.com · 3 min". MessagesTimeline's working
// row shows it (AldoProgressLine.tsx).

export interface AldoPlanStep {
  readonly step: string;
  readonly status: "pending" | "inProgress" | "completed";
}

/** Time so far, as people say it: "40 sec", "18 min", "1 hr 12 min". Whole units, never ahead. */
export function aldoElapsedWords(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} hr ${rest} min` : `${hours} hr`;
}

// Plans name their steps as orders ("Set up your seller account"); the line
// says what's under way ("Setting up your seller account"). Common verbs only,
// so a step that starts any other way stays as written.
const UNDER_WAY: Record<string, string> = {
  add: "adding",
  analyze: "analyzing",
  animate: "animating",
  ask: "asking",
  build: "building",
  buy: "buying",
  calculate: "calculating",
  check: "checking",
  choose: "choosing",
  clean: "cleaning",
  collect: "collecting",
  compare: "comparing",
  compile: "compiling",
  confirm: "confirming",
  convert: "converting",
  create: "creating",
  deliver: "delivering",
  design: "designing",
  download: "downloading",
  draft: "drafting",
  edit: "editing",
  estimate: "estimating",
  explore: "exploring",
  export: "exporting",
  fill: "filling",
  find: "finding",
  finish: "finishing",
  gather: "gathering",
  generate: "generating",
  get: "getting",
  go: "going",
  identify: "identifying",
  install: "installing",
  look: "looking",
  make: "making",
  open: "opening",
  organize: "organizing",
  pick: "picking",
  prepare: "preparing",
  price: "pricing",
  produce: "producing",
  propose: "proposing",
  publish: "publishing",
  put: "putting",
  read: "reading",
  recommend: "recommending",
  register: "registering",
  render: "rendering",
  research: "researching",
  review: "reviewing",
  run: "running",
  save: "saving",
  search: "searching",
  send: "sending",
  set: "setting",
  share: "sharing",
  sign: "signing",
  start: "starting",
  submit: "submitting",
  suggest: "suggesting",
  summarize: "summarizing",
  test: "testing",
  translate: "translating",
  update: "updating",
  upload: "uploading",
  verify: "verifying",
  write: "writing",
};

/**
 * A second order in the step: a verb after "and" or "then" that takes what an
 * order does ("and publish the gigs", "then send it"). One followed by anything
 * else is as likely a noun ("upload and download speeds", "price ranges"), and
 * one that ends the step is one ("delivery and price").
 */
const AFTER_AND = /(\b(?:and|then)\s+)([A-Za-z]+)(?=\s+(\S+))/g;

/** Words an order's object starts with: "the gigs", "them", "up the account", "what sells". */
const OBJECT_START = new Set([
  "a",
  "all",
  "an",
  "any",
  "anything",
  "back",
  "both",
  "each",
  "every",
  "everything",
  "her",
  "him",
  "his",
  "how",
  "it",
  "its",
  "me",
  "my",
  "off",
  "our",
  "out",
  "some",
  "something",
  "that",
  "the",
  "their",
  "them",
  "these",
  "this",
  "those",
  "up",
  "us",
  "what",
  "whether",
  "which",
  "you",
  "your",
]);

function startsObject(word: string): boolean {
  return OBJECT_START.has(word.toLowerCase().replace(/[^a-z]+$/, "")) || /^[\d“"‘']/.test(word);
}

function underWay(word: string): string | null {
  const found = UNDER_WAY[word.toLowerCase()];
  if (!found) return null;
  return word[0] === word[0]!.toUpperCase() ? found[0]!.toUpperCase() + found.slice(1) : found;
}

/**
 * Markdown's marks around words (**all**, *new*, _draft_), not the same
 * characters inside names: Q4_report.xlsx, __init__.py and *.png stay whole.
 */
const EMPHASIS =
  /(^|[\s("'“‘])(\*\*|__|\*|_)(?=[^\s*_])(.+?)(?<=[^\s*_])\2(?=$|[\s)"'”’]|[.,;:!?](?!\w))/g;

/** The step's text without Markdown: a code span keeps what's inside it, untouched. */
function plainStep(step: string): string {
  return step
    .split(/(`[^`]+`)/)
    .map((part, index) => (index % 2 === 1 ? part.slice(1, -1) : part.replace(EMPHASIS, "$1$3")))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;:]+$/, "");
}

/** Programs that make a step a command line rather than words: "Run npm test". */
const PROGRAMS =
  /^(?:apt|apt-get|bash|brew|bun|bunx|cargo|cat|cd|chmod|cp|curl|deno|docker|ffmpeg|find|gh|git|go|grep|jest|kubectl|ls|make|mkdir|mv|node|npm|npx|pip3?|pnpm|pytest|python3?|rg|rm|rsync|scp|sed|sh|ssh|sudo|tar|tsc|unzip|uv|vercel|vitest|vp|wget|yarn|zsh)$/;

/**
 * A step that is a command line ("Run npm test", "Running `pnpm build`",
 * "Install it with `pip install pandas`"): the line says what's under way in
 * plain words instead.
 */
function commandShaped(step: string): boolean {
  const runs = (text: string) =>
    PROGRAMS.test(/^[\w./+-]+/.exec(text.trim())?.[0].split("/").pop() ?? "");
  // A code span with a program and what it's given; `git` alone is a name.
  const codes = [...step.matchAll(/`([^`]+)`/g)].map((code) => code[1]!.trim());
  if (codes.some((code) => /\s/.test(code) && runs(code))) return true;
  const ran = /^(?:run|running|execute|executing)\s+(\S+)/i.exec(plainStep(step));
  return (ran !== null && runs(ran[1]!)) || /&&|\|\||\s\|\s|(?:^|\s)--[a-z][\w-]*/.test(step);
}

/** A plan step as what's under way: "Set up your seller account and publish the gigs" becomes "Setting up your seller account and publishing the gigs". */
export function aldoStepUnderWay(step: string): string {
  const text = plainStep(step);
  const first = /^([A-Za-z]+)\b/.exec(text)?.[1];
  const head = first ? underWay(first) : null;
  if (!first || !head) return text;
  return (
    head +
    text
      .slice(first.length)
      .replace(AFTER_AND, (match, joint: string, word: string, next: string) => {
        const verb = startsObject(next) ? underWay(word) : null;
        return verb ? `${joint}${verb}` : match;
      })
  );
}

/** The step a plan is on: the one under way, else the next to do; null once every step is done. */
function currentStep(plan: ReadonlyArray<AldoPlanStep>): number {
  const inProgress = plan.findIndex((step) => step.status === "inProgress");
  return inProgress >= 0 ? inProgress : plan.findIndex((step) => step.status === "pending");
}

/**
 * Where the turn is, without the time: "Step 5 of 6 · Setting up your seller
 * account" from its plan, else `words` (the step under way in plain words),
 * else "Working".
 */
export function aldoProgressHead(
  plan: ReadonlyArray<AldoPlanStep> | null,
  words: string | null,
): string {
  const index = plan ? currentStep(plan) : -1;
  const raw = index >= 0 ? plan![index]!.step : "";
  // A step that is a command says, like a turn without a plan, what's under way in words.
  const step = !raw ? "" : commandShaped(raw) ? (words ?? "Working") : aldoStepUnderWay(raw);
  if (step && plan!.length > 1) return `Step ${index + 1} of ${plan!.length} · ${step}`;
  if (step) return step;
  return words ?? "Working";
}

/** The whole line: "Step 5 of 6 · Setting up your seller account · 18 min". */
export function aldoProgressLine(
  plan: ReadonlyArray<AldoPlanStep> | null,
  words: string | null,
  elapsedMs: number,
): string {
  return `${aldoProgressHead(plan, words)} · ${aldoElapsedWords(elapsedMs)}`;
}
