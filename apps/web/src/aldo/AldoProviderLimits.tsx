// The Usage page's Plan limits: what's left of Aldo's plan and of each plan the
// user connected (Claude, ChatGPT, Grok, media generators), and when each limit
// resets. Aldo reads them from its server (GET /api/usage/limits); an older
// Aldo doesn't, and the section isn't shown.

import { ExternalLinkIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ClaudeAI, GrokIcon, type Icon, MuseCodeIcon, OpenAI } from "../components/Icons";
import { useNowMinute } from "../hooks/useNowMinute";
import { isLandingDemo } from "../landingDemo/mode";
import { cn } from "../lib/utils";
import { fetchAldoProviderLimits, isAldoCloud } from "./cloud";
import {
  limitFraction,
  limitPageUrl,
  limitResetCopy,
  limitStateCopy,
  limitsCheckedCopy,
  limitTone,
  limitUsedCopy,
  nextLimitReset,
  type AldoLimitWindow,
  type AldoProviderLimits,
} from "./providerLimits.logic";

export type AldoProviderLimitsState =
  /** Not Aldo cloud, the landing demo, or an Aldo that doesn't read limits. */
  | { readonly status: "unavailable" }
  | { readonly status: "loading"; readonly providers: ReadonlyArray<AldoProviderLimits> | null }
  | { readonly status: "ready"; readonly providers: ReadonlyArray<AldoProviderLimits> }
  | { readonly status: "error"; readonly providers: ReadonlyArray<AldoProviderLimits> | null };

const providersOf = (state: AldoProviderLimitsState) =>
  state.status === "unavailable" ? null : state.providers;

/** Aldo reads the providers at once, each within 10 seconds; past this, something's stuck. */
const REQUEST_TIMEOUT_MS = 30_000;
/** After a reset, a moment for the provider to have renewed it; and never sooner than a minute apart. */
const RESET_SLACK_MS = 5_000;
const RESET_READ_MIN_MS = 60_000;

/**
 * Loads the limits on mount, and again when a limit resets; `refresh()` asks
 * the providers again (Aldo answers from its last reading when it's only
 * seconds old). A failed refresh keeps what was shown.
 */
export function useAldoProviderLimits(): {
  readonly state: AldoProviderLimitsState;
  readonly refresh: () => void;
} {
  const available = isAldoCloud && !isLandingDemo();
  const [state, setState] = useState<AldoProviderLimitsState>(() =>
    available ? { status: "loading", providers: null } : { status: "unavailable" },
  );
  const request = useRef<AbortController | null>(null);

  const load = useCallback(
    (refresh: boolean) => {
      if (!available) return;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setState((previous) =>
        previous.status === "unavailable"
          ? previous
          : { status: "loading", providers: providersOf(previous) },
      );
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
      void fetchAldoProviderLimits(refresh, signal).then(
        (providers) => {
          if (controller.signal.aborted) return;
          setState(providers ? { status: "ready", providers } : { status: "unavailable" });
        },
        () => {
          if (controller.signal.aborted) return;
          setState((previous) =>
            previous.status === "unavailable"
              ? previous
              : { status: "error", providers: providersOf(previous) },
          );
        },
      );
    },
    [available],
  );

  useEffect(() => {
    load(false);
    return () => {
      request.current?.abort();
    };
  }, [load]);

  // Read again once the next limit resets, so a renewed one doesn't go on showing as used.
  const readyProviders = state.status === "ready" ? state.providers : null;
  useEffect(() => {
    if (!readyProviders) return;
    const wait = nextLimitReset(readyProviders, Date.now());
    if (wait === null) return;
    const timer = window.setTimeout(
      () => load(true),
      Math.max(wait + RESET_SLACK_MS, RESET_READ_MIN_MS),
    );
    return () => window.clearTimeout(timer);
  }, [readyProviders, load]);

  const refresh = useCallback(() => load(true), [load]);
  return { state, refresh };
}

export function AldoProviderLimitsSection({ state }: { readonly state: AldoProviderLimitsState }) {
  const minute = useNowMinute();
  if (state.status === "unavailable") return null;
  const now = Date.parse(`${minute}:00Z`);
  const providers = state.providers;
  const checked = providers ? limitsCheckedCopy(providers, now) : null;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="aldo-plan-limits-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="aldo-plan-limits-heading" className="text-sm font-medium text-foreground">
          Plan limits
        </h2>
        {checked ? (
          <span className="text-xs text-muted-foreground">
            {state.status === "loading" ? "Checking…" : checked}
          </span>
        ) : null}
      </div>
      {providers ? (
        <div
          className={cn(
            "grid gap-x-8 gap-y-6 md:grid-cols-2 2xl:grid-cols-3",
            state.status === "ready" ? null : "opacity-64",
          )}
        >
          {providers.map((limits) => (
            <ProviderLimitsCard key={limits.id} limits={limits} now={now} />
          ))}
        </div>
      ) : state.status === "error" ? (
        <p className="text-xs text-muted-foreground">
          Plan limits could not be loaded. Refresh to try again.
        </p>
      ) : (
        <div className="grid gap-x-8 gap-y-6 md:grid-cols-2 2xl:grid-cols-3" aria-busy="true">
          {[0, 1].map((key) => (
            <div key={key} className="flex flex-col gap-2">
              <div className="h-4 w-32 animate-pulse rounded bg-muted" />
              <div className="h-1 w-full animate-pulse rounded-full bg-muted" />
              <div className="h-3 w-24 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      )}
      {state.status === "error" && providers ? (
        <p className="text-xs text-muted-foreground">
          These could not be checked again just now. Refresh to try again.
        </p>
      ) : null}
    </section>
  );
}

const MARKS: Readonly<Record<string, Icon | undefined>> = {
  claude: ClaudeAI,
  codex: OpenAI,
  grok: GrokIcon,
  muse: MuseCodeIcon,
};

function ProviderLimitsCard({
  limits,
  now,
}: {
  readonly limits: AldoProviderLimits;
  readonly now: number;
}) {
  const Mark = MARKS[limits.id];
  const stateCopy = limitStateCopy(limits.state);
  const page = limitPageUrl(limits);

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
          {Mark ? (
            <Mark className="size-4 shrink-0" aria-hidden />
          ) : (
            <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
              <span className="size-2 rounded-full bg-muted-foreground/50" />
            </span>
          )}
          <span className="truncate font-medium">{limits.name}</span>
          {limits.plan ? (
            <span className="shrink-0 text-xs text-muted-foreground">{limits.plan}</span>
          ) : null}
        </span>
        {stateCopy ? (
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
              limits.state === "reached"
                ? "bg-destructive/10 text-destructive-foreground"
                : "bg-warning/15 text-warning-foreground",
            )}
          >
            {stateCopy}
          </span>
        ) : null}
      </div>
      {limits.windows.map((window) => (
        <LimitMeter key={window.id} window={window} now={now} />
      ))}
      {limits.lines.map((line) => (
        <p key={line} className="text-xs text-muted-foreground">
          {line}
        </p>
      ))}
      {limits.error ? <p className="text-xs text-muted-foreground">{limits.error}</p> : null}
      {page ? (
        <a
          href={page}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {limits.name}'s usage page
          <ExternalLinkIcon className="size-3" aria-hidden />
        </a>
      ) : null}
    </div>
  );
}

function LimitMeter({ window, now }: { readonly window: AldoLimitWindow; readonly now: number }) {
  const tone = limitTone(window.usedPercent);
  const reset = limitResetCopy(window.resetsAt, now);
  const facts = [window.detail, reset].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-foreground">{window.label}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {limitUsedCopy(window.usedPercent)}
        </span>
      </div>
      <div
        className="h-1 overflow-hidden rounded-full bg-border"
        role="meter"
        aria-label={`${window.label} used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(100, Math.max(0, window.usedPercent)))}
        aria-valuetext={limitUsedCopy(window.usedPercent)}
      >
        <div
          className={cn(
            "h-full rounded-full",
            tone === "reached"
              ? "bg-destructive"
              : tone === "near"
                ? "bg-warning"
                : "bg-foreground/55",
          )}
          style={{ width: `${(limitFraction(window.usedPercent) * 100).toFixed(1)}%` }}
        />
      </div>
      {facts ? (
        <span className="text-[11px] text-muted-foreground tabular-nums">{facts}</span>
      ) : null}
    </div>
  );
}
