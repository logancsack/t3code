// Starting a thread at once (B1): "New" opens a General draft, ready to type
// in, and the draft's "General ▾" chip (AldoPlaceChip) moves it to a project
// or repository before its first message, taking what's typed along.

import { useCallback, useState } from "react";

import { toastManager } from "../components/ui/toast";
import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { randomUUID } from "../lib/utils";
import { startAldoSandbox } from "./threads";

/** What's typed in a draft being moved, for the draft it moves to (AldoRepositoryDialog). */
let carried: { readonly from: DraftId; readonly prompt: string } | null = null;

/** Keeps a draft's words for the thread the start dialog opens next. */
export function carryAldoDraft(from: DraftId, prompt: string): void {
  carried = prompt.trim() ? { from, prompt } : null;
}

/** Puts carried words into the draft that just opened, and empties the one they came from. */
export function landAldoCarriedDraft(opened: { readonly draftId: DraftId } | null): void {
  const words = carried;
  carried = null;
  if (!opened || !words) return;
  const store = useComposerDraftStore.getState();
  store.setPrompt(opened.draftId, words.prompt);
  if (words.from !== opened.draftId) store.setPrompt(words.from, "");
}

export function dropAldoCarriedDraft(): void {
  carried = null;
}

type Opened = { readonly draftId: DraftId } | null;

/** The start under way, shared by every place that opens a thread, with where it opens (its repositories). */
let opening: { readonly place: string; readonly done: Promise<Opened> } | null = null;

/**
 * Opens a thread in `place` (its repositories; a share's is its own) with
 * `open`: one elsewhere goes first, then this one opens where it was asked,
 * not in that one's draft; one under way for the same place, whichever button
 * or key asked, is the one it opens (a second would make another computer).
 */
export async function openAldoThreadOnce(
  place: string,
  open: () => Promise<Opened>,
): Promise<Opened> {
  for (let other = opening; other && other.place !== place; other = opening) await other.done;
  if (opening) return opening.done;
  const done = open().finally(() => {
    opening = null;
  });
  opening = { place, done };
  return done;
}

/**
 * Opens a draft thread in `repos` (none: General) at once; `carry` moves a
 * draft's words into it, and `alone` opens one of its own (what was shared),
 * never the one another start opens. Resolves with the draft that opened, or null.
 */
export function useStartAldoThread(): {
  readonly start: (
    repos: ReadonlyArray<string>,
    carry?: { readonly from: DraftId; readonly prompt: string },
    alone?: boolean,
  ) => Promise<Opened>;
  readonly starting: boolean;
} {
  const handleNewThread = useNewThreadHandler();
  const [starting, setStarting] = useState(false);
  const start = useCallback(
    async (
      repos: ReadonlyArray<string>,
      carry?: { readonly from: DraftId; readonly prompt: string },
      alone = false,
    ) => {
      // One alone is a place of its own: it waits for the others, and they for it.
      const place = alone ? randomUUID() : repos.join("\n");
      return openAldoThreadOnce(place, async () => {
        setStarting(true);
        try {
          const projectRef = await startAldoSandbox({ repos });
          if (carry) carryAldoDraft(carry.from, carry.prompt);
          const opened = await handleNewThread(projectRef);
          landAldoCarriedDraft(opened);
          return opened;
        } catch (cause) {
          dropAldoCarriedDraft();
          toastManager.add({
            type: "error",
            title: "Couldn't open a new thread",
            description: cause instanceof Error ? cause.message : String(cause),
          });
          return null;
        } finally {
          setStarting(false);
        }
      });
    },
    [handleNewThread],
  );
  return { start, starting };
}
