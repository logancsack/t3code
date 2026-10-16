// What the user decided from the cards at the end of Aldo's conversation,
// this visit (receipts.logic.ts): each card answered becomes a line in the
// conversation, at the moment it was answered, and stays hidden from the
// cards while the home read catches up.

import { create } from "zustand";

import { type AldoHomeTarget } from "./homeApi";

export interface AldoReceipt {
  /** The decision's key: the card it was. */
  readonly key: string;
  readonly at: string;
  readonly text: string;
  /** The thread it was in, to take a look at from the line. */
  readonly thread: AldoHomeTarget | null;
}

export const useAldoReceipts = create<{ readonly receipts: ReadonlyArray<AldoReceipt> }>(() => ({
  receipts: [],
}));

export function addAldoReceipt(receipt: AldoReceipt): void {
  useAldoReceipts.setState((s) => ({
    receipts: [...s.receipts.filter((r) => r.key !== receipt.key), receipt],
  }));
}
