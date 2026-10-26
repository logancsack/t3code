// Settings → Members → a member (orgAdmin.logic.ts), for owners and admins:
// their month's credits and extra usage, what's running with Stop, the
// organization's threads of theirs by title, one private line for the rest,
// and their limit, pause and role. Never what's in a thread. Aldo decides who
// may do what; this shows its words when it refuses.

import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { SettingsSection } from "../components/settings/settingsLayout";
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
import { Input } from "../components/ui/input";
import { Radio, RadioGroup } from "../components/ui/radio-group";
import { toastManager } from "../components/ui/toast";
import { aldoOrgAdmin } from "./accountApi";
import { MemberSheet, opensFor, YourRoleSheet } from "./AldoMembersPage";
import {
  refreshOrgUsage,
  RunningDot,
  RunningRow,
  StopAllSheet,
  StopSheet,
  useOrgRead,
} from "./AldoOrgAdminParts";
import { ErrorLine, Initials, OpenRow, useLoadedOrg } from "./AldoOrgParts";
import {
  aldoCreditDay,
  aldoCredits,
  aldoDollars,
  aldoExtraLine,
  aldoLimitChoices,
  aldoLimitHelp,
  aldoLimitLine,
  aldoMonthLabel,
  aldoPauseSentence,
  aldoPersonalLine,
  aldoRestLine,
  aldoRoleLine,
  aldoSeatCredits,
  aldoThreadLine,
  aldoWhatAdminsSee,
  aldoPausedLine,
  type AldoMemberPage as MemberPage,
  type AldoOrgThread,
  type AldoRunningThread,
} from "./orgAdmin.logic";
import { ALDO_ORG_ROLE_LABELS, aldoOrgManages, type AldoOrg } from "./organization.logic";

const messageOf = (cause: unknown) =>
  cause instanceof Error && cause.message ? cause.message : "Something went wrong. Try again.";

type Sheet =
  | { readonly kind: "stop"; readonly thread: AldoRunningThread }
  | { readonly kind: "stopAll" }
  | { readonly kind: "thread"; readonly thread: AldoOrgThread }
  | { readonly kind: "limit" }
  | { readonly kind: "pause" }
  | { readonly kind: "role" };

export function AldoMemberPage({ memberId }: { memberId: string }) {
  const { org, fallback } = useLoadedOrg();
  const navigate = useNavigate();
  const manages = org ? aldoOrgManages(org) : null;
  // Only owners and admins have these pages; a member sees Members as it was.
  useEffect(() => {
    if (manages === false) void navigate({ to: "/settings/members", replace: true });
  }, [manages, navigate]);
  if (!org) return fallback;
  if (!manages) return null;
  return <MemberMonth key={memberId} org={org} memberId={memberId} />;
}

function MemberMonth({ org, memberId }: { org: AldoOrg; memberId: string }) {
  const navigate = useNavigate();
  const { data: page, error, reload } = useOrgRead(() => aldoOrgAdmin.member(memberId), 30_000);
  const [sheet, setSheet] = useState<Sheet | null>(null);

  if (page === undefined) {
    return error ? (
      <SettingsSection title="Member" hideTitle>
        <div className="flex flex-wrap items-center gap-3 px-3 py-3 sm:px-4">
          <p className="min-w-0 flex-1 text-destructive-foreground text-sm">{error}</p>
          <Button size="sm" variant="outline" onClick={() => void reload()}>
            Try again
          </Button>
        </div>
      </SettingsSection>
    ) : null;
  }
  if (page === null) return <NotHere org={org} />;

  const you = page.member.id === org.you;
  const seat = page.usage.seat;
  const close = () => setSheet(null);
  const changed = () => {
    void reload();
    refreshOrgUsage();
  };
  const listed = org.members.find((m) => m.id === page.member.id);
  const stoppable = page.running.filter((t) => t.canStop);
  const anyRunning = page.threads.some((t) => t.running);

  return (
    <>
      <div className="flex items-center gap-3 px-1">
        <Initials of={page.member.email} className="size-12 text-sm" />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-foreground text-base [overflow-wrap:anywhere]">
            {page.member.email}
            {page.usage.paused ? (
              <Badge variant="warning" size="sm">
                Paused
              </Badge>
            ) : null}
          </p>
          <p className="text-muted-foreground text-sm">
            {you ? "You · " : ""}
            {aldoRoleLine(page.member.role, page.member.joinedAt)}
          </p>
        </div>
      </div>

      {page.usage.paused ? (
        <p className="rounded-xl border border-warning/30 bg-warning/8 px-3 py-2.5 text-sm text-warning-foreground sm:px-4">
          {aldoPausedLine(page.usage.paused, you)}
        </p>
      ) : null}

      <SettingsSection title={aldoMonthLabel(page.month)}>
        <OpenRow title="Credits" value={aldoSeatCredits(page.usage)} onOpen={null} />
        {seat ? (
          <>
            <OpenRow title="Extra usage" value={aldoExtraLine(seat)} onOpen={null} />
            <OpenRow
              title="Extra usage limit"
              value={aldoLimitLine(seat)}
              onOpen={page.can.limit ? () => setSheet({ kind: "limit" }) : null}
            />
          </>
        ) : null}
      </SettingsSection>

      {page.running.length ? (
        <SettingsSection
          title="Running now"
          headerAction={
            stoppable.length > 1 ? (
              <Button size="xs" variant="ghost" onClick={() => setSheet({ kind: "stopAll" })}>
                Stop all {stoppable.length}
              </Button>
            ) : null
          }
        >
          {page.running.map((t) => (
            <RunningRow
              key={t.id}
              thread={t}
              you={org.you}
              onStop={(thread) => setSheet({ kind: "stop", thread })}
            />
          ))}
        </SettingsSection>
      ) : null}

      <SettingsSection title={`Threads in ${org.name}`}>
        {page.threads.length ? null : (
          <p className="px-3 py-3 text-muted-foreground text-sm sm:px-4">
            No threads in {org.name} this month.
          </p>
        )}
        {page.threads.map((t) => (
          <OpenRow
            key={t.id}
            leading={
              anyRunning ? (
                t.running ? (
                  <RunningDot />
                ) : (
                  <span aria-hidden="true" className="inline-block size-2 shrink-0" />
                )
              ) : undefined
            }
            title={t.title || "Untitled thread"}
            description={aldoThreadLine(t)}
            value={`${aldoCredits(t.credits)} credits`}
            onOpen={() => setSheet({ kind: "thread", thread: t })}
          />
        ))}
        {page.rest?.threads ? (
          <OpenRow
            title={aldoRestLine(org.name, page.rest)}
            value={`${aldoCredits(page.rest.credits)} credits`}
            onOpen={null}
          />
        ) : null}
        {page.personal.threads || page.personal.credits ? (
          <OpenRow
            title={aldoPersonalLine(org.name, page.personal)}
            value={`${aldoCredits(page.personal.credits)} credits`}
            onOpen={null}
          />
        ) : null}
        {page.other ? (
          <OpenRow
            title="Home and builds"
            value={`${aldoCredits(page.other)} credits`}
            onOpen={null}
          />
        ) : null}
      </SettingsSection>

      <SettingsSection title={you ? "Your place" : "Their place"}>
        <OpenRow
          title="Role"
          value={ALDO_ORG_ROLE_LABELS[page.member.role]}
          onOpen={listed && opensFor(org, listed) ? () => setSheet({ kind: "role" }) : null}
        />
        {page.can.pause ? (
          <OpenRow
            title={page.usage.paused ? "Resume their work" : "Pause their work"}
            description={
              page.usage.paused
                ? "Their agents can start again."
                : "Stops their machines, and nothing of theirs starts until you resume it."
            }
            onOpen={() => setSheet({ kind: "pause" })}
          />
        ) : null}
        <OpenRow
          title="Activity"
          description={
            you
              ? "What you did, and what was done to your work."
              : "What they did, and what admins did to their work."
          }
          onOpen={() =>
            void navigate({ to: "/settings/activity", search: { person: page.member.id } })
          }
        />
      </SettingsSection>

      <p className="px-1 text-muted-foreground text-xs">
        {aldoWhatAdminsSee(page.member.email, you)}
      </p>

      {sheet?.kind === "stop" ? (
        <StopSheet thread={sheet.thread} you={org.you} onClose={close} onStopped={changed} />
      ) : null}
      {sheet?.kind === "stopAll" ? (
        <StopAllSheet
          threads={page.running}
          member={page.member}
          onClose={close}
          onStopped={changed}
        />
      ) : null}
      {sheet?.kind === "thread" ? (
        <ThreadSheet key={sheet.thread.id} thread={sheet.thread} onClose={close} />
      ) : null}
      {sheet?.kind === "limit" ? (
        <LimitSheet page={page} you={you} onClose={close} onChanged={changed} />
      ) : null}
      {sheet?.kind === "pause" ? (
        <PauseSheet page={page} org={org} onClose={close} onChanged={changed} />
      ) : null}
      {sheet?.kind === "role" && listed ? (
        you ? (
          <YourRoleSheet org={org} onClose={close} />
        ) : (
          <MemberSheet
            org={org}
            member={listed}
            onClose={close}
            onRemoved={() => void navigate({ to: "/settings/members", replace: true })}
          />
        )
      ) : null}
    </>
  );
}

function NotHere({ org }: { org: AldoOrg }) {
  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-card/40 px-3 py-3.5 sm:px-4">
      <p className="text-sm">They’re not in {org.name} anymore.</p>
      <Button size="sm" variant="outline" render={<Link to="/settings/members" />}>
        Back to Members
      </Button>
    </div>
  );
}

/** A thread's credits this month by day. Never what's in it. */
function ThreadSheet({ thread, onClose }: { thread: AldoOrgThread; onClose: () => void }) {
  const { data, error, reload } = useOrgRead(() => aldoOrgAdmin.thread(thread.id));
  const days = data?.days ?? [];
  const top = Math.max(1, ...days.map((d) => d.credits));
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle className="pe-8 [overflow-wrap:anywhere]">
            {thread.title || "Untitled thread"}
          </DialogTitle>
          <DialogDescription>
            {aldoThreadLine(thread)} · {aldoCredits(data?.credits ?? thread.credits)} credits this
            month
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {data === undefined && !error ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : null}
          {error ? (
            <div className="flex flex-wrap items-center gap-3">
              <ErrorLine error={error} />
              <Button size="sm" variant="outline" onClick={() => void reload()}>
                Try again
              </Button>
            </div>
          ) : null}
          {data === null ? (
            <p className="text-muted-foreground text-sm">
              This thread isn’t in the organization anymore.
            </p>
          ) : null}
          {data && !days.length ? (
            <p className="text-muted-foreground text-sm">No credits used this month.</p>
          ) : null}
          {days.length ? (
            <ul className="space-y-1.5" aria-label="Credits by day">
              {days.map((d) => (
                <li key={d.day} className="flex items-center gap-3 text-sm">
                  <span className="w-14 shrink-0 text-muted-foreground tabular-nums">
                    {aldoCreditDay(d.day)}
                  </span>
                  <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-primary/70"
                      style={{ width: `${Math.max(2, (d.credits / top) * 100)}%` }}
                    />
                  </span>
                  <span className="w-16 shrink-0 text-right tabular-nums">
                    {aldoCredits(d.credits)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-muted-foreground text-xs">
            Credits are counted by day in UTC. What’s in the thread stays its member’s.
          </p>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Done</DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

const DEFAULT = "default";
const CUSTOM = "custom";

/** Their extra usage limit: the organization's default, Off, the usual amounts, or one typed in. */
function LimitSheet(props: {
  page: MemberPage;
  you: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { page } = props;
  const seat = page.usage.seat!;
  const fallback = page.defaultLimitCents;
  const { amounts, chosen } = aldoLimitChoices(seat, fallback);
  const initial = chosen === "default" ? DEFAULT : chosen === "custom" ? CUSTOM : String(chosen);
  const [choice, setChoice] = useState(initial);
  const [custom, setCustom] = useState(initial === CUSTOM ? String(seat.limitCents / 100) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customCents = Math.round(Number(custom) * 100);
  const customValid = custom.trim() !== "" && Number.isFinite(customCents) && customCents >= 0;
  const cents =
    choice === DEFAULT
      ? null
      : choice === CUSTOM
        ? customValid
          ? customCents
          : NaN
        : Number(choice);
  const unchanged = choice === initial && (choice !== CUSTOM || customCents === seat.limitCents);
  const save = () => {
    if (cents !== null && !Number.isFinite(cents)) return;
    setBusy(true);
    setError(null);
    aldoOrgAdmin
      .setLimit(page.member.id, cents)
      .then(
        () => {
          toastManager.add({ type: "success", title: "Limit saved" });
          props.onChanged();
          props.onClose();
        },
        (cause: unknown) => setError(messageOf(cause)),
      )
      .finally(() => setBusy(false));
  };
  const label = (cents: number) => (cents === 0 ? "Off" : `${aldoDollars(cents)} a month`);
  const options: Array<{ value: string; label: string }> = [
    ...(fallback === null
      ? []
      : [{ value: DEFAULT, label: `${label(fallback)} · organization default` }]),
    ...amounts.map((cents) => ({ value: String(cents), label: label(cents) })),
    { value: CUSTOM, label: "Another amount" },
  ];
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && props.onClose()}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle className="pe-8 [overflow-wrap:anywhere]">
            {props.you ? "Your extra usage limit" : `Extra usage limit for ${page.member.email}`}
          </DialogTitle>
          <DialogDescription>{aldoLimitHelp(page, props.you)}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <RadioGroup
            aria-label="Extra usage limit"
            value={choice}
            onValueChange={(value) => setChoice(String(value))}
            className="gap-0 overflow-hidden rounded-xl border"
          >
            {options.map((option) => (
              <label
                key={option.value}
                className="flex min-h-11 cursor-pointer items-center gap-3 border-t px-3 py-2.5 text-sm first:border-t-0"
              >
                <Radio value={option.value} />
                <span>{option.label}</span>
              </label>
            ))}
          </RadioGroup>
          {choice === CUSTOM ? (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">$</span>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                max={1000}
                step={1}
                autoFocus
                aria-label="Limit in dollars a month"
                value={custom}
                onChange={(event) => setCustom(event.currentTarget.value)}
                className="max-w-32"
              />
              <span className="text-muted-foreground">a month</span>
            </label>
          ) : null}
          <ErrorLine error={error} />
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={busy}>
            Cancel
          </DialogClose>
          <Button
            disabled={busy || unchanged || (choice === CUSTOM && !customValid)}
            onClick={save}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** Pausing someone's work, or resuming it. */
function PauseSheet(props: {
  page: MemberPage;
  org: AldoOrg;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { page } = props;
  const paused = Boolean(page.usage.paused);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const change = () => {
    setBusy(true);
    setError(null);
    aldoOrgAdmin
      .setPaused(page.member.id, !paused)
      .then(
        () => {
          toastManager.add({
            type: "success",
            title: paused ? "Work resumed" : "Work paused",
            description: page.member.email,
          });
          props.onChanged();
          props.onClose();
        },
        (cause: unknown) => {
          setError(messageOf(cause));
          props.onChanged();
        },
      )
      .finally(() => setBusy(false));
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && props.onClose()}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle className="pe-8 [overflow-wrap:anywhere]">
            {paused ? `Resume ${page.member.email}’s work?` : `Pause ${page.member.email}’s work?`}
          </DialogTitle>
          <DialogDescription>
            {paused
              ? "Their threads, routines and Home can start again, and they’re told you resumed it."
              : aldoPauseSentence(page, props.org.name)}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <DialogPanel>
            <ErrorLine error={error} />
          </DialogPanel>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={busy}>
            Cancel
          </DialogClose>
          <Button variant={paused ? "default" : "destructive"} disabled={busy} onClick={change}>
            {paused ? "Resume" : "Pause their work"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
