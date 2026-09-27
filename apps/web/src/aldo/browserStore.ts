import { create } from "zustand";

/**
 * Asks the Browser panel to open a URL in a new tab of a thread's shared
 * browser (the Previews menu uses it for http://localhost:<port>). The panel
 * consumes the request once it's connected.
 */
interface AldoBrowserRequests {
  readonly request: {
    readonly environmentId: string;
    readonly url: string;
    readonly id: number;
  } | null;
  readonly openUrl: (environmentId: string, url: string) => void;
  readonly consume: (id: number) => void;
}

let nextId = 1;

export const useAldoBrowserRequests = create<AldoBrowserRequests>((set, get) => ({
  request: null,
  openUrl: (environmentId, url) => set({ request: { environmentId, url, id: nextId++ } }),
  consume: (id) => {
    if (get().request?.id === id) set({ request: null });
  },
}));
