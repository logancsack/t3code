// Settings → Members (organization.logic.ts): who's in the organization, and
// for owners and admins its invites, each person and invite opening a sheet
// with what the user may do about them. Aldo decides; this shows its words
// when it refuses.

import { useNavigate } from "@tanstack/react-router";
import { CopyIcon, LinkIcon, LockIcon, MailPlusIcon, RefreshCwIcon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

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
import { cn } from "../lib/utils";
import { aldoOrg, aldoOrgJoining } from "./accountApi";
import { FormerMembers, RemoveStep, useLeaving } from "./AldoOffboarding";
import { RunningDot } from "./AldoOrgAdminParts";
import { NewTeamSheet, TeamChecks, TeamsSection } from "./AldoTeamParts";
import {
  ErrorLine,
  Initials,
  OpenRow,
  useJoining,
  useJoiningChange,
  useLoadedOrg,
  useOrgChange,
  type OrgAnswer,
} from "./AldoOrgParts";
import {
  ALDO_ORG_ROLE_HELP,
  ALDO_ORG_ROLE_LABELS,
  ALDO_ORG_ROLES,
  aldoOrgCanHandleInvite,
  aldoOrgCanManage,
  aldoOrgDay,
  aldoOrgExpiresLine,
  aldoOrgFreeSeats,
  aldoOrgFull,
  aldoOrgFullLine,
  aldoOrgInviteLine,
  aldoOrgManages,
  aldoOrgOpenInvites,
  aldoOrgOwnPlace,
  aldoOrgRolesToGive,
  aldoOrgSentLine,
  type AldoOrg,
  type AldoOrgInvite,
  type AldoOrgMember,
  type AldoOrgRole,
} from "./organization.logic";
import { aldoCredits, aldoNames, aldoRunningLine } from "./orgAdmin.logic";
import {
  aldoApproveBlocked,
  aldoRequestAlready,
  aldoRequestLine,
  type AldoOrgRequest,
} from "./orgJoining.logic";
import {
  aldoDefaultChoice,
  aldoRemoveAction,
  aldoRemoveBody,
  aldoRemovedNote,
  type AldoRemoveChoice,
} from "./offboarding.logic";
import { settingsOrg, settingsOrgDepartures, settingsOrgUsage } from "./settingsData";
import { useSettingsResource } from "./settingsResource";
import { aldoInviteTeams, aldoPersonLine, aldoSameIds, aldoTeamsOf } from "./teams.logic";

type Sheet =
  | { readonly kind: "invite" }
  | { readonly kind: "newTeam" }
  | { readonly kind: "member"; readonly id: string }
  | { readonly kind: "pending"; readonly id: string }
  | { readonly kind: "request"; readonly id: string };

const AN: Record<AldoOrgRole, string> = {
  owner: "an owner",
  admin: "an admin",
  member: "a member",
};

export function AldoMembersPage() {
  const { org, fallback } = useLoadedOrg();
  const navigate = useNavigate();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  // Members' month, for owners and admins; without it (an older Aldo), rows open as before.
  const { data: usage } = useSettingsResource(
    settingsOrgUsage,
    Boolean(org && aldoOrgManages(org)),
  );
  // Who can join, for its requests; null from an Aldo without it.
  const joining = useJoining(org);
  if (!org) return fallback;

  const manages = aldoOrgManages(org);
  const month = manages ? usage : null;
  const close = () => setSheet(null);
  const member = sheet?.kind === "member" ? org.members.find((m) => m.id === sheet.id) : null;
  const invite =
    sheet?.kind === "pending" ? org.invites?.find((i) => i.id === sheet.id) : undefined;
  const held = aldoOrgOpenInvites(org);
  const request =
    sheet?.kind === "request" ? joining?.requests.find((r) => r.id === sheet.id) : undefined;

  return (
    <>
      {month ? (
        <SettingsSection title="Running now" hideTitle>
          <OpenRow
            leading={month.running.machines ? <RunningDot /> : undefined}
            title={aldoRunningLine(month.running)}
            onOpen={() => void navigate({ to: "/settings/running" })}
          />
        </SettingsSection>
      ) : null}

      <SettingsSection
        id="aldo-members"
        title={`People · ${org.members.length}`}
        headerAction={
          manages ? (
            <Button size="xs" variant="ghost" onClick={() => setSheet({ kind: "invite" })}>
              <MailPlusIcon /> Invite
            </Button>
          ) : null
        }
      >
        {org.members.map((m) => {
          const used = month?.members.find((u) => u.id === m.id);
          return (
            <OpenRow
              key={m.id}
              leading={<Initials of={m.email} />}
              title={
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="[overflow-wrap:anywhere]">{m.email}</span>
                  {m.role === "member" ? null : (
                    <Badge
                      variant="outline"
                      size="sm"
                      className="font-normal text-muted-foreground"
                    >
                      {ALDO_ORG_ROLE_LABELS[m.role]}
                    </Badge>
                  )}
                  {used?.paused ? (
                    <Badge variant="warning" size="sm">
                      Paused
                    </Badge>
                  ) : null}
                </span>
              }
              description={aldoPersonLine(
                m.id === org.you,
                aldoTeamsOf(org, m.id).map((t) => t.name),
                aldoOrgDay(m.joinedAt),
              )}
              value={
                used ? (
                  <span className="inline-flex items-center gap-1.5 tabular-nums">
                    {used.running ? (
                      <>
                        <RunningDot />
                        <span className="sr-only">Running, </span>
                      </>
                    ) : null}
                    {aldoCredits(used.credits)}
                  </span>
                ) : undefined
              }
              onOpen={
                month
                  ? () =>
                      void navigate({
                        to: "/settings/members/$memberId",
                        params: { memberId: m.id },
                      })
                  : opensFor(org, m)
                    ? () => setSheet({ kind: "member", id: m.id })
                    : null
              }
            />
          );
        })}
      </SettingsSection>

      {manages && org.members.length <= 1 && !org.invites?.length ? (
        <div className="space-y-3 rounded-xl border border-border/60 bg-card/40 px-3 py-3.5 sm:px-4">
          <div className="space-y-1">
            <p className="font-medium text-foreground text-sm">Just you so far.</p>
            <p className="text-muted-foreground text-sm">
              Invite the people who’ll use Aldo. Each takes a seat, and you have{" "}
              {aldoOrgFreeSeats(org)} free.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setSheet({ kind: "invite" })}>
              <MailPlusIcon /> Invite by email
            </Button>
            {joining && !joining.link ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void navigate({ to: "/settings/joining" })}
              >
                <LinkIcon /> Turn on invite link
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {joining?.requests.length ? (
        <SettingsSection title={`Requests · ${joining.requests.length}`}>
          {joining.requests.map((r) => (
            <OpenRow
              key={r.id}
              leading={<Initials of={r.email} />}
              title={<span className="[overflow-wrap:anywhere]">{r.email}</span>}
              description={
                <>
                  {aldoRequestLine(r)}
                  {r.note ? (
                    <span className="mt-0.5 block text-foreground/80 [overflow-wrap:anywhere]">
                      “{r.note}”
                    </span>
                  ) : null}
                </>
              }
              onOpen={() => setSheet({ kind: "request", id: r.id })}
            />
          ))}
        </SettingsSection>
      ) : null}

      {org.invites?.length ? (
        <SettingsSection
          title="Invites"
          headerAction={
            <span className="text-muted-foreground text-xs leading-7">
              {held === 1 ? "1 seat held" : `${held} seats held`}
            </span>
          }
        >
          {org.invites.map((i) => (
            <InviteRow
              key={i.id}
              invite={i}
              onOpen={
                aldoOrgCanHandleInvite(org, i)
                  ? () => setSheet({ kind: "pending", id: i.id })
                  : null
              }
            />
          ))}
        </SettingsSection>
      ) : null}

      <TeamsSection org={org} usage={month} onNew={() => setSheet({ kind: "newTeam" })} />

      {manages ? <FormerMembers org={org} /> : null}

      {sheet?.kind === "invite" ? <InviteSheet org={org} onClose={close} /> : null}
      {sheet?.kind === "newTeam" ? <NewTeamSheet org={org} onClose={close} /> : null}
      {member && member.id === org.you ? (
        <YourRoleSheet org={org} onClose={close} />
      ) : member ? (
        <MemberSheet key={member.id} org={org} member={member} onClose={close} />
      ) : null}
      {invite ? <PendingSheet key={invite.id} org={org} invite={invite} onClose={close} /> : null}
      {request ? (
        <RequestSheet key={request.id} org={org} request={request} onClose={close} />
      ) : null}
    </>
  );
}

/** Whether a person's row opens: others the user may manage, and the user's own while they've a role to step down from. */
export function opensFor(org: AldoOrg, member: AldoOrgMember): boolean {
  if (member.id !== org.you) return aldoOrgCanManage(org, member);
  const own = aldoOrgOwnPlace(org);
  return !own.delete && (own.stepDownTo !== null || own.blocked !== null);
}

/** An invite: expired ones say so, and resend from beside the row. */
function InviteRow({ invite, onOpen }: { invite: AldoOrgInvite; onOpen: (() => void) | null }) {
  const { busy, error, run } = useOrgChange();
  const title = (
    <span className="flex flex-col items-start gap-1">
      <span className="[overflow-wrap:anywhere]">{invite.email}</span>
      {invite.expired ? (
        <Badge variant="warning" size="sm">
          Expired
        </Badge>
      ) : null}
    </span>
  );
  if (!invite.expired || !onOpen) {
    return (
      <OpenRow
        leading={<Initials of={invite.email} />}
        title={title}
        description={aldoOrgInviteLine(invite)}
        onOpen={onOpen}
      />
    );
  }
  const resend = () =>
    void run(() => aldoOrg.renewInvite(invite.id, "email")).then(
      (answer) =>
        answer &&
        toastManager.add({
          type: "success",
          title: "Invite sent again",
          description: invite.email,
        }),
    );
  return (
    <div className="flex items-center gap-2 pe-3 sm:pe-4">
      <OpenRow
        className="pe-0 sm:pe-0"
        leading={<Initials of={invite.email} />}
        title={title}
        description={
          <>
            {aldoOrgInviteLine(invite)}
            <ErrorLine error={error} />
          </>
        }
        onOpen={onOpen}
        chevron={false}
      />
      <Button size="sm" variant="outline" disabled={busy} onClick={resend}>
        Resend
      </Button>
    </div>
  );
}

/** The roles as choices, each saying what it can do; the ones not offered stay, greyed. */
function RoleChoices(props: {
  value: AldoOrgRole;
  onChange: (role: AldoOrgRole) => void;
  offered: ReadonlyArray<AldoOrgRole>;
  showAll?: boolean;
}) {
  const roles = props.showAll ? ALDO_ORG_ROLES : props.offered;
  return (
    <RadioGroup
      aria-label="Role"
      value={props.value}
      onValueChange={(value) => props.onChange(value as AldoOrgRole)}
      className="gap-0 overflow-hidden rounded-xl border"
    >
      {roles.map((r) => {
        const off = !props.offered.includes(r);
        return (
          <label
            key={r}
            className={cn(
              "flex min-h-12 items-start gap-3 border-t px-3 py-3 text-sm first:border-t-0",
              off ? "cursor-default text-muted-foreground" : "cursor-pointer",
            )}
          >
            <Radio value={r} disabled={off} className="mt-0.5" />
            <span className="space-y-0.5">
              <span className="block font-medium">{ALDO_ORG_ROLE_LABELS[r]}</span>
              {props.showAll && off ? null : (
                <span className="block text-muted-foreground text-xs">{ALDO_ORG_ROLE_HELP[r]}</span>
              )}
            </span>
          </label>
        );
      })}
    </RadioGroup>
  );
}

function InviteSheet({ org, onClose }: { org: AldoOrg; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AldoOrgRole>("member");
  const [teams, setTeams] = useState<ReadonlyArray<string>>([]);
  const { busy, error, run } = useOrgChange();
  const full = aldoOrgFull(org);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const to = email.trim();
    // Teams go only when some are picked, so an Aldo without them takes the invite as before.
    void run(() => aldoOrg.invite(to, role, teams.length ? teams : undefined)).then((answer) => {
      if (!answer) return;
      toastManager.add({ type: "success", title: "Invite sent", description: to });
      onClose();
    });
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogPopup>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle className="pe-8 [overflow-wrap:anywhere]">
              Invite to {org.name}
            </DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <Input
              type="email"
              required
              autoFocus
              autoComplete="off"
              aria-label="Email address"
              placeholder="name@company.com"
              value={email}
              disabled={full}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
            <RoleChoices value={role} onChange={setRole} offered={aldoOrgRolesToGive(org)} />
            {org.teams?.length && !full ? (
              <div className="space-y-1.5">
                <p className="font-medium text-sm">
                  Teams <span className="font-normal text-muted-foreground">· optional</span>
                </p>
                <TeamChecks teams={org.teams} value={teams} onChange={setTeams} disabled={busy} />
              </div>
            ) : null}
            <p
              className={cn("text-xs", full ? "text-warning-foreground" : "text-muted-foreground")}
            >
              {full
                ? aldoOrgFullLine(org)
                : "They get an email with a link that works for that address only. Invites expire after 7 days, and each holds a seat until then."}
            </p>
            <ErrorLine error={error} />
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />} disabled={busy}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={busy || full || !email.trim()}>
              Send invite
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/** Someone else: their role, and removing them. */
export function MemberSheet(props: {
  org: AldoOrg;
  member: AldoOrgMember;
  onClose: () => void;
  /** After they're removed, where nothing of theirs is left to show. */
  onRemoved?: () => void;
}) {
  const { org, member } = props;
  const [role, setRole] = useState(member.role);
  const [removing, setRemoving] = useState(false);
  const { busy, error, run } = useOrgChange();
  // What removing them does to their threads, read once it's asked; their choice, from its default.
  const read = useLeaving(member.id, removing);
  const leaving = read.leaving;
  const [picked, setPicked] = useState<AldoRemoveChoice | null>(null);
  const choice: AldoRemoveChoice =
    picked ?? (leaving ? aldoDefaultChoice(leaving) : { work: "keep", to: null, keepLinks: true });
  const save = () =>
    void run(() => aldoOrg.setRole(member.id, role)).then((answer) => answer && props.onClose());
  const remove = () =>
    void run(() => aldoOrg.remove(member.id, aldoRemoveBody(leaving ?? null, choice))).then(
      (answer) => {
        if (!answer) return;
        const note = aldoRemovedNote(leaving ?? null, choice, org.you);
        toastManager.add({
          type: "success",
          title: `Removed ${member.email}`,
          ...(note ? { description: note } : {}),
        });
        void settingsOrgDepartures.refresh().catch(() => undefined);
        props.onClose();
        props.onRemoved?.();
      },
    );
  // Asked, it waits for what removing does (or an Aldo without it), and a colleague to hand them to.
  const ready =
    leaving !== undefined &&
    (aldoRemoveBody(leaving, choice)?.work !== "hand" || Boolean(choice.to));
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && props.onClose()}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle className="pe-8 [overflow-wrap:anywhere]">{member.email}</DialogTitle>
          <DialogDescription>
            {ALDO_ORG_ROLE_LABELS[member.role]} · joined {aldoOrgDay(member.joinedAt)}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {removing ? (
            <RemoveStep org={org} read={read} choice={choice} onChoice={setPicked} busy={busy} />
          ) : (
            <>
              <RoleChoices value={role} onChange={setRole} offered={aldoOrgRolesToGive(org)} />
              <Button
                variant="destructive-outline"
                className="w-full"
                disabled={busy}
                onClick={() => setRemoving(true)}
              >
                Remove from {org.name}
              </Button>
            </>
          )}
          <ErrorLine error={error} />
        </DialogPanel>
        <DialogFooter>
          {removing ? (
            <>
              <Button variant="outline" disabled={busy} onClick={() => setRemoving(false)}>
                Keep them
              </Button>
              <Button variant="destructive" disabled={busy || !ready} onClick={remove}>
                {aldoRemoveAction(leaving ?? null, choice)}
              </Button>
            </>
          ) : (
            <>
              <DialogClose render={<Button variant="outline" />} disabled={busy}>
                Cancel
              </DialogClose>
              <Button disabled={busy || role === member.role} onClick={save}>
                {role === member.role ? "Save" : `Make them ${AN[role]}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** The user's own role: stepping down, or why the last owner can't. */
export function YourRoleSheet({ org, onClose }: { org: AldoOrg; onClose: () => void }) {
  const own = aldoOrgOwnPlace(org);
  const lower = own.blocked ? [] : ALDO_ORG_ROLES.slice(0, ALDO_ORG_ROLES.indexOf(org.role));
  const [role, setRole] = useState(org.role);
  const { busy, error, run } = useOrgChange();
  const save = () =>
    void run(() => aldoOrg.setRole(org.you, role)).then((answer) => answer && onClose());
  let note: ReactNode = null;
  if (own.blocked) {
    note = (
      <p className="flex gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-muted-foreground text-xs">
        <LockIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
        {own.blocked}
      </p>
    );
  } else if (role !== org.role) {
    note = (
      <p className="text-muted-foreground text-xs">
        {org.role === "owner"
          ? "Only an owner can make you an owner again."
          : "Only an owner or admin can make you an admin again."}
      </p>
    );
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle className="pe-8">Your role</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <RoleChoices
            value={role}
            onChange={setRole}
            offered={own.blocked ? [org.role] : [...lower, org.role]}
            showAll
          />
          {note}
          <ErrorLine error={error} />
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={busy}>
            {own.blocked ? "Done" : "Cancel"}
          </DialogClose>
          {own.blocked ? null : (
            <Button disabled={busy || role === org.role} onClick={save}>
              {role === org.role ? "Step down" : `Step down to ${role}`}
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/**
 * Copies the invite's link. Safari lets a page write to the clipboard only
 * while it handles the tap, so the link goes in as a promise before Aldo
 * answers; elsewhere, or if that fails, it's written after.
 */
async function copyLink(
  id: string,
  run: (work: () => Promise<OrgAnswer>) => Promise<OrgAnswer | null>,
): Promise<{ url: string; copied: boolean } | null> {
  const answer = run(() => aldoOrg.renewInvite(id, "link"));
  let copied = false;
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    const blob = answer.then((a) => {
      if (!a?.link) throw new Error("No link.");
      return new Blob([a.link], { type: "text/plain" });
    });
    copied = await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]).then(
      () => true,
      () => false,
    );
  }
  const link = (await answer)?.link;
  if (!link) return null;
  if (!copied && navigator.clipboard?.writeText) {
    copied = await navigator.clipboard.writeText(link).then(
      () => true,
      () => false,
    );
  }
  return { url: link, copied };
}

/** An open invite: who sent it, when it lapses, and resending, copying or revoking it. */
function PendingSheet(props: { org: AldoOrg; invite: AldoOrgInvite; onClose: () => void }) {
  const { org, invite } = props;
  const [link, setLink] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  // Picking the teams it puts its person on, from those it names now.
  const [teams, setTeams] = useState<ReadonlyArray<string> | null>(null);
  const { busy, error, run } = useOrgChange();
  const named = aldoInviteTeams(org, invite);
  const saveTeams = (picked: ReadonlyArray<string>) =>
    void run(() => aldoOrg.setInviteTeams(invite.id, picked)).then((answer) => {
      if (!answer) return;
      toastManager.add({ type: "success", title: "Invite saved", description: invite.email });
      setTeams(null);
    });
  const resend = () =>
    void run(() => aldoOrg.renewInvite(invite.id, "email")).then((answer) => {
      if (!answer) return;
      toastManager.add({ type: "success", title: "Invite sent again", description: invite.email });
      props.onClose();
    });
  const copy = () =>
    void copyLink(invite.id, run).then((copied) => {
      if (!copied) return;
      if (copied.copied) toastManager.add({ type: "success", title: "Link copied" });
      else setLink(copied.url);
    });
  const revoke = () =>
    void run(() => aldoOrg.revokeInvite(invite.id)).then((answer) => answer && props.onClose());
  const rows: Array<[string, string]> = [
    ["Role", ALDO_ORG_ROLE_LABELS[invite.role]],
    ["Sent", aldoOrgSentLine(invite)],
    ["Expires", aldoOrgExpiresLine(invite)],
  ];
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && props.onClose()}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle className="pe-8 [overflow-wrap:anywhere]">
            Invite for {invite.email}
          </DialogTitle>
        </DialogHeader>
        <DialogPanel>
          {revoking ? (
            <p className="text-sm">
              Revoke it? The link stops working, and its seat is free at once.
            </p>
          ) : teams && org.teams ? (
            <>
              <p className="text-muted-foreground text-sm">
                When {invite.email} joins, they’re put on the teams checked here.
              </p>
              <TeamChecks
                teams={org.teams}
                value={teams}
                onChange={setTeams}
                disabled={busy}
                label="Their teams"
              />
            </>
          ) : (
            <>
              <dl className="rounded-xl border px-3 text-sm">
                {rows.map(([label, value]) => (
                  <div
                    key={label}
                    className="flex min-h-11 items-center justify-between gap-4 border-t py-2.5 first:border-t-0"
                  >
                    <dt>{label}</dt>
                    <dd className="min-w-0 text-right text-muted-foreground [overflow-wrap:anywhere]">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              {org.teams?.length ? (
                <div className="rounded-xl border">
                  <OpenRow
                    title="Teams"
                    value={named.length ? aldoNames(named) : "None"}
                    onOpen={busy ? null : () => setTeams(invite.teams)}
                  />
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" disabled={busy} onClick={resend}>
                  <RefreshCwIcon /> Resend
                </Button>
                <Button variant="outline" disabled={busy || invite.expired} onClick={copy}>
                  <CopyIcon /> Copy link
                </Button>
              </div>
              {link ? (
                <Input
                  readOnly
                  aria-label="Invite link"
                  value={link}
                  onFocus={(event) => event.currentTarget.select()}
                  className="font-mono text-xs"
                />
              ) : null}
              <Button
                variant="destructive-outline"
                className="w-full"
                disabled={busy}
                onClick={() => setRevoking(true)}
              >
                Revoke invite
              </Button>
              <p className="text-muted-foreground text-xs">
                Resend sends a new email and starts 7 fresh days. The link works only for{" "}
                {invite.email}. Revoking frees the seat at once, and the link stops working.
              </p>
            </>
          )}
          <ErrorLine error={error} />
        </DialogPanel>
        {revoking ? (
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setRevoking(false)}>
              Keep it
            </Button>
            <Button variant="destructive" disabled={busy} onClick={revoke}>
              Revoke invite
            </Button>
          </DialogFooter>
        ) : teams ? (
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setTeams(null)}>
              Back
            </Button>
            <Button
              disabled={busy || aldoSameIds(teams, invite.teams)}
              onClick={() => saveTeams(teams)}
            >
              Save
            </Button>
          </DialogFooter>
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

/** A request to join: who, in their words, and approving (which sends the invite) or declining. */
function RequestSheet(props: { org: AldoOrg; request: AldoOrgRequest; onClose: () => void }) {
  const { request } = props;
  const { busy, error, run } = useJoiningChange();
  const already = aldoRequestAlready(props.org, request.email);
  // The org's free seats, which revoking or removing someone here updates at once.
  const blocked = aldoApproveBlocked(aldoOrgFreeSeats(props.org), already);
  const decide = (approve: boolean) =>
    void run(() => aldoOrgJoining.decide(request.id, approve)).then((answer) => {
      if (!answer) return;
      // Approving sends an invite, which holds a seat.
      if (approve) void settingsOrg.refresh().catch(() => undefined);
      toastManager.add(
        !approve
          ? { type: "success", title: "Declined", description: `We told ${request.email}.` }
          : already
            ? { type: "success", title: "Approved", description: request.email }
            : { type: "success", title: "Invite sent", description: request.email },
      );
      props.onClose();
    });
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && props.onClose()}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle className="pe-8 [overflow-wrap:anywhere]">{request.email}</DialogTitle>
          <DialogDescription>
            {aldoRequestLine(request)}.{" "}
            {already === "member"
              ? `They’re in ${props.org.name} already, so approving just closes this.`
              : already === "invited"
                ? "They have an open invite already, so approving just closes this."
                : `Approving sends an invite to that address, as a member of ${props.org.name}.`}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          {request.note ? (
            <blockquote className="rounded-xl border px-3 py-2.5 text-sm [overflow-wrap:anywhere]">
              “{request.note}”
            </blockquote>
          ) : null}
          {blocked ? <p className="text-warning-foreground text-sm">{blocked}</p> : null}
          <ErrorLine error={error} />
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => decide(false)}>
            Decline
          </Button>
          <Button disabled={busy || blocked !== null} onClick={() => decide(true)}>
            Approve
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
