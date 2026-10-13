// A machine warm by the first send. Typing to Aldo on the home screen asks
// Aldo to start a machine for the next thread it starts (POST /api/home/warm),
// at most once a minute while the typing goes on, so a thread Aldo starts
// from what the user sends finds its machine up or nearly. Aldo removes one
// no thread took a few minutes after the last ask. Only where Aldo can start
// a thread outside a repository (what a warm machine is for), and not when
// the user turned off starting new threads' machines right away
// (preloadSettings.ts). Words typed before Aldo's directory said it starts
// such threads are asked for once it does, as last typed. An Aldo without
// warm machines answers 404 and isn't asked again; any other failure is
// ignored, quietly.

import {
  aldoSupportsGeneralThreads,
  isAldoCloud,
  subscribeAldoEnvironments,
  warmAldoMachine,
} from "./cloud";
import { getAldoPreloadSettings } from "./preloadSettings";
import {
  aldoWarmAwaitsGeneral,
  aldoWarmDue,
  answeredAldoWarm,
  askingAldoWarm,
  INITIAL_ALDO_WARM_STATE,
} from "./warm.logic";

let state = INITIAL_ALDO_WARM_STATE;
/** What's in the composer, as last typed. */
let draft = "";
/** Listening to the directory until it says Aldo starts General threads (null: not). */
let awaitingGeneral: (() => void) | null = null;

/** The user typed in Aldo's composer on the home screen; `text` is what's in it now. */
export function noteAldoComposerTyping(text: string): void {
  if (!isAldoCloud) return;
  draft = text;
  const now = Date.now();
  const input = {
    text,
    newThreads: getAldoPreloadSettings().newThreads,
    general: aldoSupportsGeneralThreads(),
    now,
  };
  if (aldoWarmDue(state, input)) {
    state = askingAldoWarm(state, now);
    void warmAldoMachine().then((status) => {
      state = answeredAldoWarm(state, status);
    });
  } else if (!awaitingGeneral && aldoWarmAwaitsGeneral(state, input)) {
    awaitingGeneral = subscribeAldoEnvironments(() => {
      if (!aldoSupportsGeneralThreads()) return;
      awaitingGeneral?.();
      awaitingGeneral = null;
      noteAldoComposerTyping(draft);
    });
  }
}
