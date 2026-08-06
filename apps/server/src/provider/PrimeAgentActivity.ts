import type { ProviderInstanceId, ThreadId } from "@t3tools/contracts";

/**
 * Tracks detached Prime Agent subagents without treating the resident ACP
 * process itself as workspace activity.
 *
 * Prime emits one subagent delta at a time in its namespaced ACP metadata.
 * The tracker therefore keeps a set per live root session and only clears an
 * id when Prime reports a terminal state or the owning session closes.
 */

const PRIME_AGENT_META_NAMESPACE = "ai.primeintellect.prime-agent";
const ACTIVE_SUBAGENT_STATES = new Set(["queued", "running"]);
interface PrimeAgentActivityOwner {
  readonly threadId: ThreadId;
  readonly providerInstanceId: ProviderInstanceId;
}

interface PrimeAgentSessionActivity {
  readonly owner: PrimeAgentActivityOwner | undefined;
  readonly subagentIds: Set<string>;
}

const activeSubagentsBySession = new Map<string, PrimeAgentSessionActivity>();

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface PrimeAgentSessionMetadata {
  readonly [key: string]: unknown;
  readonly subagents?: ReadonlyArray<{
    readonly id: string;
    readonly status: string;
  }>;
}

export function parsePrimeAgentSessionMetadata(
  metadata: unknown,
): PrimeAgentSessionMetadata | undefined {
  if (!isRecord(metadata)) return undefined;
  const payload = metadata[PRIME_AGENT_META_NAMESPACE];
  if (!isRecord(payload)) return undefined;

  const subagents = Array.isArray(payload.subagents)
    ? payload.subagents.flatMap((candidate) => {
        if (!isRecord(candidate)) return [];
        const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
        const status = typeof candidate.status === "string" ? candidate.status.trim() : "";
        return id && status ? [{ id, status }] : [];
      })
    : undefined;

  return {
    ...payload,
    ...(subagents ? { subagents } : {}),
  };
}

export function updatePrimeAgentSubagentActivity(
  sessionKey: string,
  metadata: unknown,
  owner?: PrimeAgentActivityOwner,
): void {
  const parsed = parsePrimeAgentSessionMetadata(metadata);
  if (!parsed?.subagents) return;

  const existing = activeSubagentsBySession.get(sessionKey);
  const active = new Set(existing?.subagentIds ?? []);
  for (const subagent of parsed.subagents) {
    if (ACTIVE_SUBAGENT_STATES.has(subagent.status.toLowerCase())) {
      active.add(subagent.id);
    } else {
      active.delete(subagent.id);
    }
  }
  if (active.size > 0) {
    activeSubagentsBySession.set(sessionKey, {
      owner: owner ?? existing?.owner,
      subagentIds: active,
    });
  } else {
    activeSubagentsBySession.delete(sessionKey);
  }
}

export function clearPrimeAgentSessionActivity(sessionKey: string): void {
  activeSubagentsBySession.delete(sessionKey);
}

/** Read-only process activity query used by the managed DevPC route. */
export function hasRunningPrimeAgentSubagents(): boolean {
  for (const active of activeSubagentsBySession.values()) {
    if (active.subagentIds.size > 0) return true;
  }
  return false;
}

/** Read-only owner query used to keep detached Prime work out of the idle reaper. */
export function hasRunningPrimeAgentSubagentsForThread(
  threadId: ThreadId,
  providerInstanceId?: ProviderInstanceId | null,
): boolean {
  for (const activity of activeSubagentsBySession.values()) {
    if (
      activity.subagentIds.size > 0 &&
      activity.owner?.threadId === threadId &&
      (providerInstanceId == null || activity.owner.providerInstanceId === providerInstanceId)
    ) {
      return true;
    }
  }
  return false;
}
