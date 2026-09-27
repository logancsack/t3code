import { ExternalLinkIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { isAldoCloud, setAldoSpendLimit } from "../../aldo/cloud";

import type { AldoWorkspaceUsage, AldoWorkspaceUsageState } from "../../state/aldoWorkspaceUsage";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  aldoUsageAlertCopy,
  aldoUsageFacts,
  aldoUsageFootnote,
  aldoUsageMeterFraction,
  aldoUsageUnmeteredCopy,
  formatCents,
  formatCredits,
} from "./aldoWorkspaceUsageView";

/** The Aldo account page, where capacity and hardware are actually managed. */
const MANAGE_CAPACITY_HREF = "/_devpc/account/billing";

/**
 * Compute credits for the Aldo workspace this UI runs in, beside the token
 * spend it already reports. Renders nothing outside a managed build.
 */
export function AldoWorkspaceUsageSection({
  state,
  onChanged,
}: {
  readonly state: AldoWorkspaceUsageState;
  readonly onChanged?: () => void;
}) {
  if (state.status === "unavailable") return null;
  const usage = state.status === "ready" ? state.usage : state.usage;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="aldo-workspace-usage-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="aldo-workspace-usage-heading" className="text-sm font-medium text-foreground">
          Aldo workspace
        </h2>
        {isAldoCloud ? (
          usage?.bill ? (
            <SpendLimitControl spendLimitCents={usage.bill.spendLimitCents} onChanged={onChanged} />
          ) : null
        ) : (
          <Button
            render={<a href={MANAGE_CAPACITY_HREF} target="_blank" rel="noreferrer" />}
            size="xs"
            variant="outline"
          >
            Manage capacity
            <ExternalLinkIcon aria-hidden />
          </Button>
        )}
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

/**
 * Aldo cloud: how much extra usage (billed past the plan's credits) the user
 * allows each month. Agents stop once credits and the limit are used up.
 */
function SpendLimitControl(props: {
  readonly spendLimitCents: number;
  readonly onChanged: (() => void) | undefined;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (editing === null) return;
    const dollars = Number(editing);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setError("Enter an amount in dollars, like 20.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setAldoSpendLimit(Math.round(dollars * 100));
      setEditing(null);
      props.onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  if (editing === null) {
    return (
      <Button
        size="xs"
        variant="outline"
        onClick={() => setEditing(String(props.spendLimitCents / 100))}
      >
        Extra usage limit: {formatCents(props.spendLimitCents)}
      </Button>
    );
  }
  return (
    <form onSubmit={save} className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Extra usage up to $</span>
      <Input
        autoFocus
        aria-label="Extra usage limit in dollars"
        inputMode="decimal"
        className="h-7 w-20 text-xs"
        value={editing}
        onChange={(e) => setEditing(e.currentTarget.value)}
      />
      <Button type="submit" size="xs" disabled={busy}>
        Save
      </Button>
      <Button type="button" size="xs" variant="ghost" onClick={() => setEditing(null)}>
        Cancel
      </Button>
      {error ? <span className="text-xs text-destructive-foreground">{error}</span> : null}
    </form>
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
