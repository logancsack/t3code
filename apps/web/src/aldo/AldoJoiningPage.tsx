// Settings → Organization → Who can join (orgJoining.logic.ts), for owners and
// admins: what people at the organization's verified domains may do, the
// domains and the DNS record that proves each, and the invite link. An Aldo
// without it shows nothing of it; Aldo decides, and this shows its words when
// it refuses.

import { useNavigate } from "@tanstack/react-router";
import { CheckIcon, CopyIcon, GlobeIcon, LinkIcon, PlusIcon, SendIcon } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

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
import { Switch } from "../components/ui/switch";
import { toastManager } from "../components/ui/toast";
import { cn } from "../lib/utils";
import { aldoOrgJoining } from "./accountApi";
import { AldoIconTile } from "./AldoBrandTile";
import { ErrorLine, OpenRow, useJoiningChange, useLoadedOrg } from "./AldoOrgParts";
import { aldoOrgManages, type AldoOrg } from "./organization.logic";
import {
  ALDO_JOIN_POLICIES,
  ALDO_JOIN_POLICY_HELP,
  ALDO_JOIN_POLICY_LABELS,
  ALDO_LINK_DAYS,
  aldoDomainLine,
  aldoDomainStatus,
  aldoDomainSteps,
  aldoFoundLine,
  aldoLinkExpires,
  aldoLinkFor,
  aldoLinkSummary,
  aldoLinkUsed,
  aldoRecordHost,
  aldoVerifiedDomains,
  type AldoJoining,
  type AldoJoinPolicy,
  type AldoOrgDomain,
} from "./orgJoining.logic";
import { settingsOrgJoining } from "./settingsData";
import { useSettingsResource } from "./settingsResource";

type Sheet =
  | { readonly kind: "add" }
  | { readonly kind: "domain"; readonly id: string }
  | { readonly kind: "link" };

const messageOf = (cause: unknown) =>
  cause instanceof Error && cause.message ? cause.message : "Something went wrong. Try again.";

/** Copies text, saying so; false where the browser won't. */
async function copy(text: string, what: string): Promise<void> {
  const copied = await (navigator.clipboard?.writeText(text) ?? Promise.reject()).then(
    () => true,
    () => false,
  );
  toastManager.add(
    copied
      ? { type: "success", title: `${what} copied` }
      : { type: "error", title: `Couldn’t copy the ${what.toLowerCase()}`, description: text },
  );
}

export function AldoJoiningPage() {
  const navigate = useNavigate();
  const { org, fallback } = useLoadedOrg();
  const manages = Boolean(org && aldoOrgManages(org));
  const { data: joining, error } = useSettingsResource(settingsOrgJoining, manages);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  // Members don't choose who can join, and an Aldo without it has nothing here.
  useEffect(() => {
    if ((org && !manages) || joining === null)
      void navigate({ to: "/settings/organization", replace: true });
  }, [joining, manages, navigate, org]);
  if (!org) return fallback;
  if (!joining) {
    return joining === undefined && error ? (
      <SettingsSection title="Who can join" hideTitle>
        <div className="flex flex-wrap items-center gap-3 px-3 py-3 sm:px-4">
          <p className="min-w-0 flex-1 text-destructive-foreground text-sm">
            Couldn’t load who can join.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void settingsOrgJoining.refresh().catch(() => undefined)}
          >
            Try again
          </Button>
        </div>
      </SettingsSection>
    ) : null;
  }

  const verified = aldoVerifiedDomains(joining);
  const close = () => setSheet(null);
  const domain =
    sheet?.kind === "domain" ? joining.domains.find((d) => d.id === sheet.id) : undefined;

  return (
    <>
      <SettingsSection title="People at your domains">
        <PolicyChoice joining={joining} canChoose={verified.length > 0} />
      </SettingsSection>

      <SettingsSection
        title="Domains"
        headerAction={
          <Button size="xs" variant="ghost" onClick={() => setSheet({ kind: "add" })}>
            <PlusIcon /> Add
          </Button>
        }
      >
        {joining.domains.length ? null : (
          <p className="px-3 py-3 text-muted-foreground text-sm sm:px-4">
            None yet. Add the domain in your team’s email addresses, like lindenpartners.com, and
            prove it with one DNS record.
          </p>
        )}
        {joining.domains.map((d) => (
          <OpenRow
            key={d.id}
            leading={<AldoIconTile icon={<GlobeIcon />} />}
            title={
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="[overflow-wrap:anywhere]">{d.domain}</span>
                <DomainBadge domain={d} />
              </span>
            }
            description={aldoDomainLine(d)}
            onOpen={() => setSheet({ kind: "domain", id: d.id })}
          />
        ))}
      </SettingsSection>

      <SettingsSection title="Invite link" hideTitle>
        <OpenRow
          leading={<AldoIconTile icon={<LinkIcon />} />}
          title="Invite link"
          description={
            joining.link
              ? aldoLinkFor(joining.link, verified)
              : "Off. One link that fills free seats, for a team at once."
          }
          value={aldoLinkSummary(joining.link)}
          onOpen={() => setSheet({ kind: "link" })}
        />
      </SettingsSection>

      <p className="px-1 text-muted-foreground text-xs">
        {verified.length
          ? `Anyone else, anywhere, needs an invite. New accounts at your domains can only be made through ${org.name}.`
          : "Until a domain is verified, people need an invite."}
      </p>

      {sheet?.kind === "add" ? (
        <AddDomainSheet
          joining={joining}
          onClose={close}
          onAdded={(id) => setSheet({ kind: "domain", id })}
        />
      ) : null}
      {domain ? <DomainSheet key={domain.id} org={org} domain={domain} onClose={close} /> : null}
      {sheet?.kind === "link" ? <LinkSheet org={org} joining={joining} onClose={close} /> : null}
    </>
  );
}

function DomainBadge({ domain }: { domain: AldoOrgDomain }) {
  if (domain.taken) return null;
  if (domain.state === "verified")
    return (
      <Badge variant="success" size="sm">
        Verified
      </Badge>
    );
  if (domain.state === "lost")
    return (
      <Badge variant="warning" size="sm">
        Record gone
      </Badge>
    );
  return (
    <Badge variant="outline" size="sm" className="font-normal text-muted-foreground">
      Waiting
    </Badge>
  );
}

/** Invite only, ask an admin, or join right away; chosen once a domain is verified. */
function PolicyChoice({ joining, canChoose }: { joining: AldoJoining; canChoose: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const choose = (policy: AldoJoinPolicy) => {
    setError(null);
    settingsOrgJoining
      .mutate(
        (now) => (now ? { ...now, policy } : now),
        () => aldoOrgJoining.setPolicy(policy),
      )
      .catch((cause: unknown) => setError(messageOf(cause)));
  };
  const shown: AldoJoinPolicy = canChoose ? joining.policy : "invite";
  return (
    <div className="space-y-2 px-3 py-3 sm:px-4">
      <RadioGroup
        aria-label="People at your domains"
        value={shown}
        onValueChange={(value) => choose(value as AldoJoinPolicy)}
        disabled={!canChoose}
        className="gap-0 overflow-hidden rounded-xl border"
      >
        {ALDO_JOIN_POLICIES.map((p) => (
          <label
            key={p}
            className={cn(
              "flex min-h-12 items-start gap-3 border-t px-3 py-3 text-sm first:border-t-0",
              canChoose ? "cursor-pointer" : "cursor-default text-muted-foreground",
            )}
          >
            <Radio value={p} className="mt-0.5" />
            <span className="space-y-0.5">
              <span className="block font-medium">
                {ALDO_JOIN_POLICY_LABELS[p]}
                {p === "ask" ? (
                  <span className="font-normal text-muted-foreground"> · recommended</span>
                ) : null}
              </span>
              <span className="block text-muted-foreground text-xs">
                {ALDO_JOIN_POLICY_HELP[p]}
              </span>
            </span>
          </label>
        ))}
      </RadioGroup>
      {canChoose ? null : (
        <p className="text-muted-foreground text-xs">
          Verify a domain first. Until then, people need an invite.
        </p>
      )}
      <ErrorLine error={error} />
    </div>
  );
}

function AddDomainSheet(props: {
  joining: AldoJoining;
  onClose: () => void;
  onAdded: (id: string) => void;
}) {
  const [value, setValue] = useState("");
  const { busy, error, run } = useJoiningChange();
  const before = new Set(props.joining.domains.map((d) => d.id));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(() => aldoOrgJoining.addDomain(value)).then((joining) => {
      const added = joining?.domains.find((d) => !before.has(d.id));
      if (added) props.onAdded(added.id);
      else if (joining) props.onClose();
    });
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && props.onClose()}>
      <DialogPopup>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Add a domain</DialogTitle>
            <DialogDescription>
              The part after the @ in your team’s addresses. You’ll prove it with one DNS record.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-2">
            <Input
              autoFocus
              aria-label="Domain"
              placeholder="lindenpartners.com"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="url"
              value={value}
              onChange={(event) => setValue(event.currentTarget.value)}
            />
            <ErrorLine error={error} />
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />} disabled={busy}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={busy || !value.trim()}>
              Add domain
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/** A value to copy, on its own line, as a DNS host's form asks for it. */
function CopyField(props: { label: string; value: string; hint?: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-3 border-t py-2.5 first:border-t-0">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-muted-foreground text-xs">{props.label}</p>
        <p className="font-mono text-sm [overflow-wrap:anywhere]">{props.value}</p>
        {props.hint ? <p className="text-muted-foreground text-xs">{props.hint}</p> : null}
      </div>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Copy the ${props.label.toLowerCase()}`}
        onClick={() => void copy(props.value, props.label)}
      >
        <CopyIcon />
      </Button>
    </div>
  );
}

/** A domain: where it stands, the record that proves it, and checking, sending or removing it. */
function DomainSheet(props: { org: AldoOrg; domain: AldoOrgDomain; onClose: () => void }) {
  const { domain } = props;
  const [removing, setRemoving] = useState(false);
  const { busy, error, run } = useJoiningChange();
  const check = () =>
    void run(() => aldoOrgJoining.checkDomain(domain.id)).then((checked) => {
      if (!checked) return;
      const now = checked.joining.domains.find((d) => d.id === domain.id);
      toastManager.add({
        type: checked.found === "found" && now?.state === "verified" ? "success" : "info",
        title: aldoFoundLine(domain.domain, checked.found, now?.state ?? domain.state),
      });
    });
  const send = () => {
    const text = aldoDomainSteps(props.org.name, domain);
    if (typeof navigator.share === "function") {
      void navigator
        .share({ title: `DNS record for ${domain.domain}`, text })
        .catch(() => undefined);
    } else void copy(text, "Steps");
  };
  const remove = () =>
    void run(() => aldoOrgJoining.removeDomain(domain.id)).then((joining) => {
      if (!joining) return;
      toastManager.add({ type: "success", title: `Removed ${domain.domain}` });
      props.onClose();
    });
  const proving = domain.state !== "verified";
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && props.onClose()}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pe-8 [overflow-wrap:anywhere]">
            {domain.domain} <DomainBadge domain={domain} />
          </DialogTitle>
          <DialogDescription>
            {removing
              ? `Remove ${domain.domain}? Joining by it stops. Nobody is removed from ${props.org.name}.`
              : aldoDomainStatus(domain)}
          </DialogDescription>
        </DialogHeader>
        {removing ? null : (
          <DialogPanel className="space-y-3">
            <div className="rounded-xl border px-3">
              <CopyField label="Type" value="TXT" />
              <CopyField
                label="Name"
                value={domain.record.name}
                hint={`If your DNS host wants the full name: ${aldoRecordHost(domain)}`}
              />
              <CopyField label="Value" value={domain.record.value} />
            </div>
            {proving ? (
              <p className="text-muted-foreground text-xs">
                Someone else runs your DNS? Send them these steps.
              </p>
            ) : null}
            <ErrorLine error={error} />
          </DialogPanel>
        )}
        <DialogFooter>
          {removing ? (
            <>
              <Button variant="outline" disabled={busy} onClick={() => setRemoving(false)}>
                Keep it
              </Button>
              <Button variant="destructive" disabled={busy} onClick={remove}>
                Remove domain
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                className="text-destructive-foreground sm:me-auto"
                disabled={busy}
                onClick={() => setRemoving(true)}
              >
                Remove
              </Button>
              <Button variant="outline" disabled={busy} onClick={send}>
                <SendIcon /> Send these steps
              </Button>
              {domain.taken ? null : (
                <Button variant={proving ? "default" : "outline"} disabled={busy} onClick={check}>
                  <CheckIcon /> Check now
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** How long it works: 1, 7 or 30 days. */
function DaysChoice(props: {
  value: 1 | 7 | 30 | null;
  disabled: boolean;
  onChange: (days: 1 | 7 | 30) => void;
}) {
  return (
    <RadioGroup
      aria-label="Works for"
      value={props.value === null ? "" : String(props.value)}
      onValueChange={(value) => props.onChange(Number(value) as 1 | 7 | 30)}
      disabled={props.disabled}
      className="flex-row gap-2"
    >
      {ALDO_LINK_DAYS.map((days) => (
        <label
          key={days}
          className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 text-sm"
        >
          <Radio value={String(days)} />
          {days === 1 ? "1 day" : `${days} days`}
        </label>
      ))}
    </RadioGroup>
  );
}

/** The invite link: turning it on, copying, its expiry and addresses, replacing and turning it off. */
function LinkSheet(props: { org: AldoOrg; joining: AldoJoining; onClose: () => void }) {
  const { joining } = props;
  const link = joining.link;
  const verified = aldoVerifiedDomains(joining);
  const [days, setDays] = useState<1 | 7 | 30>(7);
  const [onlyDomains, setOnlyDomains] = useState(verified.length > 0);
  const [confirming, setConfirming] = useState<"replace" | "off" | null>(null);
  const { busy, error, run } = useJoiningChange();
  const change = (input: Parameters<typeof aldoOrgJoining.setLink>[0], done?: string) =>
    void run(() => aldoOrgJoining.setLink(input)).then((answer) => {
      if (answer && done) toastManager.add({ type: "success", title: done });
      setConfirming(null);
    });
  const off = () =>
    void run(() => aldoOrgJoining.linkOff()).then((answer) => {
      if (!answer) return;
      toastManager.add({ type: "success", title: "Invite link turned off" });
      props.onClose();
    });
  const full = joining.free <= 0;
  const seats = full ? (
    <p className="text-warning-foreground text-xs">
      No free seats. Until there are, people who open the link are told to wait, and their ask goes
      to Requests.
    </p>
  ) : null;

  if (!link) {
    return (
      <Dialog open onOpenChange={(open) => !open && !busy && props.onClose()}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Invite link</DialogTitle>
            <DialogDescription>
              Whoever opens it gets an invite to their own address, and is in once they confirm it
              by email. It fills only free seats, and joins people as members.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="space-y-2">
              <p className="font-medium text-sm">Works for</p>
              <DaysChoice value={days} disabled={busy} onChange={setDays} />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <p className="font-medium text-sm">
                  {aldoLinkFor({ anyAddress: false }, verified)}
                </p>
                <p className="text-muted-foreground text-xs">
                  {verified.length
                    ? "Off lets any address in, for contractors."
                    : "No domain is verified yet, so it works for any address."}
                </p>
              </div>
              <Switch
                aria-label="Only addresses at your domains"
                checked={onlyDomains && verified.length > 0}
                disabled={busy || !verified.length}
                onCheckedChange={setOnlyDomains}
              />
            </div>
            {seats}
            <ErrorLine error={error} />
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />} disabled={busy}>
              Cancel
            </DialogClose>
            <Button
              disabled={busy}
              onClick={() =>
                change(
                  { days, anyAddress: !(onlyDomains && verified.length > 0) },
                  "Invite link on",
                )
              }
            >
              Turn on invite link
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && props.onClose()}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Invite link</DialogTitle>
          <DialogDescription>
            {confirming === "replace"
              ? "Replace it? The current link stops working at once; share the new one."
              : confirming === "off"
                ? "Turn it off? It stops working at once. Invites it gave still work."
                : "Whoever opens it gets an invite to their own address, and is in once they confirm it by email."}
          </DialogDescription>
        </DialogHeader>
        {confirming ? null : (
          <DialogPanel className="space-y-4">
            <div className="rounded-xl border px-3">
              <CopyField label="Link" value={link.url} />
            </div>
            <div className="space-y-2">
              <p className="font-medium text-sm">
                Expires{" "}
                <span className="font-normal text-muted-foreground">{aldoLinkExpires(link)}</span>
              </p>
              <p className="text-muted-foreground text-xs">Or make it work for, from now:</p>
              <DaysChoice
                value={null}
                disabled={busy}
                onChange={(next) =>
                  change(
                    { days: next },
                    `Works for ${next === 1 ? "1 day" : `${next} days`} from now`,
                  )
                }
              />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <p className="font-medium text-sm">
                  {aldoLinkFor({ anyAddress: false }, verified)}
                </p>
                <p className="text-muted-foreground text-xs">
                  {verified.length
                    ? "Off lets any address in, for contractors."
                    : "No domain is verified, so it works for any address."}
                </p>
              </div>
              <Switch
                aria-label="Only addresses at your domains"
                checked={!link.anyAddress && verified.length > 0}
                disabled={busy || !verified.length}
                onCheckedChange={(checked) => change({ anyAddress: !checked })}
              />
            </div>
            <dl className="rounded-xl border px-3 text-sm">
              <div className="flex min-h-11 items-center justify-between gap-4 py-2.5">
                <dt>Joins it gives</dt>
                <dd className="text-muted-foreground">Member · no team</dd>
              </div>
              <div className="flex min-h-11 items-center justify-between gap-4 border-t py-2.5">
                <dt>Used by</dt>
                <dd className="text-muted-foreground">{aldoLinkUsed(link)}</dd>
              </div>
            </dl>
            {seats}
            <ErrorLine error={error} />
          </DialogPanel>
        )}
        <DialogFooter>
          {confirming ? (
            <>
              <Button variant="outline" disabled={busy} onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  confirming === "off" ? off() : change({ replace: true }, "New link made")
                }
              >
                {confirming === "off" ? "Turn off" : "Replace link"}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                className="text-destructive-foreground sm:me-auto"
                disabled={busy}
                onClick={() => setConfirming("off")}
              >
                Turn off
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setConfirming("replace")}>
                Replace link
              </Button>
              <Button disabled={busy} onClick={() => void copy(link.url, "Link")}>
                <CopyIcon /> Copy link
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
