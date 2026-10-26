/**
 * Teams (Aldo's src/lib/org-teams.ts): a name and the people on it, for
 * inviting, filtering and usage by team. Labels only: a team changes nothing
 * anyone can do. Everyone in the organization sees them; owners and admins
 * make them and say who's on each. Usage by team adds up its people's
 * credits this month, so someone on two teams counts in both.
 */

import type { AldoOrg, AldoOrgInvite, AldoOrgTeam } from "./organization.logic";
import { aldoCredits, type AldoOrgUsage } from "./orgAdmin.logic";

/** The longest name Aldo takes. */
export const ALDO_TEAM_NAME_MAX = 40;

/** The teams someone is on, in the organization's order (by name). */
export function aldoTeamsOf(org: AldoOrg, memberId: string): ReadonlyArray<AldoOrgTeam> {
  return org.teams?.filter((team) => team.members.includes(memberId)) ?? [];
}

/** The names of an invite's teams that are still the organization's. */
export function aldoInviteTeams(org: AldoOrg, invite: AldoOrgInvite): ReadonlyArray<string> {
  return org.teams?.filter((team) => invite.teams.includes(team.id)).map((t) => t.name) ?? [];
}

/** Teams on a row, two at most: "Finance", "Finance, Ops", "Finance, Ops +2". */
export function aldoTeamsShort(names: ReadonlyArray<string>): string {
  const shown = names.slice(0, 2).join(", ");
  return names.length > 2 ? `${shown} +${names.length - 2}` : shown;
}

/** A person's line under Members: "You · Finance · joined Oct 3", or just when they joined. */
export function aldoPersonLine(you: boolean, teams: ReadonlyArray<string>, joined: string): string {
  if (!you && !teams.length) return `Joined ${joined}`;
  return [you ? "You" : "", aldoTeamsShort(teams), `joined ${joined}`].filter(Boolean).join(" · ");
}

/** Open invites that put their person on a team. */
export function aldoTeamInvites(org: AldoOrg, team: AldoOrgTeam): ReadonlyArray<AldoOrgInvite> {
  return org.invites?.filter((invite) => invite.teams.includes(team.id)) ?? [];
}

/** A team's credits this month: its people's, added up; null without their usage (members, an older Aldo). */
export function aldoTeamCredits(
  team: AldoOrgTeam,
  usage: AldoOrgUsage | null | undefined,
): number | null {
  if (!usage) return null;
  return team.members.reduce(
    (sum, id) => sum + (usage.members.find((m) => m.id === id)?.credits ?? 0),
    0,
  );
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A team's row: "4 people · 22,497 credits", "1 person, 1 invited", "No one yet". */
export function aldoTeamLine(
  org: AldoOrg,
  team: AldoOrgTeam,
  usage: AldoOrgUsage | null | undefined,
): string {
  const invited = aldoTeamInvites(org, team).length;
  const who = [
    team.members.length ? count(team.members.length, "person", "people") : "",
    invited ? `${invited} invited` : "",
  ]
    .filter(Boolean)
    .join(", ");
  if (!who) return "No one yet";
  const credits = aldoTeamCredits(team, usage);
  return team.members.length && credits !== null ? `${who} · ${aldoCredits(credits)} credits` : who;
}

/** Whether someone on this team is on another too, so teams' credits add up to more than the organization's. */
export function aldoTeamOverlaps(org: AldoOrg, team: AldoOrgTeam): boolean {
  return team.members.some((id) =>
    org.teams?.some((other) => other.id !== team.id && other.members.includes(id)),
  );
}

/** A name as Aldo keeps it: trimmed, its spaces single. */
export const aldoTeamName = (name: string) => name.trim().replace(/\s+/g, " ");

/** What's wrong with a name before Aldo sees it, or null; Aldo checks it too. */
export function aldoTeamNameProblem(org: AldoOrg, name: string, except?: string): string | null {
  const tidy = aldoTeamName(name);
  if (!tidy) return "Give it a name.";
  if (tidy.length > ALDO_TEAM_NAME_MAX) return `Keep it to ${ALDO_TEAM_NAME_MAX} characters.`;
  const taken = org.teams?.find(
    (team) => team.id !== except && team.name.toLowerCase() === tidy.toLowerCase(),
  );
  return taken ? `There’s a team called ${taken.name} already.` : null;
}

/** Whether two choices of ids are the same, so there's nothing to save. */
export function aldoSameIds(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** What deleting a team does, for its confirmation. */
export function aldoDeleteTeamLine(org: AldoOrg, team: AldoOrgTeam): string {
  const n = team.members.length;
  const invited = aldoTeamInvites(org, team).length;
  const people = n
    ? `${n === 1 ? "The person" : `The ${n} people`} on it ${n === 1 ? "stays" : "stay"} in ${org.name}, with their threads and usage.`
    : "No one is on it.";
  const invites = invited
    ? ` ${invited === 1 ? "An open invite" : `${invited} open invites`} won’t put anyone on it.`
    : "";
  return `${people}${invites} Its lines in Activity stay.`;
}
