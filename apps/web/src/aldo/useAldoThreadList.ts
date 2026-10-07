// The user's threads grouped by what each needs from them (sidebar.logic.ts),
// as Aldo's sidebar (AldoSidebar.tsx) and the phone's Agents tab
// (AldoAgentsTab.tsx) both show them: from T3's shells and Aldo's home read,
// with each thread's project, narrowed to one project when `scope` names one.

import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useCallback, useMemo } from "react";

import { useClientSettings } from "../hooks/useSettings";
import { selectProjectGroupingSettings } from "../logicalProject";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { useProjects, useThreadShells } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { environmentServerConfigsAtom } from "../state/server";
import { useUiStateStore } from "../uiStateStore";
import { isAldoEnvironmentId, type AldoHome } from "./cloud";
import { aldoSidebarList, repoLabel } from "./sidebar.logic";

export function useAldoThreadList(input: {
  readonly home: AldoHome | null;
  readonly now: number;
  /** A project to narrow to (its key), or null for all of them. */
  readonly scope: string | null;
}) {
  const shells = useThreadShells();
  const projects = useProjects();
  const lastVisited = useUiStateStore((s) => s.threadLastVisitedAtById);
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { home, now, scope } = input;

  const groups = useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects,
        settings: groupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: () => null,
      }),
    [groupingSettings, primaryEnvironmentId, projects],
  );
  const groupByProject = useMemo(() => {
    const map = new Map<string, (typeof groups)[number]>();
    for (const group of groups)
      for (const ref of group.memberProjectRefs)
        map.set(`${ref.environmentId}:${ref.projectId}`, group);
    return map;
  }, [groups]);
  const groupOf = useCallback(
    (shell: EnvironmentThreadShell) =>
      groupByProject.get(`${shell.environmentId}:${shell.projectId}`),
    [groupByProject],
  );

  const list = useMemo(
    () =>
      aldoSidebarList({
        shells: shells.filter((shell) => isAldoEnvironmentId(shell.environmentId)),
        home,
        lastVisitedAt: (key) => lastVisited[key],
        repoOf: (shell) => repoLabel(groupOf(shell)?.displayName),
        ...(scope === null ? {} : { inScope: (shell) => groupOf(shell)?.projectKey === scope }),
        supports: (shell) => {
          const capabilities = serverConfigs.get(shell.environmentId)?.environment.capabilities;
          return {
            settlement: capabilities?.threadSettlement === true,
            snooze: capabilities?.threadSnooze === true,
          };
        },
        now: new Date(now).toISOString(),
      }),
    [groupOf, home, lastVisited, now, scope, serverConfigs, shells],
  );

  return { list, groups, groupByProject, shellCount: shells.length };
}
