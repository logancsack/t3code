// The right panel in a thread on work that isn't code (General, an Aldo
// project): what it needs first is the agent's browser and the files it makes,
// so those lead; the terminal, the diff, the subagents and a device follow
// under "More". Subagents are "Helpers" there, since "Agents" already means
// the threads.

const MORE = new Set(["Terminal", "Diff", "Agents", "Device"]);

const FOR_WORK: Record<string, { label?: string; description: string; shortcut?: string }> = {
  Files: { description: "What the agent made and works with." },
  Terminal: { description: "A shell on the agent's computer." },
  Diff: { description: "What changed in its files." },
  Agents: { label: "Helpers", description: "Follow the helpers its agent starts.", shortcut: "H" },
};

/** The surfaces in order for work that isn't code: the first ones, then the rest under "More" (relabeled). */
export function aldoSurfacesForWork<
  T extends { readonly label: string; readonly description?: string; readonly shortcut: string },
>(
  actions: ReadonlyArray<T>,
): { readonly first: ReadonlyArray<T>; readonly more: ReadonlyArray<T> } {
  const relabeled = actions.map((action) => {
    const work = FOR_WORK[action.label];
    if (!work) return action;
    return {
      ...action,
      label: work.label ?? action.label,
      shortcut: work.shortcut ?? action.shortcut,
      ...("description" in action ? { description: work.description } : {}),
    } as T;
  });
  return {
    first: relabeled.filter((_, index) => !MORE.has(actions[index]!.label)),
    more: relabeled.filter((_, index) => MORE.has(actions[index]!.label)),
  };
}
