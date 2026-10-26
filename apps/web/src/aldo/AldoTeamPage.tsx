// Settings → Members → a team (teams.logic.ts): who's on it and, for owners
// and admins, their credits this month added up, who's invited onto it, and
// renaming, changing its people, its Activity and deleting it. A team is a
// label: none of this changes what anyone can do.

import { Link, useNavigate } from "@tanstack/react-router";
import { UsersIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

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
import { toastManager } from "../components/ui/toast";
import { aldoOrg } from "./accountApi";
import { RunningDot } from "./AldoOrgAdminParts";
import { Confirm, ErrorLine, Initials, OpenRow, useLoadedOrg, useOrgChange } from "./AldoOrgParts";
import { PeopleChecks, TeamNameInput } from "./AldoTeamParts";
import {
  ALDO_ORG_ROLE_LABELS,
  aldoOrgInviteLine,
  aldoOrgManages,
  type AldoOrg,
  type AldoOrgTeam,
} from "./organization.logic";
import { aldoCredits } from "./orgAdmin.logic";
import { settingsOrg, settingsOrgUsage } from "./settingsData";
import { useSettingsResource } from "./settingsResource";
import {
  aldoDeleteTeamLine,
  aldoSameIds,
  aldoTeamCredits,
  aldoTeamInvites,
  aldoTeamLine,
  aldoTeamName,
  aldoTeamNameProblem,
  aldoTeamOverlaps,
} from "./teams.logic";

type Sheet = "people" | "rename" | "delete";

export function AldoTeamPage({ teamId }: { teamId: string }) {
  const { org, fallback } = useLoadedOrg();
  const manages = Boolean(org && aldoOrgManages(org));
  // Members' month, for owners and admins: the team's credits add up its people's.
  const { data: usage } = useSettingsResource(settingsOrgUsage, manages);
  const navigate = useNavigate();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  if (!org) return fallback;
  const team = org.teams?.find((t) => t.id === teamId);
  if (!team) return <Gone org={org} />;

  const month = manages ? usage : null;
  const close = () => setSheet(null);
  const people = org.members.filter((m) => team.members.includes(m.id));
  const invited = manages ? aldoTeamInvites(org, team) : [];
  const credits = aldoTeamCredits(team, month);

  return (
    <>
      <div className="flex items-center gap-3 px-1">
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted text-muted-foreground"
        >
          <UsersIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="font-medium text-base text-foreground [overflow-wrap:anywhere]">
            {team.name}
          </p>
          <p className="text-muted-foreground text-sm">
            {aldoTeamLine(org, team, month)}
            {credits !== null && team.members.length ? " this month" : ""}
          </p>
        </div>
      </div>

      <SettingsSection
        title={`People · ${people.length}`}
        headerAction={
          manages ? (
            <Button size="xs" variant="ghost" onClick={() => setSheet("people")}>
              {people.length ? "Change" : "Add people"}
            </Button>
          ) : null
        }
      >
        {people.length ? null : (
          <p className="px-3 py-3 text-muted-foreground text-sm sm:px-4">
            No one is on {team.name} yet.
          </p>
        )}
        {people.map((m) => {
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
                </span>
              }
              description={m.id === org.you ? "You" : undefined}
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
                  : null
              }
            />
          );
        })}
      </SettingsSection>

      {invited.length ? (
        <SettingsSection title="Invited">
          {invited.map((i) => (
            <OpenRow
              key={i.id}
              leading={<Initials of={i.email} />}
              title={<span className="[overflow-wrap:anywhere]">{i.email}</span>}
              description={aldoOrgInviteLine(i)}
              onOpen={null}
            />
          ))}
        </SettingsSection>
      ) : null}

      {manages ? (
        <SettingsSection title="Team">
          <OpenRow title="Name" value={team.name} onOpen={() => setSheet("rename")} />
          <OpenRow
            title="Activity"
            description="Changes to it, and what its people did or had done."
            onOpen={() => void navigate({ to: "/settings/activity", search: { team: team.id } })}
          />
          <OpenRow
            title={<span className="text-destructive-foreground">Delete team</span>}
            description="Its people stay in the organization."
            onOpen={() => setSheet("delete")}
          />
        </SettingsSection>
      ) : null}

      {month && aldoTeamOverlaps(org, team) ? (
        <p className="px-1 text-muted-foreground text-xs">
          Someone on more than one team counts toward each, so teams’ credits can add up to more
          than the organization’s.
        </p>
      ) : null}

      {sheet === "people" ? <PeopleSheet org={org} team={team} onClose={close} /> : null}
      {sheet === "rename" ? <RenameSheet org={org} team={team} onClose={close} /> : null}
      <Confirm
        open={sheet === "delete"}
        onOpenChange={(open) => !open && close()}
        title={`Delete ${team.name}?`}
        description={aldoDeleteTeamLine(org, team)}
        action="Delete team"
        onConfirm={async () => {
          const answer = await aldoOrg.deleteTeam(team.id).catch((cause: unknown) => {
            void settingsOrg.refresh().catch(() => undefined);
            throw cause;
          });
          toastManager.add({ type: "success", title: `Deleted ${team.name}` });
          await navigate({ to: "/settings/members", replace: true });
          settingsOrg.set(answer.org);
        }}
      />
    </>
  );
}

/** A team that's gone: deleted, or never this organization's. */
function Gone({ org }: { org: AldoOrg }) {
  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-card/40 px-3 py-3.5 sm:px-4">
      <p className="text-sm">
        {org.teams ? `That team isn’t in ${org.name} anymore.` : "Teams aren’t available yet."}
      </p>
      <Button size="sm" variant="outline" render={<Link to="/settings/members" />}>
        Back to Members
      </Button>
    </div>
  );
}

/** Who's on the team: checked, from everyone in the organization. */
function PeopleSheet(props: { org: AldoOrg; team: AldoOrgTeam; onClose: () => void }) {
  const { org, team } = props;
  const [people, setPeople] = useState<ReadonlyArray<string>>(team.members);
  const { busy, error, run } = useOrgChange();
  const save = () =>
    void run(() => aldoOrg.setTeamPeople(team.id, people)).then((answer) => {
      if (!answer) return;
      toastManager.add({ type: "success", title: `${team.name} saved` });
      props.onClose();
    });
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && props.onClose()}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle className="pe-8 [overflow-wrap:anywhere]">Who’s on {team.name}</DialogTitle>
          <DialogDescription>
            Each person put on or taken off it sees that in their Activity.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <PeopleChecks org={org} value={people} onChange={setPeople} disabled={busy} />
          <ErrorLine error={error} />
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={busy}>
            Cancel
          </DialogClose>
          <Button disabled={busy || aldoSameIds(people, team.members)} onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function RenameSheet(props: { org: AldoOrg; team: AldoOrgTeam; onClose: () => void }) {
  const { org, team } = props;
  const [name, setName] = useState(team.name);
  const { busy, error, run } = useOrgChange();
  const problem = aldoTeamNameProblem(org, name, team.id);
  const unchanged = aldoTeamName(name) === team.name;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (problem || unchanged) return;
    void run(() => aldoOrg.renameTeam(team.id, aldoTeamName(name))).then(
      (answer) => answer && props.onClose(),
    );
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && props.onClose()}>
      <DialogPopup>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle className="pe-8">Rename team</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <TeamNameInput
              org={org}
              value={name}
              onChange={setName}
              except={team.id}
              disabled={busy}
            />
            <ErrorLine error={error} />
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />} disabled={busy}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={busy || problem !== null || unchanged}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
