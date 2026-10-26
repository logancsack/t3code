// Offboarding in Settings (offboarding.logic.ts): what becomes of the
// organization's threads someone had as an admin removes them (hand them to a
// colleague, keep them 30 days, or delete them), and the former members with
// their threads' copies, which an admin tries again, hands on or deletes, and
// a closed account to restore. Aldo decides; this shows its words when it
// refuses. From an Aldo without it, the sheets say what they said before.

import { Link } from "@tanstack/react-router";
import { TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { SettingsSection } from "../components/settings/settingsLayout";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Radio, RadioGroup } from "../components/ui/radio-group";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";
import { Switch } from "../components/ui/switch";
import { toastManager } from "../components/ui/toast";
import { cn } from "../lib/utils";
import { aldoOffboarding } from "./accountApi";
import { ErrorLine, Initials, OpenRow } from "./AldoOrgParts";
import {
  ALDO_WORK_LABELS,
  aldoAccountState,
  aldoClosesLine,
  aldoDeparturesCopying,
  aldoDepartureWhen,
  aldoDepartureWork,
  aldoHandoverActions,
  aldoHandoverLineText,
  aldoLinksLine,
  aldoRemoveSummary,
  aldoWorkHelp,
  type AldoDeparture,
  type AldoHandoverLine,
  type AldoLeaving,
  type AldoRemoveChoice,
  type AldoWork,
} from "./offboarding.logic";
import { aldoOrgKeeps, type AldoOrg } from "./organization.logic";
import { settingsOrg, settingsOrgDepartures } from "./settingsData";
import { useSettingsResource } from "./settingsResource";

const messageOf = (cause: unknown) =>
  cause instanceof Error && cause.message ? cause.message : "Something went wrong. Try again.";

/**
 * What removing `id` (or leaving, for the user's own) would do, read while
 * `enabled`: undefined while it loads or after it fails, null from an Aldo
 * without offboarding.
 */
export function useLeaving(id: string, enabled: boolean) {
  const [read, setRead] = useState<{
    readonly id: string;
    readonly leaving: AldoLeaving | null | undefined;
    readonly error: string | null;
  } | null>(null);
  // Only the latest read's answer shows.
  const latest = useRef(0);
  const load = useCallback(() => {
    if (!id) return;
    const request = ++latest.current;
    aldoOffboarding.leaving(id).then(
      (leaving) => request === latest.current && setRead({ id, leaving, error: null }),
      (cause: unknown) =>
        request === latest.current && setRead({ id, leaving: undefined, error: messageOf(cause) }),
    );
  }, [id]);
  useEffect(() => {
    if (!enabled) return;
    load();
    return () => {
      latest.current += 1;
    };
  }, [enabled, load]);
  const mine = read?.id === id ? read : null;
  return {
    leaving: mine?.leaving,
    error: mine?.error ?? null,
    retry: () => {
      setRead(null);
      load();
    },
  };
}

const WORKS: ReadonlyArray<AldoWork> = ["hand", "keep", "delete"];

/** Who gets the threads: the user as "You", the rest by address. */
function ColleaguePicker(props: {
  org: AldoOrg;
  colleagues: AldoLeaving["colleagues"];
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const chosen = props.colleagues.find((c) => c.id === props.value);
  const name = (c: { id: string; email: string }) => (c.id === props.org.you ? "You" : c.email);
  return (
    <Select
      value={props.value ?? ""}
      onValueChange={(value) => typeof value === "string" && value && props.onChange(value)}
      disabled={props.disabled}
    >
      <SelectTrigger className="w-full" aria-label={props.label ?? "Hand them to"}>
        <SelectValue>{chosen ? name(chosen) : "Choose someone"}</SelectValue>
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false}>
        {props.colleagues.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            <span className="[overflow-wrap:anywhere]">{name(c)}</span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

/**
 * Removing someone, in their sheet: what it does, then what becomes of their
 * threads and links. Loading, it holds its place; from an Aldo without
 * offboarding, it asks as it did before.
 */
export function RemoveStep(props: {
  org: AldoOrg;
  read: ReturnType<typeof useLeaving>;
  choice: AldoRemoveChoice;
  onChoice: (choice: AldoRemoveChoice) => void;
  busy: boolean;
}) {
  const { org, read, choice, busy } = props;
  const leaving = read.leaving;
  if (leaving === undefined) {
    return read.error ? (
      <div className="flex flex-wrap items-center gap-3">
        <p role="alert" className="min-w-0 flex-1 text-destructive-foreground text-sm">
          Couldn’t check what happens to their threads. {read.error}
        </p>
        <Button size="sm" variant="outline" onClick={read.retry}>
          Try again
        </Button>
      </div>
    ) : (
      <div
        className="flex flex-col gap-2 py-1"
        aria-busy="true"
        aria-label="Checking their threads"
      >
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="mt-2 h-24 w-full rounded-xl" />
      </div>
    );
  }
  if (leaving === null) {
    return (
      <p className="text-sm">
        Remove them from {org.name}? {aldoOrgKeeps(org, "theirs")} Their account carries on without
        the organization.
      </p>
    );
  }
  const set = (change: Partial<AldoRemoveChoice>) => props.onChoice({ ...choice, ...change });
  return (
    <>
      <p className="text-sm">{aldoRemoveSummary(org, leaving)}</p>
      {leaving.managed ? (
        <Alert variant="warning" controlAlignment="first-line">
          <TriangleAlertIcon />
          <AlertDescription>{aldoClosesLine(org, leaving)}</AlertDescription>
        </Alert>
      ) : null}
      {leaving.threads && leaving.choose ? (
        <div className="flex flex-col gap-1.5">
          <p id="aldo-their-threads" className="font-medium text-sm">
            Their threads
          </p>
          <RadioGroup
            aria-labelledby="aldo-their-threads"
            value={choice.work}
            onValueChange={(value) => set({ work: value as AldoWork })}
            className="gap-0 overflow-hidden rounded-xl border"
          >
            {WORKS.map((work) => (
              <div key={work} className="border-t first:border-t-0">
                <label
                  className={cn(
                    "flex min-h-12 items-start gap-3 px-3 py-3 text-sm",
                    busy ? "cursor-default" : "cursor-pointer",
                  )}
                >
                  <Radio value={work} disabled={busy} className="mt-0.5" />
                  <span className="space-y-0.5">
                    <span
                      className={cn(
                        "block font-medium",
                        work === "delete" &&
                          choice.work === "delete" &&
                          "text-destructive-foreground",
                      )}
                    >
                      {ALDO_WORK_LABELS[work]}
                    </span>
                    <span className="block text-muted-foreground text-xs">
                      {aldoWorkHelp(work, leaving.threads)}
                    </span>
                  </span>
                </label>
                {work === "hand" && choice.work === "hand" ? (
                  <div className="ps-10 pe-3 pb-3">
                    <ColleaguePicker
                      org={org}
                      colleagues={leaving.colleagues}
                      value={choice.to}
                      onChange={(to) => set({ to })}
                      disabled={busy}
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </RadioGroup>
        </div>
      ) : null}
      {leaving.shares && leaving.choose ? (
        <div className="flex items-start justify-between gap-3 rounded-xl border px-3 py-3">
          <span className="space-y-0.5">
            <span className="block font-medium text-sm">Keep their links working</span>
            <span className="block text-muted-foreground text-xs">
              {aldoLinksLine(leaving.shares)}
            </span>
          </span>
          <Switch
            aria-label="Keep their links working"
            checked={choice.keepLinks}
            disabled={busy}
            onCheckedChange={(keepLinks) => set({ keepLinks })}
          />
        </div>
      ) : null}
    </>
  );
}

/**
 * Settings → Members, for owners and admins: who left or was removed lately,
 * and where their threads went. Nothing until there's someone, and nothing
 * from an Aldo without it.
 */
export function FormerMembers({ org }: { org: AldoOrg }) {
  const { data: departures } = useSettingsResource(settingsOrgDepartures);
  const [open, setOpen] = useState<string | null>(null);
  // While copies are being made, read again until they're done.
  const copying = Boolean(departures && aldoDeparturesCopying(departures));
  useEffect(() => {
    if (!copying) return;
    const timer = window.setInterval(
      () => void settingsOrgDepartures.refresh().catch(() => undefined),
      10_000,
    );
    return () => window.clearInterval(timer);
  }, [copying]);
  if (!departures?.length) return null;
  const yourEmail = org.members.find((m) => m.id === org.you)?.email ?? null;
  const selected = departures.find((d) => d.id === open);
  return (
    <>
      <SettingsSection title={`Former members · ${departures.length}`}>
        {departures.map((d) => {
          const account = aldoAccountState(d);
          return (
            <OpenRow
              key={d.id}
              leading={<Initials of={d.email} className="opacity-70" />}
              title={
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="[overflow-wrap:anywhere]">{d.email}</span>
                  {account ? (
                    <Badge
                      variant={account.badge === "Closed" ? "warning" : "outline"}
                      size="sm"
                      className={
                        account.badge === "Closed" ? undefined : "font-normal text-muted-foreground"
                      }
                    >
                      {account.badge}
                    </Badge>
                  ) : null}
                </span>
              }
              description={`${aldoDepartureWhen(d, yourEmail)} · ${aldoDepartureWork(d)}`}
              onOpen={() => setOpen(d.id)}
            />
          );
        })}
      </SettingsSection>
      {selected ? (
        <DepartureSheet
          key={selected.id}
          org={org}
          departure={selected}
          yourEmail={yourEmail}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}

/** A former member: their closed account, and each of their threads' copies with what an admin can do. */
function DepartureSheet(props: {
  org: AldoOrg;
  departure: AldoDeparture;
  yourEmail: string | null;
  onClose: () => void;
}) {
  const { org, departure } = props;
  const account = aldoAccountState(departure);
  const [restoring, setRestoring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await work();
      return true;
    } catch (cause) {
      setError(messageOf(cause));
      return false;
    } finally {
      // As it is now, whether that went or was refused because it changed meanwhile.
      void settingsOrgDepartures.refresh().catch(() => undefined);
      setBusy(false);
    }
  };
  const restore = () =>
    void run(async () => {
      const departures = await aldoOffboarding.restore(departure.id);
      if (departures) settingsOrgDepartures.set(departures);
      void settingsOrg.refresh().catch(() => undefined);
    }).then((ok) => {
      if (!ok) return;
      toastManager.add({ type: "success", title: `Restored ${departure.email}` });
      setRestoring(false);
    });
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && props.onClose()}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle className="pe-8 [overflow-wrap:anywhere]">{departure.email}</DialogTitle>
          <DialogDescription>{aldoDepartureWhen(departure, props.yourEmail)}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {restoring ? (
            <p className="text-sm">
              Restore {departure.email}’s account? They can sign in again, and they’re back in{" "}
              {org.name} as a member, taking a seat. Their threads stay where they went.
            </p>
          ) : (
            <>
              {account ? (
                <div className="flex flex-col gap-2 rounded-xl border px-3 py-3">
                  <p className="text-sm">{account.line}</p>
                  {account.restorable ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="self-start"
                      disabled={busy}
                      onClick={() => setRestoring(true)}
                    >
                      Restore account
                    </Button>
                  ) : null}
                </div>
              ) : null}
              <div className="flex flex-col gap-1.5">
                <p className="font-medium text-sm">Their threads</p>
                {departure.handovers.length ? (
                  <ul className="overflow-hidden rounded-xl border">
                    {departure.handovers.map((line) => (
                      <HandoverItem key={line.id} org={org} line={line} busy={busy} run={run} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    They had no threads in {org.name}.
                  </p>
                )}
                {!departure.keepLinks ? (
                  <p className="text-muted-foreground text-xs">Their share links were stopped.</p>
                ) : null}
              </div>
            </>
          )}
          <ErrorLine error={error} />
        </DialogPanel>
        <DialogFooter>
          {restoring ? (
            <>
              <Button variant="outline" disabled={busy} onClick={() => setRestoring(false)}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={restore}>
                Restore account
              </Button>
            </>
          ) : (
            <DialogClose render={<Button variant="outline" />} disabled={busy}>
              Done
            </DialogClose>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** One thread's copy: its state, and trying it again, handing it on or deleting it, each asked in place. */
function HandoverItem(props: {
  org: AldoOrg;
  line: AldoHandoverLine;
  busy: boolean;
  run: (work: () => Promise<unknown>) => Promise<boolean>;
}) {
  const { org, line, busy } = props;
  const actions = aldoHandoverActions(line, org.you);
  const [step, setStep] = useState<"hand" | "delete" | null>(null);
  const [to, setTo] = useState<string | null>(org.you);
  const people = org.members.map((m) => ({ id: m.id, email: m.email }));
  const done = (ok: boolean) => ok && setStep(null);
  return (
    <li className="flex flex-col gap-2 border-t px-3 py-3 first:border-t-0">
      <div className="flex min-w-0 items-start gap-2">
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="block text-sm [overflow-wrap:anywhere]">
            {line.title.trim() || "Untitled"}
          </span>
          <span
            className={cn(
              "flex items-center gap-1.5 text-xs",
              line.state === "failed" ? "text-destructive-foreground" : "text-muted-foreground",
            )}
          >
            {line.state === "copying" ? (
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full bg-current motion-safe:animate-status-pulse"
              />
            ) : null}
            <span className="[overflow-wrap:anywhere]">{aldoHandoverLineText(line, org.you)}</span>
          </span>
        </span>
      </div>
      {step === "hand" ? (
        <div className="flex flex-col gap-2">
          <ColleaguePicker
            org={org}
            colleagues={people}
            value={to}
            onChange={setTo}
            disabled={busy}
            label="Hand it to"
          />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setStep(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy || !to}
              onClick={() =>
                to && void props.run(() => aldoOffboarding.hand(line.id, to)).then(done)
              }
            >
              Hand it over
            </Button>
          </div>
        </div>
      ) : step === "delete" ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">Delete this copy? Its conversation and files are gone for good.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setStep(null)}>
              Keep it
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => void props.run(() => aldoOffboarding.delete(line.id)).then(done)}
            >
              Delete copy
            </Button>
          </div>
        </div>
      ) : actions.open || actions.retry || actions.hand || actions.delete ? (
        <div className="flex flex-wrap gap-2">
          {actions.open ? (
            <Button
              size="sm"
              variant="outline"
              render={<Link to="/library/handed/$handoverId" params={{ handoverId: line.id }} />}
            >
              Open
            </Button>
          ) : null}
          {actions.retry ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void props.run(() => aldoOffboarding.retry(line.id))}
            >
              Try again
            </Button>
          ) : null}
          {actions.hand ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setStep("hand")}>
              Hand to…
            </Button>
          ) : null}
          {actions.delete ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive-foreground"
              disabled={busy}
              onClick={() => setStep("delete")}
            >
              Delete
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
