// A sentence for a thread's agent, put in its composer for the user to send:
// from what it made (Share…, the Library) or from a page open in the viewer.

import type { ScopedThreadRef } from "@t3tools/contracts";

import { readComposerThreadPrompt, useComposerDraftStore } from "../composerDraftStore";
import { promptWith } from "./summon.logic";

/** Puts a sentence for the agent in the composer, to send. */
export function aldoAskAgent(threadRef: ScopedThreadRef, sentence: string) {
  useComposerDraftStore
    .getState()
    .setPrompt(threadRef, promptWith(readComposerThreadPrompt(threadRef), sentence));
  window.setTimeout(
    () => document.querySelector<HTMLElement>('[data-testid="composer-editor"]')?.focus(),
    50,
  );
}
