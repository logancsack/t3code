// The plan card's taps (AldoPlanCard.tsx), to Aldo's /api/assistant/plans/:id
// (its src/lib/assistant/plans.ts). Only a newer Aldo shows plans, so only it
// is asked.

import { api } from "./api";
import { parseAldoPlan, type AldoPlan } from "./plans.logic";

export type AldoPlanTap =
  /** Start, with the answers on the card: it starts once, however often it's tapped. */
  | { readonly action: "start"; readonly answers: Readonly<Record<string, string>> }
  /** The user is changing it (an answer, or "Change the plan"): it no longer starts on its own. */
  | { readonly action: "hold" }
  /** The countdown ran out: it starts on its own if it's still due (Aldo's minute does it otherwise). */
  | { readonly action: "auto" };

/** Tells Aldo what the user did with a plan; the plan as Home now shows it, null once it's gone. */
export async function tapAldoPlan(id: string, tap: AldoPlanTap): Promise<AldoPlan | null> {
  const body = await api<{ plan?: unknown }>(`/api/assistant/plans/${encodeURIComponent(id)}`, {
    method: "POST",
    body: JSON.stringify(tap),
  });
  return parseAldoPlan(body.plan ?? null);
}
