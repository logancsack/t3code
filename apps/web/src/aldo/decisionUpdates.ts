import { create } from "zustand";

// A changed decision replaces the card, never retries the person's old choice.
export const useDecisionUpdates = create<{
  refs: ReadonlyArray<string>;
  note: (ref: string) => void;
  clear: (ref: string) => void;
}>((set) => ({
  refs: [],
  note: (ref) => set((s) => ({ refs: [...s.refs.filter((r) => r !== ref).slice(-49), ref] })),
  clear: (ref) => set((s) => ({ refs: s.refs.filter((r) => r !== ref) })),
}));
