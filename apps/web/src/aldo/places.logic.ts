// Where a thread works, as the user picks it (AldoPlacePicker): General (in no
// project), one of their projects (an Aldo project, or repositories), or a new
// one. A place is its repositories, the main one first; General has none.

/** A project's tile and name, as the sidebar shows them (ProjectFavicon's slice of a project). */
export interface AldoPlaceProject {
  readonly environmentId: string;
  readonly workspaceRoot: string;
  readonly title: string;
  readonly faviconPath?: string | null | undefined;
  readonly projectIcon?: unknown;
}

export interface AldoPlace<TProject = AldoPlaceProject> {
  /** Its repositories, the main one first; none for General. */
  readonly repos: ReadonlyArray<string>;
  readonly name: string;
  /** What it is: "No project", "Aldo project", "Repository", "Repositories · aldo, t3code". */
  readonly detail: string;
  /** When one of its threads on this device last changed (ISO), null when none has. */
  readonly activeAt: string | null;
  /** One of its machines' projects, for its tile; null when none is loaded. */
  readonly project: TProject | null;
}

export const GENERAL_NAME = "General";

export function placeKey(repos: ReadonlyArray<string>): string {
  return repos.join(",");
}

/** "gitlab:group/app" → "app"; "aldo:podcast-clips" → "podcast-clips"; "owner/repo" → "repo". */
export function repoShortName(ref: string): string {
  const path = ref
    .replace(/^(gitlab|bitbucket|azure|aldo):/, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  return path.split("/").at(-1) || ref;
}

export function placeDetail(repos: ReadonlyArray<string>): string {
  if (repos.length === 0) return "No project";
  if (repos.length === 1) return repos[0]!.startsWith("aldo:") ? "Aldo project" : "Repository";
  return `Repositories · ${repos.map(repoShortName).join(", ")}`;
}

export function generalPlace<TProject>(project: TProject | null = null): AldoPlace<TProject> {
  return { repos: [], name: GENERAL_NAME, detail: placeDetail([]), activeAt: null, project };
}

/**
 * The user's projects as places, most recently active first: one per set of
 * repositories their machines work in (named as the sidebar names their
 * project), then the Aldo projects they have no machine for. General isn't
 * among them: the picker pins it on top.
 */
export function buildAldoPlaces<TProject>(input: {
  /** The directory's machines with their repositories (none: General). */
  readonly machines: ReadonlyArray<{
    readonly environmentId: string;
    readonly repos: ReadonlyArray<string>;
  }>;
  /** The sidebar's projects, each with the machines it groups. */
  readonly groups: ReadonlyArray<{
    readonly name: string;
    readonly project: TProject;
    readonly environmentIds: ReadonlyArray<string>;
  }>;
  /** When each machine's threads last changed (ISO). */
  readonly activity: ReadonlyMap<string, string>;
  /** Aldo's own projects (`aldo:<slug>`), from the repository directory. */
  readonly aldoProjects: ReadonlyArray<{ readonly ref: string; readonly name: string }>;
}): Array<AldoPlace<TProject>> {
  const reposByMachine = new Map(
    input.machines.map((machine) => [machine.environmentId, machine.repos] as const),
  );
  const places = new Map<string, AldoPlace<TProject>>();
  const latest = (left: string | null, right: string | null) =>
    left === null ? right : right === null ? left : left > right ? left : right;
  for (const group of input.groups) {
    const repos = group.environmentIds
      .map((environmentId) => reposByMachine.get(environmentId))
      .find((found) => found !== undefined);
    if (!repos || repos.length === 0) continue;
    const activeAt = group.environmentIds.reduce<string | null>(
      (at, environmentId) => latest(at, input.activity.get(environmentId) ?? null),
      null,
    );
    const key = placeKey(repos);
    const known = places.get(key);
    places.set(
      key,
      known
        ? { ...known, activeAt: latest(known.activeAt, activeAt) }
        : { repos, name: group.name, detail: placeDetail(repos), activeAt, project: group.project },
    );
  }
  for (const { ref, name } of input.aldoProjects) {
    if (places.has(ref)) continue;
    places.set(ref, {
      repos: [ref],
      name,
      detail: placeDetail([ref]),
      activeAt: null,
      project: null,
    });
  }
  return [...places.values()].toSorted(
    (left, right) =>
      (right.activeAt ?? "").localeCompare(left.activeAt ?? "") ||
      left.name.localeCompare(right.name),
  );
}

function folded(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Places whose name or repositories contain what's typed. */
export function filterAldoPlaces<TPlace extends AldoPlace<unknown>>(
  places: ReadonlyArray<TPlace>,
  query: string,
): ReadonlyArray<TPlace> {
  const q = folded(query.trim());
  if (!q) return places;
  return places.filter((place) => folded(`${place.name} ${place.repos.join(" ")}`).includes(q));
}

/** Whether General answers to what's typed. */
export function generalMatches(query: string): boolean {
  const q = folded(query.trim());
  return !q || folded(`${GENERAL_NAME} no project`).includes(q);
}

/** Whether a place is already called what's typed (so it isn't offered as a new project). */
export function namesAPlace(places: ReadonlyArray<AldoPlace<unknown>>, query: string): boolean {
  const q = folded(query.trim());
  return (
    q === folded(GENERAL_NAME) ||
    places.some((place) => folded(place.name) === q || place.repos.some((ref) => folded(ref) === q))
  );
}

/** A typed repository ref or a pasted URL, if it looks like one. */
export function typedRepositoryRef(query: string): string | null {
  const text = query
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  if (/^(?:https?:\/\/)?(github\.com|gitlab\.com|bitbucket\.org|dev\.azure\.com)\//.test(text))
    return text;
  if (/^(gitlab|bitbucket|azure):[^\s]+\/[^\s]+$/.test(text) || /^[\w.-]+\/[\w.-]+$/.test(text))
    return text;
  if (/^aldo:[a-z0-9-]+$/.test(text)) return text;
  return null;
}

/** "Podcast Clips!" → "podcast-clips": an Aldo project's slug, as Aldo makes it from the title. */
export function aldoProjectSlug(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 44)
    .replace(/-+$/, "");
  return slug || "project";
}

const TITLE_MAX = 80;

/** A draft's title before it has one: the first line of what's typed (none: it's untitled). */
export function draftTitle(prompt: string): string | null {
  const line = prompt
    .split("\n")
    .map((part) => part.replace(/\s+/g, " ").trim())
    .find((part) => part.length > 0);
  if (!line) return null;
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1).trimEnd()}…` : line;
}

/**
 * What a sent thread's agent is asked when the user moves the conversation:
 * a handoff (`continue_in_new_thread` with `move`), as a thread's project
 * never changes once it starts. A new project is created first.
 */
export function aldoMoveMessage(
  target:
    | { readonly name: string; readonly repos: ReadonlyArray<string> }
    | { readonly create: string },
): string {
  const carry =
    "with a brief that carries what the new thread needs from this conversation (the task, what's decided, what's done and what's left, and the files it should copy over) and a title for it";
  if ("create" in target) {
    return `Move this thread to a new Aldo project, "${target.create}": create it with create_project, then call continue_in_new_thread with move set and the project's repos, ${carry}.`;
  }
  const where = target.repos.length === 0 ? "General, outside any project" : target.name;
  return `Move this thread to ${where}: call continue_in_new_thread with move set and repos ${JSON.stringify(target.repos)}, ${carry}.`;
}
