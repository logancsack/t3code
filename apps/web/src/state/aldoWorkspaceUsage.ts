import { useCallback, useEffect, useRef, useState } from "react";

import { isLandingDemo } from "../landingDemo/mode";
import { isManagedDevPc } from "../managedDevPc";

/**
 * Aldo compute usage for the signed-in workspace, as the gateway summarizes it.
 *
 * The gateway owns every derived number here (credit balances, hourly rate,
 * plan copy) so billing math lives in one place; this client only renders.
 * `metered` is false for complimentary workspaces and for environments without
 * billing, in which case the credit, bill, and plan facts are null.
 */
export interface AldoWorkspaceUsage {
  readonly configured: boolean;
  readonly metered: boolean;
  readonly plan: {
    readonly id: string;
    readonly name: string;
    readonly includedCredits: number;
  } | null;
  readonly period: {
    readonly status: string;
    readonly start: string;
    readonly end: string;
    readonly cancelAtPeriodEnd: boolean;
  } | null;
  readonly credits: {
    readonly used: number;
    readonly included: number;
    readonly authorized: number;
    readonly remaining: number;
    readonly includedRemaining: number;
    readonly overageRemaining: number;
    readonly projected: number | null;
  } | null;
  readonly bill: {
    readonly estimatedCents: number;
    readonly projectedCents: number | null;
    readonly spendLimitCents: number;
  } | null;
  readonly machine: {
    readonly class: "standard" | "full_power";
    readonly label: string;
    readonly creditsPerHour: number;
    readonly status: string;
    readonly lifecyclePending: boolean;
  } | null;
  readonly alert: AldoUsageAlertLevel;
  readonly updatedAt: string | null;
}

export type AldoUsageAlertLevel =
  | "none"
  | "included_warning"
  | "included_exhausted"
  | "spend_warning"
  | "spend_reached";

const ALERT_LEVELS: ReadonlySet<string> = new Set([
  "none",
  "included_warning",
  "included_exhausted",
  "spend_warning",
  "spend_reached",
]);

export const ALDO_WORKSPACE_USAGE_PATH = "/_devpc/account/usage";
const REQUEST_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

/**
 * Accept only a payload this build understands. A gateway that predates or
 * outruns the bundle answers with a different shape, and rendering half of it
 * would show wrong numbers with full confidence.
 */
export function isAldoWorkspaceUsage(value: unknown): value is AldoWorkspaceUsage {
  if (!isRecord(value)) return false;
  if (typeof value.configured !== "boolean" || typeof value.metered !== "boolean") return false;
  if (typeof value.alert !== "string" || !ALERT_LEVELS.has(value.alert)) return false;
  if (value.updatedAt !== null && typeof value.updatedAt !== "string") return false;

  const { plan, period, credits, bill, machine } = value;
  if (
    plan !== null &&
    !(
      isRecord(plan) &&
      typeof plan.id === "string" &&
      typeof plan.name === "string" &&
      isFiniteNumber(plan.includedCredits)
    )
  ) {
    return false;
  }
  if (
    period !== null &&
    !(
      isRecord(period) &&
      typeof period.status === "string" &&
      typeof period.start === "string" &&
      typeof period.end === "string" &&
      typeof period.cancelAtPeriodEnd === "boolean"
    )
  ) {
    return false;
  }
  if (
    credits !== null &&
    !(
      isRecord(credits) &&
      isFiniteNumber(credits.used) &&
      isFiniteNumber(credits.included) &&
      isFiniteNumber(credits.authorized) &&
      isFiniteNumber(credits.remaining) &&
      isFiniteNumber(credits.includedRemaining) &&
      isFiniteNumber(credits.overageRemaining) &&
      isNullableFiniteNumber(credits.projected)
    )
  ) {
    return false;
  }
  if (
    bill !== null &&
    !(
      isRecord(bill) &&
      isFiniteNumber(bill.estimatedCents) &&
      isNullableFiniteNumber(bill.projectedCents) &&
      isFiniteNumber(bill.spendLimitCents)
    )
  ) {
    return false;
  }
  if (
    machine !== null &&
    !(
      isRecord(machine) &&
      (machine.class === "standard" || machine.class === "full_power") &&
      typeof machine.label === "string" &&
      isFiniteNumber(machine.creditsPerHour) &&
      typeof machine.status === "string" &&
      typeof machine.lifecyclePending === "boolean"
    )
  ) {
    return false;
  }
  // A metered summary always carries its plan, period, credits, and bill.
  if (value.metered && (plan === null || period === null || credits === null || bill === null)) {
    return false;
  }
  return true;
}

export type AldoWorkspaceUsageState =
  /** Not a managed Aldo build, or the landing demo: nothing to show. */
  | { readonly status: "unavailable" }
  | { readonly status: "loading"; readonly usage: AldoWorkspaceUsage | null }
  | { readonly status: "ready"; readonly usage: AldoWorkspaceUsage }
  | { readonly status: "error"; readonly usage: AldoWorkspaceUsage | null };

export function aldoWorkspaceUsageAvailable(): boolean {
  return isManagedDevPc && !isLandingDemo();
}

/**
 * Loads the gateway's usage summary once on mount and again on `refresh()`.
 *
 * Errors keep the last good summary so a blip during refresh does not blank
 * the card; the page's refresh control is the way back.
 */
export function useAldoWorkspaceUsage(): {
  readonly state: AldoWorkspaceUsageState;
  readonly refresh: () => void;
} {
  const available = aldoWorkspaceUsageAvailable();
  const [state, setState] = useState<AldoWorkspaceUsageState>(() =>
    available ? { status: "loading", usage: null } : { status: "unavailable" },
  );
  const request = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    if (!available) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState((previous) => ({
      status: "loading",
      usage: previous.status === "unavailable" ? null : previous.usage,
    }));
    void fetch(ALDO_WORKSPACE_USAGE_PATH, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    })
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok || !isAldoWorkspaceUsage(payload)) {
          setState((previous) => ({
            status: "error",
            usage: previous.status === "unavailable" ? null : previous.usage,
          }));
          return;
        }
        setState({ status: "ready", usage: payload });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setState((previous) => ({
          status: "error",
          usage: previous.status === "unavailable" ? null : previous.usage,
        }));
      });
  }, [available]);

  useEffect(() => {
    refresh();
    return () => {
      request.current?.abort();
    };
  }, [refresh]);

  return { state, refresh };
}
