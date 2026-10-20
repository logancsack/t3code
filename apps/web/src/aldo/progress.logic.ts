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

/** A second order in the step ("and publish the gigs"), not a noun that ends it ("delivery and price"). */
const AFTER_AND = /(\b(?:and|then)\s+)([A-Za-z]+)(?=\s+\S)/g;

/** Verbs that, after "and", are as often nouns ("logos and design briefs"). */
const NOUN_TOO = new Set([
  "design",
  "draft",
  "export",
  "research",
  "review",
  "search",
  "share",
  "test",
  "update",
]);

function underWay(word: string, afterAnd = false): string | null {
  if (afterAnd && NOUN_TOO.has(word.toLowerCase())) return null;
  const found = UNDER_WAY[word.toLowerCase()];
  if (!found) return null;
  return word[0] === word[0]!.toUpperCase() ? found[0]!.toUpperCase() + found.slice(1) : found;
}

/** A plan step as what's under way: "Set up your seller account and publish the gigs" becomes "Setting up your seller account and publishing the gigs". */
export function aldoStepUnderWay(step: string): string {
  const text = step
    .replace(/[`*_]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;:]+$/, "");
  const first = /^([A-Za-z]+)\b/.exec(text)?.[1];
  const head = first ? underWay(first) : null;
  if (!first || !head) return text;
  return (
    head +
    text.slice(first.length).replace(AFTER_AND, (match, joint: string, word: string) => {
      const verb = underWay(word, true);
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
  const step = index >= 0 ? aldoStepUnderWay(plan![index]!.step) : "";
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
