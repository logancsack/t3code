// Today's brief (AldoBrief.tsx), read when Aldo's conversation shows, and
// again on a new day. The day's first read makes it (a few seconds), so a
// read may find another one making it and tries again shortly. A brief made
// for this read is said in the conversation too: the conversation reads it
// then, rather than on its next refresh. An Aldo without briefs has none.

import { create } from "zustand";

import { pullAldoConversation } from "./assistantSession";
import { fetchAldoBrief, type AldoBrief } from "./cloud";

const PENDING_RETRY_MS = 4_000;
const PENDING_TRIES = 15;

export const useAldoBrief = create<{ readonly brief: AldoBrief | null }>(() => ({ brief: null }));

let loading: Promise<void> | null = null;
/** The local day the brief was last read for. */
let readFor: string | null = null;

function localDay(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Reads today's brief, once a day per page (`again` reads it anyway). */
export function loadAldoBrief(again = false): Promise<void> {
  if (loading) return loading;
  const day = localDay();
  if (!again && readFor === day) return Promise.resolve();
  loading = (async () => {
    for (let tries = 0; tries < PENDING_TRIES; tries += 1) {
      const read = await fetchAldoBrief().catch(() => undefined);
      // Couldn't be read: tried again on the next look.
      if (read === undefined) return;
      readFor = day;
      if (read === null) return;
      if (read.pending) {
        await new Promise((resolve) => setTimeout(resolve, PENDING_RETRY_MS));
        continue;
      }
      const made = read.brief !== null && read.brief.at !== useAldoBrief.getState().brief?.at;
      useAldoBrief.setState({ brief: read.brief });
      if (made) void pullAldoConversation();
      return;
    }
  })().finally(() => {
    loading = null;
  });
  return loading;
}
