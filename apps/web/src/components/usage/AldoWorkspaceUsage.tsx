import { ExternalLinkIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { AldoBillingSection, useAldoCheckoutReturn } from "../../aldo/AldoBilling";
import { isAldoCloud } from "../../aldo/api";
import { deleteAldoWindowsDisk, setAldoSpendLimit } from "../../aldo/accountApi";

import type {
  AldoWindowsDisk,
  AldoWorkspaceUsage,
  AldoWorkspaceUsageState,
} from "../../state/aldoWorkspaceUsage";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import {
  aldoPlanEnded,
  aldoUsageAlertCopy,
  aldoUsageFacts,
  aldoUsageFootnote,
  aldoUsageMeter,
  aldoUsageUnmeteredCopy,
  aldoWindowsDiskCopy,
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
  title = "Aldo workspace",
}: {
  readonly state: AldoWorkspaceUsageState;
  readonly onChanged?: () => void;
  /** Aldo's Settings → Account names it for what it shows there. */
  readonly title?: string;
}) {
  useAldoCheckoutReturn(onChanged);
  if (state.status === "unavailable") return null;
  const usage = state.status === "ready" ? state.usage : state.usage;

  return (
    <>
      <section className="flex flex-col gap-3" aria-labelledby="aldo-workspace-usage-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="aldo-workspace-usage-heading" className="text-sm font-medium text-foreground">
            {title}
          </h2>
          {isAldoCloud ? (
            usage?.bill && !aldoPlanEnded(usage) && usage.seat ? (
              // A seat's limit is its organization's to set (the Plan section says whom to ask).
              <span className="text-xs text-muted-foreground">
                Extra usage limit: {formatCents(usage.bill.spendLimitCents)}
              </span>
            ) : usage?.bill && !aldoPlanEnded(usage) ? (
              <SpendLimitControl
                spendLimitCents={usage.bill.spendLimitCents}
                onChanged={onChanged}
              />
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
        {isAldoCloud && usage?.windowsDisk ? (
          <WindowsDiskControl
            disk={usage.windowsDisk}
            status={state.status}
            onChanged={onChanged}
          />
        ) : null}
      </section>
      {isAldoCloud && usage ? (
        <AldoBillingSection usage={usage} status={state.status} onChanged={onChanged} />
      ) : null}
    </>
  );
}

function AldoWorkspaceUsageBody({
  usage,
  stale,
}: {
  readonly usage: AldoWorkspaceUsage;
  readonly stale: boolean;
}) {
  // An ended plan's credits can't be used: no warnings or meter, just what it used.
  const ended = aldoPlanEnded(usage);
  const alert = ended ? null : aldoUsageAlertCopy(usage.alert, usage);
  const facts = aldoUsageFacts(usage);
  const footnote = aldoUsageFootnote(usage);
  const meter = usage.credits && !ended ? aldoUsageMeter(usage.credits) : null;

  return (
    <div className={stale ? "flex flex-col gap-3 opacity-64" : "flex flex-col gap-3"}>
      {alert ? (
        <p className="border border-border px-3 py-2 text-xs text-foreground" role="status">
          {alert}
        </p>
      ) : null}
      {usage.credits && meter ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-2xl font-semibold text-foreground tabular-nums">
              {formatCredits(usage.credits.remaining)}{" "}
              <span className="text-sm font-normal text-muted-foreground">credits left</span>
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">{meter.valueText}</span>
          </div>
          <div
            className="h-1 overflow-hidden rounded-full bg-border"
            role="meter"
            aria-label={meter.label}
            aria-valuemin={0}
            aria-valuemax={meter.max}
            aria-valuenow={meter.value}
            aria-valuetext={meter.valueText}
          >
            <div
              className="h-full rounded-full bg-foreground/55"
              style={{ width: `${(meter.fraction * 100).toFixed(1)}%` }}
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
    // A blank field isn't $0: that would turn extra usage off.
    const dollars = editing.trim() === "" ? Number.NaN : Number(editing);
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

/**
 * Aldo cloud: a stopped Windows computer's disk, kept (and charged) for next
 * time, and deleting it, once the summary is current.
 */
function WindowsDiskControl(props: {
  readonly disk: AldoWindowsDisk;
  readonly status: AldoWorkspaceUsageState["status"];
  readonly onChanged: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const message = await deleteAldoWindowsDisk();
      setOpen(false);
      toastManager.add({ type: "success", title: "Windows computer's disk", description: message });
      props.onChanged?.();
    } catch (cause) {
      // Running, starting or stopping (409): Aldo says what to do first.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border border-border px-3 py-2 text-xs text-foreground">
      <span>{aldoWindowsDiskCopy(props.disk)}</span>
      <Button
        size="xs"
        variant="outline"
        disabled={props.status !== "ready" || busy}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        Delete
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !busy) setOpen(false);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your Windows computer's disk?</AlertDialogTitle>
            <AlertDialogDescription>
              Its files, apps and Office sign-in go; it starts fresh next time.
            </AlertDialogDescription>
            {error ? (
              <p className="text-sm text-destructive-foreground" role="alert">
                {error}
              </p>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />} disabled={busy}>
              Keep it
            </AlertDialogClose>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => void remove()}>
              {busy ? <Spinner className="size-3.5" /> : null}
              Delete disk
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
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
