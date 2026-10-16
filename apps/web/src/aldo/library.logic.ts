// The Library: what a thread's agents made and shared, newest first, grouped
// Today, This week and Older. What it made comes from each turn's changed
// files (made.logic.ts); what's shared, from Aldo's list of shares (GET
// /api/shares), matched to the thread by its computer where Aldo says which
// one, or else by the link its share_file step recorded. The Library lists
// every share the same way.

import {
  aldoMadeKind,
  aldoTurnMade,
  type AldoMadeItem,
  type AldoMadeKind,
  type AldoShare,
} from "./made.logic";

/** A share as Aldo lists it. */
export interface AldoShareView {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly contentType: string;
  readonly bytes: number;
  /** Anyone with the link can open it; otherwise only the user, signed in. */
  readonly public: boolean;
  readonly views: number;
  readonly createdAt: string;
  /** The computer of the thread it came from (an older Aldo leaves it out). */
  readonly environmentId?: string;
  /** That thread's repositories: none for General, `aldo:<slug>` for a project (an older Aldo leaves it out). */
  readonly repos?: ReadonlyArray<string>;
}

/** Aldo's list, with anything it doesn't recognize left out; null when it isn't a list (an older Aldo). */
export function parseAldoShares(value: unknown): AldoShareView[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((raw): AldoShareView[] => {
    const share = raw as Partial<Record<keyof AldoShareView, unknown>> | null;
    if (
      !share ||
      typeof share.id !== "string" ||
      typeof share.url !== "string" ||
      typeof share.createdAt !== "string"
    ) {
      return [];
    }
    const environmentId =
      typeof share.environmentId === "string" && share.environmentId ? share.environmentId : null;
    // A thread that's gone has no computer and no repositories to say where it came from.
    const repos =
      environmentId && Array.isArray(share.repos)
        ? share.repos.filter((repo): repo is string => typeof repo === "string")
        : null;
    return [
      {
        id: share.id,
        title: typeof share.title === "string" && share.title.trim() ? share.title : "Shared file",
        url: share.url,
        contentType: typeof share.contentType === "string" ? share.contentType : "",
        bytes: typeof share.bytes === "number" ? share.bytes : 0,
        public: share.public !== false,
        views: typeof share.views === "number" ? share.views : 0,
        createdAt: share.createdAt,
        ...(environmentId ? { environmentId } : {}),
        ...(repos ? { repos } : {}),
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// When

export type AldoLibraryWhen = "today" | "week" | "older";

export const ALDO_LIBRARY_WHEN_LABEL: Record<AldoLibraryWhen, string> = {
  today: "Today",
  week: "This week",
  older: "Older",
};

/** Today (since midnight, here), this week (the six days before), or older. */
export function aldoLibraryWhen(at: string, now: Date): AldoLibraryWhen {
  const time = Date.parse(at);
  if (!Number.isFinite(time)) return "older";
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (time >= today.getTime()) return "today";
  const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  return time >= weekAgo.getTime() ? "week" : "older";
}

/** Newest first, in the groups that have something. */
export function aldoLibraryGroups<T>(
  items: ReadonlyArray<T>,
  atOf: (item: T) => string,
  now: Date,
): Array<{ readonly when: AldoLibraryWhen; readonly label: string; readonly items: T[] }> {
  const sorted = items.toSorted((a, b) => timeOf(atOf(b)) - timeOf(atOf(a)));
  const groups = (["today", "week", "older"] as const).map((when) => ({
    when,
    label: ALDO_LIBRARY_WHEN_LABEL[when],
    items: [] as T[],
  }));
  for (const item of sorted) {
    groups.find((group) => group.when === aldoLibraryWhen(atOf(item), now))!.items.push(item);
  }
  return groups.filter((group) => group.items.length > 0);
}

function timeOf(at: string): number {
  const time = Date.parse(at);
  return Number.isFinite(time) ? time : 0;
}

// ---------------------------------------------------------------------------
// Labels

const KIND_BY_TYPE: Record<string, AldoMadeKind> = {
  "text/html": "page",
  "application/pdf": "pdf",
  "text/csv": "sheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "sheet",
  "application/vnd.ms-excel": "sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/msword": "document",
  "text/plain": "document",
  "text/markdown": "document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "deck",
  "application/vnd.ms-powerpoint": "deck",
};

/** What a shared file is, by its type; null for one that's none of the kinds (a zip, data). */
export function aldoShareKind(contentType: string): AldoMadeKind | null {
  const type = contentType.split(";")[0]!.trim().toLowerCase();
  const known = KIND_BY_TYPE[type];
  if (known) return known;
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return null;
}

/** Who can open a share, in a word, and in a sentence. */
export function aldoShareAudience(share: Pick<AldoShareView, "public">): {
  readonly label: string;
  readonly detail: string;
} {
  return share.public
    ? { label: "Public link", detail: "Anyone with the link can open it." }
    : { label: "Only you", detail: "Only you can open it, signed in to Aldo." };
}

/** "Opened 3 times", or nothing before anyone has. */
export function aldoShareViews(views: number): string | null {
  if (!(views > 0)) return null;
  return views === 1 ? "Opened once" : `Opened ${views.toLocaleString()} times`;
}

/** "lisbon-trip" → "Lisbon trip": a project's slug is made from its title. */
function titleOfSlug(slug: string): string {
  const words = slug.replace(/[-_]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : slug;
}

/**
 * Where a share came from, by its thread's repositories: General (none), an
 * Aldo project (`aldo:<slug>`) or a repository by its name. Null when Aldo
 * doesn't say.
 */
export function aldoShareProject(
  repos: ReadonlyArray<string> | undefined,
): { readonly key: string; readonly label: string } | null {
  if (!repos) return null;
  const main = repos[0]?.trim() ?? "";
  if (!main || main === "aldo:general") return { key: "", label: "General" };
  if (main.startsWith("aldo:")) return { key: main, label: titleOfSlug(main.slice(5)) };
  const name = main
    .replace(/^[a-z-]+:/, "")
    .split("/")
    .at(-1);
  return { key: main, label: name || main };
}

// ---------------------------------------------------------------------------
// A thread's library

/** `https://aldo.example/s/<id>` → `<id>`, so a recorded link finds its share whatever the host. */
export function aldoShareIdOf(url: string): string | null {
  try {
    const match = /^\/s\/([^/]+)\/?$/.exec(new URL(url).pathname);
    return match ? decodeURIComponent(match[1]!) : null;
  } catch {
    return null;
  }
}

export interface AldoLibraryItem {
  readonly key: string;
  /** Its share's title, or its file name. */
  readonly name: string;
  /** The file's name, when that isn't what it's called. */
  readonly fileName: string | null;
  readonly kind: AldoMadeKind | null;
  /** Relative to the thread's folder, when it's a file there: it opens beside the thread. */
  readonly path: string | null;
  /** When it was made, or shared. */
  readonly at: string;
  /** Whether it's shared by link (Aldo's list, or the agent's record where there's no list). */
  readonly shared: boolean;
  /** Its share, as Aldo lists it, while it's shared. */
  readonly share: AldoShareView | null;
  /** The link the agent recorded, where Aldo's list can't say more. */
  readonly url: string | null;
}

/** Slack for a share recorded a little after its turn's checkpoint. */
const TURN_SLACK_MS = 2 * 60_000;

/**
 * Everything a thread made (each turn's files, newest turn first, a file once)
 * and shared. `shares` is Aldo's list, or null where it couldn't be read; a
 * file whose share was stopped then shows as made, not shared. A turn's share
 * is found in the list by the link its step recorded, or else (an agent that
 * doesn't record the reply) by its title among those made during the turn.
 * `elsewhere` is the rest of what an Aldo that doesn't say where each share
 * came from listed: shown apart, as the user's agents'.
 */
export function aldoThreadLibrary(input: {
  readonly turns: ReadonlyArray<{
    readonly turnId: string;
    readonly completedAt: string;
    readonly files: ReadonlyArray<{
      readonly path: string;
      readonly additions: number;
      readonly deletions: number;
    }>;
  }>;
  readonly sharesByTurn: ReadonlyMap<string, ReadonlyArray<AldoShare>>;
  readonly workspaceRoot: string | undefined;
  readonly shares: ReadonlyArray<AldoShareView> | null;
  readonly environmentId: string;
}): { readonly items: AldoLibraryItem[]; readonly elsewhere: AldoShareView[] } {
  const shares = input.shares ?? [];
  // An Aldo that says where each share came from: this computer's are here, the rest aren't.
  const placed = shares.some((share) => share.environmentId !== undefined);
  const ours = (share: AldoShareView) => !placed || share.environmentId === input.environmentId;
  const byId = new Map(shares.map((share) => [share.id, share]));
  const claimed = new Set<string>();
  const findShare = (thing: AldoMadeItem, from: number, to: number): AldoShareView | null => {
    const id = thing.url ? aldoShareIdOf(thing.url) : null;
    if (id) return byId.get(id) ?? null;
    const title = thing.sharedAs?.trim().slice(0, 200);
    if (!title) return null;
    // The one made nearest the turn's end, within it.
    let best: AldoShareView | null = null;
    for (const share of shares) {
      const at = timeOf(share.createdAt);
      if (
        claimed.has(share.id) ||
        share.title !== title ||
        !ours(share) ||
        at <= from - TURN_SLACK_MS ||
        at > to + TURN_SLACK_MS
      ) {
        continue;
      }
      if (!best || at > timeOf(best.createdAt)) best = share;
    }
    return best;
  };
  const indexByKey = new Map<string, number>();
  const items: AldoLibraryItem[] = [];
  const turns = input.turns.toSorted((a, b) => timeOf(b.completedAt) - timeOf(a.completedAt));
  turns.forEach((turn, turnIndex) => {
    const made = aldoTurnMade({
      files: turn.files,
      shares: input.sharesByTurn.get(turn.turnId) ?? [],
      workspaceRoot: input.workspaceRoot,
    });
    const from = turns[turnIndex + 1] ? timeOf(turns[turnIndex + 1]!.completedAt) : -Infinity;
    const to = timeOf(turn.completedAt);
    for (const thing of made.items) {
      const share = input.shares === null ? null : findShare(thing, from, to);
      // Where Aldo's list doesn't have its share anymore, what's left is the file, if it's here.
      const shared = input.shares === null ? thing.sharedAs !== undefined : share !== null;
      if (!shared && thing.path === null) continue;
      if (share) claimed.add(share.id);
      const name = shared ? (share?.title ?? thing.sharedAs ?? thing.name) : thing.name;
      const item: AldoLibraryItem = {
        key: thing.path ?? (share ? `share:${share.id}` : (thing.url ?? thing.name)),
        name,
        fileName: name !== thing.name ? thing.name : null,
        kind: thing.kind,
        path: thing.path,
        at: turn.completedAt,
        shared,
        share,
        url: input.shares === null ? (thing.url ?? null) : null,
      };
      const index = indexByKey.get(item.key);
      if (index === undefined) {
        indexByKey.set(item.key, items.length);
        items.push(item);
        continue;
      }
      // A file a later turn changed again keeps that time, and the share an earlier turn made.
      const later = items[index]!;
      if (!later.shared && item.shared) {
        items[index] = { ...item, at: later.at };
      }
    }
  });
  const elsewhere: AldoShareView[] = [];
  for (const share of shares) {
    if (claimed.has(share.id)) continue;
    if (!placed) elsewhere.push(share);
    else if (ours(share)) items.push(aldoShareItem(share));
  }
  return { items, elsewhere };
}

/** A share on its own: no file beside the thread to open. */
export function aldoShareItem(share: AldoShareView): AldoLibraryItem {
  return {
    key: `share:${share.id}`,
    name: share.title,
    fileName: null,
    kind: aldoShareKind(share.contentType) ?? aldoMadeKind(share.title),
    path: null,
    at: share.createdAt,
    shared: true,
    share,
    url: null,
  };
}
