// Starting a thread at once (B1): "New" opens a General draft, ready to type
// in, and the draft's "General ▾" chip (AldoPlaceChip) moves it to a project
// or repository before its first message, taking what's typed along.

import { useCallback, useState } from "react";

import { toastManager } from "../components/ui/toast";
import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
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

/** Opens a draft thread in `repos` (none: General) at once; `carry` moves a draft's words into it. */
export function useStartAldoThread(): {
  readonly start: (
    repos: ReadonlyArray<string>,
    carry?: { readonly from: DraftId; readonly prompt: string },
  ) => Promise<void>;
  readonly starting: boolean;
} {
  const handleNewThread = useNewThreadHandler();
  const [starting, setStarting] = useState(false);
  const start = useCallback(
    async (
      repos: ReadonlyArray<string>,
      carry?: { readonly from: DraftId; readonly prompt: string },
    ) => {
      setStarting(true);
      try {
        const projectRef = await startAldoSandbox({ repos });
        if (carry) carryAldoDraft(carry.from, carry.prompt);
        landAldoCarriedDraft(await handleNewThread(projectRef));
      } catch (cause) {
        dropAldoCarriedDraft();
        toastManager.add({
          type: "error",
          title: "Couldn't open a new thread",
          description: cause instanceof Error ? cause.message : String(cause),
        });
      } finally {
        setStarting(false);
      }
    },
    [handleNewThread],
  );
  return { start, starting };
}
