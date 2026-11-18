import { api, ALDO_READ_ANSWERS_WITHIN_MS, threadIdForEnvironment } from "./api";

export type AldoActivity = {
  workflow?: {
    pack: string;
    version: number;
    humanMinutes: number | string | null;
    reviewMinutes: number | string | null;
    hiringMinutesPerMonth: number | string | null;
    role: string | null;
  } | null;
  version: 1;
  next: string | null;
  events: {
    id: string;
    turnId: string | null;
    kind: string;
    name: string;
    status: string;
    at: string;
  }[];
  turns: {
    id: string;
    trigger: string;
    provider: string | null;
    model: string | null;
    outcome: string;
    taskResult?: {
      state: string;
      doneWhen: {
        criterion: string;
        met: boolean;
        evidence: string;
        verification?: { verdict: string; verifier: string; checkedAt: string } | null;
      }[];
    } | null;
  }[];
  effects: {
    id: string;
    operation: string;
    provider: string;
    status: string;
    approvalId: string;
    receipt: string | null;
    at: string;
  }[];
  routing: { id: string; origin: string; reason: string; at: string }[];
  home: { id: string; tool: string; outcome: string; at: string }[];
  stream: { partial: boolean; reportedAt: string } | null;
  cost: {
    chargedCredits: { machineCredits: number | string; modelCredits: number | string };
    modelApiCost: { providerUsd: number | string | null; pending: number; unpriced: number };
    subscriptionReference: {
      referenceUsd: number | string | null;
      unpricedRecords: number | string | null;
      sinceDay: string;
      untilDay: string;
    } | null;
    conversationReference: { usd: number; estimated: true } | null;
    externalPurchases: { usd: number | string; count: number };
    note: string;
  };
};

/** Optional on older servers. Reading saved activity never wakes the computer. */
export function fetchAldoActivity(environmentId: string, conversation: string, before?: string) {
  const query = new URLSearchParams({ conversation, ...(before ? { before } : {}) });
  return api<AldoActivity>(
    `/api/environments/${encodeURIComponent(threadIdForEnvironment(environmentId))}/trace?${query}`,
    { answersWithin: ALDO_READ_ANSWERS_WITHIN_MS },
  );
}

export function saveAldoVerification(
  environmentId: string,
  conversation: string,
  input: Record<string, unknown>,
) {
  return api<{ saved: true }>(
    `/api/environments/${encodeURIComponent(threadIdForEnvironment(environmentId))}/verification`,
    { method: "POST", body: JSON.stringify({ ...input, conversation }) },
  );
}
