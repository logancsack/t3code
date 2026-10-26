// Teams on Settings → Members and a member's page (teams.logic.ts): the
// section listing them, picking people or teams with checkboxes, and making a
// team. Owners and admins change them; everyone sees them.

import { useNavigate } from "@tanstack/react-router";
import { PlusIcon, UsersIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { SettingsSection } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
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
import { toastManager } from "../components/ui/toast";
import { aldoOrg } from "./accountApi";
import { ErrorLine, Initials, OpenRow, useOrgChange } from "./AldoOrgParts";
import { aldoOrgManages, type AldoOrg, type AldoOrgTeam } from "./organization.logic";
import type { AldoOrgUsage } from "./orgAdmin.logic";
import { ALDO_TEAM_NAME_MAX, aldoTeamLine, aldoTeamName, aldoTeamNameProblem } from "./teams.logic";

/** Members' teams: each opening its page, and for owners and admins a way to make one. */
export function TeamsSection(props: {
  org: AldoOrg;
  usage: AldoOrgUsage | null | undefined;
  onNew: () => void;
}) {
  const { org } = props;
  const navigate = useNavigate();
  const manages = aldoOrgManages(org);
  // From an Aldo without teams, or none made and nobody to make one: nothing.
  if (!org.teams || (!org.teams.length && !manages)) return null;
  if (!org.teams.length) {
    return (
      <SettingsSection title="Teams">
        <OpenRow
          leading={
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground"
            >
              <PlusIcon className="size-4" />
            </span>
          }
          title="Make a team"
          description="Group people to invite them together and see usage by team. Teams don’t change what anyone can do."
          onOpen={props.onNew}
        />
      </SettingsSection>
    );
  }
  return (
    <SettingsSection
      title={`Teams · ${org.teams.length}`}
      headerAction={
        manages ? (
          <Button size="xs" variant="ghost" onClick={props.onNew}>
            <PlusIcon /> New team
          </Button>
        ) : null
      }
    >
      {org.teams.map((team) => (
        <OpenRow
          key={team.id}
          leading={
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted text-muted-foreground"
            >
              <UsersIcon className="size-4" />
            </span>
          }
          title={team.name}
          description={aldoTeamLine(org, team, props.usage)}
          onOpen={() =>
            void navigate({ to: "/settings/teams/$teamId", params: { teamId: team.id } })
          }
        />
      ))}
    </SettingsSection>
  );
}

const toggle = (list: ReadonlyArray<string>, id: string, on: boolean) =>
  on ? (list.includes(id) ? list : [...list, id]) : list.filter((x) => x !== id);

const CHECK_ROW =
  "flex min-h-11 cursor-pointer items-center gap-3 border-t px-3 py-2 text-sm first:border-t-0";

/** The organization's people, to check those on a team. */
export function PeopleChecks(props: {
  org: AldoOrg;
  value: ReadonlyArray<string>;
  onChange: (value: ReadonlyArray<string>) => void;
  disabled?: boolean;
}) {
  const { org } = props;
  const people = [...org.members].sort((a, b) =>
    a.id === org.you ? -1 : b.id === org.you ? 1 : a.email.localeCompare(b.email),
  );
  return (
    <div
      role="group"
      aria-label="People"
      className="max-h-72 overflow-y-auto overscroll-contain rounded-xl border"
    >
      {people.map((m) => (
        <label key={m.id} className={CHECK_ROW}>
          <Checkbox
            checked={props.value.includes(m.id)}
            disabled={props.disabled}
            onCheckedChange={(on) => props.onChange(toggle(props.value, m.id, on === true))}
          />
          <Initials of={m.email} className="size-7 text-[10px]" />
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            {m.email}
            {m.id === org.you ? <span className="text-muted-foreground"> (you)</span> : null}
          </span>
        </label>
      ))}
    </div>
  );
}

/** The organization's teams, to check those someone is on, or an invite puts them on. */
export function TeamChecks(props: {
  teams: ReadonlyArray<AldoOrgTeam>;
  value: ReadonlyArray<string>;
  onChange: (value: ReadonlyArray<string>) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div
      role="group"
      aria-label={props.label ?? "Teams"}
      className="max-h-56 overflow-y-auto overscroll-contain rounded-xl border"
    >
      {props.teams.map((team) => (
        <label key={team.id} className={CHECK_ROW}>
          <Checkbox
            checked={props.value.includes(team.id)}
            disabled={props.disabled}
            onCheckedChange={(on) => props.onChange(toggle(props.value, team.id, on === true))}
          />
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{team.name}</span>
        </label>
      ))}
    </div>
  );
}

/** A team's name, typed: Aldo's limits shown as they're met, and its refusal kept. */
export function TeamNameInput(props: {
  org: AldoOrg;
  value: string;
  onChange: (value: string) => void;
  except?: string;
  disabled?: boolean;
}) {
  const problem = props.value.trim()
    ? aldoTeamNameProblem(props.org, props.value, props.except)
    : null;
  return (
    <div className="space-y-1.5">
      <Input
        required
        autoFocus
        autoComplete="off"
        aria-label="Team name"
        aria-invalid={problem ? true : undefined}
        placeholder="Finance, Design, Support…"
        maxLength={ALDO_TEAM_NAME_MAX + 10}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
      {problem ? <p className="text-destructive-foreground text-xs">{problem}</p> : null}
    </div>
  );
}

/** A new team: its name, and who's on it to start. */
export function NewTeamSheet({ org, onClose }: { org: AldoOrg; onClose: () => void }) {
  const [name, setName] = useState("");
  const [people, setPeople] = useState<ReadonlyArray<string>>([]);
  const { busy, error, run } = useOrgChange();
  const problem = aldoTeamNameProblem(org, name);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (problem) return;
    const tidy = aldoTeamName(name);
    void run(() => aldoOrg.createTeam(tidy, people)).then((answer) => {
      if (!answer) return;
      toastManager.add({ type: "success", title: `Made ${tidy}` });
      onClose();
    });
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogPopup>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle className="pe-8">New team</DialogTitle>
            <DialogDescription>
              For inviting people together and seeing usage by team. It doesn’t change what anyone
              can do.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <TeamNameInput org={org} value={name} onChange={setName} disabled={busy} />
            <div className="space-y-1.5">
              <p className="font-medium text-sm">Who’s on it</p>
              <PeopleChecks org={org} value={people} onChange={setPeople} disabled={busy} />
            </div>
            <ErrorLine error={error} />
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />} disabled={busy}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={busy || problem !== null}>
              Make team
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
