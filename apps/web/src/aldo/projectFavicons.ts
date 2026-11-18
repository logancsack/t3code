// Aldo: every thread has a machine of its own, and T3 keeps a project's icon
// per machine, so a thread whose machine is asleep (and can't serve it)
// showed its project's monogram instead of its icon. The icon is kept per
// project too (its repositories), and a machine without one of its own shows
// its project's.

import type {
  ProjectFaviconCache,
  ProjectFaviconTarget,
} from "@t3tools/client-runtime/project-favicon-cache";

import { getAldoEnvironments } from "./directory";

const STORAGE_KEY = "aldo:project-favicons";
/** Icons kept, the least recently seen dropped first (each a small data URL). */
const MOST_ICONS = 24;

function load(): Map<string, string> {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(stored)) return new Map();
    return new Map(
      stored.filter(
        (entry): entry is [string, string] =>
          Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string",
      ),
    );
  } catch {
    return new Map();
  }
}

function save(icons: ReadonlyMap<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...icons]));
  } catch {
    // Storage full or unavailable: the per-machine cache still works.
  }
}

/** The project a machine's icon belongs to: its repositories, folder and icon path (none in General). */
function projectKeyOf(target: ProjectFaviconTarget): string | null {
  const machine = getAldoEnvironments()?.find(
    (entry) => entry.environmentId === target.environmentId,
  );
  const repos = machine ? (machine.repos ?? [machine.repo]).filter((ref) => ref.length > 0) : [];
  if (repos.length === 0) return null;
  return JSON.stringify([repos.join(","), target.cwd, target.faviconPath ?? null]);
}

/** T3's icon cache, falling back to the icon of the machine's project. */
export function aldoProjectFaviconCache(cache: ProjectFaviconCache): ProjectFaviconCache {
  let icons: Map<string, string> | null = null;
  const projectIcon = (target: ProjectFaviconTarget) => {
    const key = projectKeyOf(target);
    return key ? ((icons ??= load()).get(key) ?? null) : null;
  };
  const remember = (target: ProjectFaviconTarget, dataUrl: string) => {
    const key = projectKeyOf(target);
    if (!key) return;
    const known = (icons ??= load());
    if (known.get(key) === dataUrl) return;
    known.delete(key);
    known.set(key, dataUrl);
    for (const oldest of known.keys()) {
      if (known.size <= MOST_ICONS) break;
      known.delete(oldest);
    }
    save(known);
  };
  return {
    ...cache,
    peek: (target) => cache.peek(target) ?? projectIcon(target),
    resolve: async (target, url, signal) => {
      const resolved = await cache.resolve(target, url, signal);
      if (resolved?.startsWith("data:image/")) remember(target, resolved);
      return resolved ?? projectIcon(target);
    },
  };
}
