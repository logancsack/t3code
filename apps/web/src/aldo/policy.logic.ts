// Settings → Permissions: the rules agents follow (homeApi.ts AldoPolicyView) as
// choices, the user's own for all their workspaces, and where a workspace
// answered otherwise. An undecided rule is one an agent asks about the first
// time it comes up; one with a default (paying past the plans, long
// conversations, accounts and publishing in their name) does that until the
// user changes it.

import { type AldoPolicy, type AldoPolicyPath, type AldoPolicyView } from "./homeApi";
import { repoShortName } from "./places.logic";

/** A rule no one has answered: an agent asks. */
export const ALDO_UNDECIDED = "undecided";
/** What a picker calls a rule no one has answered: what happens then. */
export const ALDO_UNDECIDED_LABEL = "Ask me the first time";
/** A workspace's choice that follows the user's own. */
export const ALDO_SAME_AS_EVERYWHERE = "everywhere";

export type AldoPolicyRuleId =
  | "merge"
  | "reviews"
  | "spendThreshold"
  | "paidFallback"
  | "onProviderLimit"
  | "contextBudget"
  | "mediaRouting"
  | "accounts"
  | "publishing";

export interface AldoPolicyOption {
  readonly value: string;
  readonly label: string;
}

interface RuleSpec {
  readonly clear: AldoPolicyPath;
  /** The server's name for a rule newer than the policy page: shown only where Aldo says it takes it. */
  readonly requires?: string;
  /** What the rule does while undecided, for one with a default. */
  readonly fallback?: string;
  /** Its picker's word for undecided, where "Ask me the first time" isn't what happens. */
  readonly undecided?: string;
  readonly options: ReadonlyArray<AldoPolicyOption>;
  /** A value of the user's that isn't one of the options (an amount an agent recorded). */
  readonly label?: (value: string) => string;
  readonly read: (policy: AldoPolicy) => string | undefined;
  readonly set: (value: string) => AldoPolicy | null;
}

const dollars = (value: string) => `Up to $${Number(value).toLocaleString("en-US")}`;
const tokens = (value: string) => {
  const n = Number(value);
  return n >= 1_000_000 ? `${n / 1_000_000}M tokens` : `${Math.round(n / 1000)}k tokens`;
};

const ALDO_POLICY_RULES: Readonly<Record<AldoPolicyRuleId, RuleSpec>> = {
  merge: {
    clear: ["merge"],
    options: [
      { value: "auto", label: "When checks pass" },
      { value: "approve", label: "I merge them" },
    ],
    read: (p) => p.merge,
    set: (v) => (v === "auto" || v === "approve" ? { merge: v } : null),
  },
  reviews: {
    clear: ["reviews"],
    options: [
      { value: "important", label: "Fix what matters, answer the rest" },
      { value: "all", label: "Fix every one" },
    ],
    read: (p) => p.reviews,
    set: (v) => (v === "all" || v === "important" ? { reviews: v } : null),
  },
  spendThreshold: {
    clear: ["spendThreshold"],
    options: [
      { value: "0", label: "Always ask" },
      ...[5, 20, 50, 100, 250].map((n) => ({ value: String(n), label: dollars(String(n)) })),
    ],
    label: (v) => (Number(v) === 0 ? "Always ask" : dollars(v)),
    read: (p) => (p.spendThreshold === undefined ? undefined : String(p.spendThreshold)),
    set: (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? { spendThreshold: n } : null;
    },
  },
  paidFallback: {
    clear: ["modelRouting"],
    fallback: "never",
    options: [
      { value: "never", label: "Never" },
      { value: "authorized", label: "Yes" },
    ],
    read: (p) => p.modelRouting?.paidFallback,
    set: (v) =>
      v === "never" || v === "authorized" ? { modelRouting: { paidFallback: v } } : null,
  },
  onProviderLimit: {
    clear: ["onProviderLimit"],
    // The thread waits, and asks whoever opens it.
    undecided: "Ask me",
    options: [
      { value: "switch", label: "Switch to another model" },
      { value: "wait", label: "Wait for the reset" },
    ],
    read: (p) => p.onProviderLimit,
    set: (v) => (v === "wait" || v === "switch" ? { onProviderLimit: v } : null),
  },
  contextBudget: {
    clear: ["contextBudget"],
    fallback: "300000",
    options: [
      { value: "100000", label: "Short" },
      { value: "200000", label: "Medium" },
      { value: "300000", label: "Standard (default)" },
      { value: "500000", label: "Long" },
      { value: "1000000", label: "Longest" },
    ],
    label: tokens,
    read: (p) => (p.contextBudget === undefined ? undefined : String(p.contextBudget)),
    set: (v) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= 100_000 && n <= 1_000_000 ? { contextBudget: n } : null;
    },
  },
  mediaRouting: {
    clear: ["mediaRouting"],
    options: [
      { value: "auto", label: "Agents choose" },
      { value: "ask", label: "Show me the options" },
    ],
    read: (p) => p.mediaRouting,
    set: (v) => (v === "auto" || v === "ask" ? { mediaRouting: v } : null),
  },
  accounts: {
    clear: ["accounts"],
    requires: "accounts",
    fallback: "when_asked",
    options: [
      { value: "when_asked", label: "When I ask" },
      { value: "ask_first", label: "Ask me first" },
      { value: "never", label: "Never" },
    ],
    read: (p) => p.accounts,
    set: (v) => (v === "when_asked" || v === "ask_first" || v === "never" ? { accounts: v } : null),
  },
  publishing: {
    clear: ["publishing"],
    requires: "publishing",
    fallback: "when_asked",
    options: [
      { value: "when_asked", label: "When I ask" },
      { value: "show_first", label: "Show me first" },
    ],
    read: (p) => p.publishing,
    set: (v) => (v === "when_asked" || v === "show_first" ? { publishing: v } : null),
  },
};

/**
 * Whether to show a rule: the ones the policy page started with on any Aldo
 * that has it, a newer one only once Aldo says it takes it (an older Aldo
 * would refuse the change).
 */
export function aldoRuleShown(
  view: Pick<AldoPolicyView, "rules"> | null | undefined,
  rule: AldoPolicyRuleId,
): boolean {
  const requires = ALDO_POLICY_RULES[rule].requires;
  if (requires === undefined) return true;
  return Array.isArray(view?.rules) && view.rules.includes(requires);
}

/** The user's choice for a rule: theirs, the rule's default, or undecided. */
export function aldoRuleValue(rule: AldoPolicyRuleId, policy: AldoPolicy): string {
  const spec = ALDO_POLICY_RULES[rule];
  return spec.read(policy) ?? spec.fallback ?? ALDO_UNDECIDED;
}

/**
 * What a rule's picker offers: undecided first for one without a default (or,
 * for a workspace, following the user's own), and a value an agent recorded
 * that isn't among the usual ones.
 */
export function aldoRuleOptions(
  rule: AldoPolicyRuleId,
  current: string,
  options: { readonly workspace?: boolean } = {},
): ReadonlyArray<AldoPolicyOption> {
  const spec = ALDO_POLICY_RULES[rule];
  const first: AldoPolicyOption[] = options.workspace
    ? [{ value: ALDO_SAME_AS_EVERYWHERE, label: "Same as everywhere" }]
    : spec.fallback === undefined
      ? [{ value: ALDO_UNDECIDED, label: spec.undecided ?? ALDO_UNDECIDED_LABEL }]
      : [];
  const known = spec.options.some((option) => option.value === current);
  const recorded =
    known || current === ALDO_UNDECIDED || current === ALDO_SAME_AS_EVERYWHERE || !spec.label
      ? []
      : [{ value: current, label: spec.label(current) }];
  // Only amounts are recorded outside the options: they go in order.
  const list =
    recorded.length > 0
      ? [...spec.options, ...recorded].toSorted((a, b) => Number(a.value) - Number(b.value))
      : spec.options;
  return [...first, ...list];
}

/** The label a picker shows for a value. */
export function aldoRuleLabel(rule: AldoPolicyRuleId, value: string): string {
  if (value === ALDO_SAME_AS_EVERYWHERE) return "Same as everywhere";
  return aldoRuleOptions(rule, value).find((option) => option.value === value)?.label ?? value;
}

export interface AldoPolicyEdit {
  readonly repos?: ReadonlyArray<string>;
  readonly set?: AldoPolicy;
  readonly clear?: ReadonlyArray<AldoPolicyPath>;
}

/** Preview the same clear-then-merge edit the server saves; its answer remains authoritative. */
export function optimisticPolicyEdit(view: AldoPolicyView, edit: AldoPolicyEdit): AldoPolicyView {
  const apply = (policy: AldoPolicy): AldoPolicy => {
    const next: Record<string, unknown> = { ...structuredClone(policy) };
    for (const [key, child] of edit.clear ?? []) {
      if (child === undefined) delete next[key];
      else if (next[key] && typeof next[key] === "object")
        delete (next[key] as Record<string, unknown>)[child];
    }
    for (const [key, value] of Object.entries(edit.set ?? {})) {
      next[key] =
        value && typeof value === "object"
          ? { ...(next[key] as object | undefined), ...value }
          : value;
    }
    return next as AldoPolicy;
  };
  if (!edit.repos?.length) {
    const decided = new Set(Object.keys(edit.set?.mergeMethod ?? {}));
    return {
      ...view,
      everywhere: apply(view.everywhere),
      workspaces: view.workspaces.map((workspace) => ({
        ...workspace,
        policy: {
          ...workspace.policy,
          ...(workspace.policy.mergeMethod
            ? {
                mergeMethod: Object.fromEntries(
                  Object.entries(workspace.policy.mergeMethod).filter(
                    ([repo]) => !decided.has(repo),
                  ),
                ),
              }
            : {}),
        },
      })),
    };
  }
  const key = (repos: ReadonlyArray<string>) => [...repos].sort().join("\n");
  return {
    ...view,
    workspaces: view.workspaces.map((workspace) =>
      key(workspace.repos) === key(edit.repos!)
        ? { ...workspace, policy: apply(workspace.policy) }
        : workspace,
    ),
  };
}

/** The change a choice makes: for all the user's workspaces, or one (`repos`). */
export function aldoRuleEdit(
  rule: AldoPolicyRuleId,
  value: string,
  repos?: ReadonlyArray<string>,
): AldoPolicyEdit | null {
  const spec = ALDO_POLICY_RULES[rule];
  const where = repos ? { repos } : {};
  if (value === ALDO_UNDECIDED || value === ALDO_SAME_AS_EVERYWHERE) {
    return { ...where, clear: [spec.clear] };
  }
  const set = spec.set(value);
  return set ? { ...where, set } : null;
}

/**
 * A workspace by its repositories' short names, "aldo + t3code", where its
 * project's name (`names`, as the sidebar shows it) isn't known.
 */
export function aldoWorkspaceLabel(
  repos: ReadonlyArray<string>,
  names?: ReadonlyMap<string, string>,
): string {
  return names?.get(repos.join(",")) ?? repos.map((repo) => repoShortName(repo)).join(" + ");
}

export interface AldoPolicyDifference {
  readonly repos: ReadonlyArray<string>;
  readonly value: string;
}

/**
 * Workspaces whose own answer to a rule isn't what the user's own comes to
 * (their answer, or the rule's default), with that answer.
 */
export function aldoRuleDifferences(
  view: AldoPolicyView,
  rule: AldoPolicyRuleId,
): ReadonlyArray<AldoPolicyDifference> {
  const spec = ALDO_POLICY_RULES[rule];
  const everywhere = aldoRuleValue(rule, view.everywhere);
  return view.workspaces.flatMap((workspace) => {
    const value = spec.read(workspace.policy);
    return value !== undefined && value !== everywhere ? [{ repos: workspace.repos, value }] : [];
  });
}

export const ALDO_MERGE_METHODS: ReadonlyArray<AldoPolicyOption> = [
  { value: "squash", label: "Squash" },
  { value: "merge", label: "Merge commit" },
  { value: "rebase", label: "Rebase" },
];

export interface AldoMergeMethod {
  readonly repo: string;
  /** The user's own for it, or what every workspace that recorded one agrees on, or undecided. */
  readonly value: string;
  /** Workspaces that recorded another (agents record it with the workspace they're in). */
  readonly differences: ReadonlyArray<AldoPolicyDifference>;
}

/** Each repository's merge method, decided ones first. */
export function aldoMergeMethods(view: AldoPolicyView): ReadonlyArray<AldoMergeMethod> {
  const rows = view.repos.map((repo): AldoMergeMethod => {
    const recorded = view.workspaces.flatMap((w) => {
      const value = w.policy.mergeMethod?.[repo];
      return value === undefined ? [] : [{ repos: w.repos, value }];
    });
    const agreed =
      new Set(recorded.map((w) => w.value)).size === 1 ? recorded[0]?.value : undefined;
    const value = view.everywhere.mergeMethod?.[repo] ?? agreed ?? ALDO_UNDECIDED;
    return { repo, value, differences: recorded.filter((w) => w.value !== value) };
  });
  const decided = (row: AldoMergeMethod) =>
    row.value === ALDO_UNDECIDED && row.differences.length === 0 ? 1 : 0;
  return rows.toSorted((a, b) => decided(a) - decided(b) || a.repo.localeCompare(b.repo));
}

const isMergeMethod = (value: string) =>
  ALDO_MERGE_METHODS.some((option) => option.value === value);

/**
 * The changes choosing a repository's merge method makes. It's the
 * repository's, so the choice is for every workspace it's in: the user's own
 * for it (Aldo drops the workspaces' own), or, undecided, clearing it there
 * and in each workspace that has one. A workspace (`repos`) can still have its
 * own, or follow the user's again.
 */
export function aldoMergeMethodEdits(
  view: AldoPolicyView,
  repo: string,
  value: string,
  repos?: ReadonlyArray<string>,
): ReadonlyArray<AldoPolicyEdit> {
  const clear: AldoPolicyPath = ["mergeMethod", repo];
  if (repos) {
    if (value === ALDO_SAME_AS_EVERYWHERE) return [{ repos, clear: [clear] }];
    return isMergeMethod(value) ? [{ repos, set: { mergeMethod: { [repo]: value } } }] : [];
  }
  if (value !== ALDO_UNDECIDED) {
    return isMergeMethod(value) ? [{ set: { mergeMethod: { [repo]: value } } }] : [];
  }
  return [
    ...(view.everywhere.mergeMethod?.[repo] !== undefined ? [{ clear: [clear] }] : []),
    ...view.workspaces
      .filter((w) => w.policy.mergeMethod?.[repo] !== undefined)
      .map((w) => ({ repos: w.repos, clear: [clear] })),
  ];
}

export const ALDO_MEDIA_TASKS: ReadonlyArray<AldoPolicyOption> = [
  { value: "image", label: "Images" },
  { value: "image.edit", label: "Image edits" },
  { value: "video", label: "Video" },
  { value: "video.edit", label: "Video edits" },
  { value: "speech", label: "Speech" },
  { value: "transcription", label: "Transcription" },
  { value: "music", label: "Music" },
  { value: "sound", label: "Sound effects" },
  { value: "3d", label: "3D" },
];

export interface AldoMediaDefault {
  readonly task: string;
  readonly label: string;
  /** Null where a workspace has none, over the user's own. */
  readonly tool: string | null;
  /** The workspace it's for, or undefined for all the user's workspaces. */
  readonly repos?: ReadonlyArray<string>;
}

const isTool = (tool: unknown): tool is string => typeof tool === "string" && tool.trim() !== "";

/**
 * The tools the user named for kinds of media, in the order the kinds are
 * listed, each followed by the workspaces that have another (or none).
 */
export function aldoMediaDefaults(view: AldoPolicyView): ReadonlyArray<AldoMediaDefault> {
  return ALDO_MEDIA_TASKS.flatMap((task) => {
    const own = view.everywhere.mediaDefaults?.[task.value];
    const everywhere: AldoMediaDefault[] = isTool(own)
      ? [{ task: task.value, label: task.label, tool: own }]
      : [];
    const workspaces = view.workspaces.flatMap((w): AldoMediaDefault[] => {
      const tool = w.policy.mediaDefaults?.[task.value];
      if (isTool(tool) && tool !== own) {
        return [{ task: task.value, label: task.label, tool, repos: w.repos }];
      }
      // No tool here only matters over one of the user's own.
      return tool === null && isTool(own)
        ? [{ task: task.value, label: task.label, tool: null, repos: w.repos }]
        : [];
    });
    return [...everywhere, ...workspaces];
  });
}
