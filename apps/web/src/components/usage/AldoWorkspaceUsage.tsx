import { ExternalLinkIcon } from "lucide-react";

import type { AldoWorkspaceUsage, AldoWorkspaceUsageState } from "../../state/aldoWorkspaceUsage";
import { Button } from "../ui/button";
import {
  aldoUsageAlertCopy,
  aldoUsageFacts,
  aldoUsageFootnote,
  aldoUsageMeterFraction,
  aldoUsageUnmeteredCopy,
  formatCredits,
} from "./aldoWorkspaceUsageView";

/** The Aldo account page, where capacity and hardware are actually managed. */
const MANAGE_CAPACITY_HREF = "/_devpc/account/billing";

/**
 * Compute credits for the Aldo workspace this UI runs in, beside the token
 * spend it already reports. Renders nothing outside a managed build.
 */
export function AldoWorkspaceUsageSection({ state }: { readonly state: AldoWorkspaceUsageState }) {
  if (state.status === "unavailable") return null;
  const usage = state.status === "ready" ? state.usage : state.usage;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="aldo-workspace-usage-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="aldo-workspace-usage-heading" className="text-sm font-medium text-foreground">
          Aldo workspace
        </h2>
        <Button
          render={<a href={MANAGE_CAPACITY_HREF} target="_blank" rel="noreferrer" />}
          size="xs"
          variant="outline"
        >
          Manage capacity
          <ExternalLinkIcon aria-hidden />
        </Button>
      </div>
      {usage ? (
        <AldoWorkspaceUsageBody usage={usage} stale={state.status !== "ready"} />
      ) : state.status === "error" ? (
        <p className="text-xs text-muted-foreground">
          Aldo usage could not be loaded. Refresh to try again.
        </p>
      ) : (
        <AldoWorkspaceUsageSkeleton />
      )}
    </section>
  );
}

function AldoWorkspaceUsageBody({
  usage,
  stale,
}: {
  readonly usage: AldoWorkspaceUsage;
  readonly stale: boolean;
}) {
  const alert = aldoUsageAlertCopy(usage.alert);
  const facts = aldoUsageFacts(usage);
  const footnote = aldoUsageFootnote(usage);

  return (
    <div className={stale ? "flex flex-col gap-3 opacity-64" : "flex flex-col gap-3"}>
      {alert ? (
        <p className="border border-border px-3 py-2 text-xs text-foreground" role="status">
          {alert}
        </p>
      ) : null}
      {usage.credits ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-2xl font-semibold text-foreground tabular-nums">
              {formatCredits(usage.credits.remaining)}{" "}
              <span className="text-sm font-normal text-muted-foreground">credits left</span>
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatCredits(usage.credits.used)} of {formatCredits(usage.credits.authorized)} used
              this cycle
            </span>
          </div>
          <div
            className="h-1 overflow-hidden rounded-full bg-border"
            role="meter"
            aria-label="Credits used this cycle"
            aria-valuemin={0}
            aria-valuemax={usage.credits.authorized}
            aria-valuenow={Math.min(usage.credits.used, usage.credits.authorized)}
          >
            <div
              className="h-full rounded-full bg-foreground/55"
              style={{ width: `${(aldoUsageMeterFraction(usage.credits) * 100).toFixed(1)}%` }}
            />
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{aldoUsageUnmeteredCopy(usage)}</p>
      )}
      {facts.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 py-1 md:grid-cols-3 2xl:grid-cols-6">
          {facts.map((fact) => (
            <div key={fact.label} className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">{fact.label}</span>
              <span className="text-base font-medium text-foreground tabular-nums">
                {fact.value}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {footnote ? <span className="text-xs text-muted-foreground">{footnote}</span> : null}
    </div>
  );
}

function AldoWorkspaceUsageSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <div className="h-8 w-40 animate-pulse rounded bg-muted" />
      <div className="h-1 w-full animate-pulse rounded-full bg-muted" />
      <div className="h-10 w-full animate-pulse rounded bg-muted" />
    </div>
  );
}
