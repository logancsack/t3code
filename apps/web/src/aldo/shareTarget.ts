// Share to Aldo, in the browser: reads the share the app was opened with from
// where Aldo's service worker kept it, and deletes it once taken
// (shareTarget.logic.ts says how it's kept). AldoShareReceiver puts it in a
// draft.

import {
  ALDO_SHARE_CACHE,
  aldoShareKey,
  aldoShareKeyIsFor,
  parseAldoShareDetails,
  type AldoShareDetails,
} from "./shareTarget.logic";

export interface AldoKeptShare {
  readonly details: AldoShareDetails;
  /** The files that came through, in the order shared. */
  readonly files: ReadonlyArray<File>;
  /** Names of files the details list that aren't there. */
  readonly missing: ReadonlyArray<string>;
}

/** A kept share, or null if it isn't there (already taken, or never kept). */
export async function readAldoShare(id: string): Promise<AldoKeptShare | null> {
  if (typeof caches === "undefined" || !(await caches.has(ALDO_SHARE_CACHE))) return null;
  const cache = await caches.open(ALDO_SHARE_CACHE);
  const kept = await cache.match(aldoShareKey(id));
  const details = kept ? parseAldoShareDetails(await kept.json().catch(() => null)) : null;
  if (!details) return null;
  const files: File[] = [];
  const missing: string[] = [];
  for (const [index, entry] of details.files.entries()) {
    const stored = await cache.match(aldoShareKey(id, index));
    const blob = stored ? await stored.blob().catch(() => null) : null;
    if (blob) files.push(new File([blob], entry.name, { type: entry.type || blob.type }));
    else missing.push(entry.name);
  }
  return { details, files, missing };
}

/** Deletes a share from the device. */
export async function dropAldoShare(id: string): Promise<void> {
  if (typeof caches === "undefined" || !(await caches.has(ALDO_SHARE_CACHE))) return;
  const cache = await caches.open(ALDO_SHARE_CACHE);
  for (const request of await cache.keys()) {
    if (aldoShareKeyIsFor(new URL(request.url).pathname, id)) await cache.delete(request);
  }
}
