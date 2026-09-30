// Which machines' threads this browser brings up to date from Aldo's copies,
// and which copies of its own it offers Aldo (see shells.ts). Pure, so it's
// tested on its own.

/** What the directory says of a machine, as far as its shell goes. */
export interface AldoShellEntry {
  readonly environmentId: string;
  readonly state: "new" | "ready" | "stopped" | "failed";
  /** Aldo's shell's snapshot sequence: null when it has none, missing from an older Aldo. */
  readonly shellSequence?: number | null;
}

/** A shell in this browser's cache. */
export interface AldoCachedShell {
  readonly sequence: number;
  readonly threadCount: number;
}

/**
 * The machines whose cached shell is worth reading: Aldo's is newer than the
 * sequence this tab last knew the cache at, or Aldo has none and this tab
 * hasn't looked for a copy to offer yet. A machine that isn't created yet has
 * nothing to show unless Aldo is starting a thread on it (Aldo's shell has
 * the thread, from the moment it's asked for), and a connected one keeps its
 * own cache current.
 */
export function aldoShellCandidates<T extends AldoShellEntry>(
  environments: ReadonlyArray<T>,
  input: {
    readonly known: ReadonlyMap<string, number>;
    readonly offerChecked: ReadonlySet<string>;
    readonly isLive: (environmentId: string) => boolean;
  },
): T[] {
  return environments.filter((environment) => {
    const { environmentId, shellSequence } = environment;
    if (shellSequence === undefined) return false;
    if (environment.state === "new" && shellSequence === null) return false;
    if (input.isLive(environmentId)) return false;
    return shellSequence === null
      ? !input.offerChecked.has(environmentId)
      : shellSequence > (input.known.get(environmentId) ?? -1);
  });
}

/**
 * Of those, the machines whose cache is older than Aldo's shell (download), and
 * the ones Aldo has no shell for whose cache has threads (offer).
 */
export function planAldoShellSync<T extends AldoShellEntry>(
  candidates: ReadonlyArray<T>,
  cached: ReadonlyMap<string, AldoCachedShell>,
): { readonly download: T[]; readonly offer: T[] } {
  const download: T[] = [];
  const offer: T[] = [];
  for (const environment of candidates) {
    const local = cached.get(environment.environmentId);
    if (environment.shellSequence === null || environment.shellSequence === undefined) {
      if (local && local.threadCount > 0) offer.push(environment);
    } else if (environment.shellSequence > (local?.sequence ?? -1)) {
      download.push(environment);
    }
  }
  return { download, offer };
}
