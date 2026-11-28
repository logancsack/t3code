import { EnvironmentId } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { ChevronLeftIcon, ChevronRightIcon, FolderKanbanIcon, LayersIcon } from "lucide-react";

import { isAldoCloud } from "../../aldo/api";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { ProjectSettingsPanel } from "./ProjectSettingsPanel";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsScopeNotice } from "./SettingsScopeNotice";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import {
  ALL_ENVIRONMENTS_VALUE,
  ALL_PROJECTS_VALUE,
  selectEnvironmentAxis,
  selectProjectAxis,
} from "./settingsScopeAxis";
import { useSettingsProjectGroups } from "./useSettingsProjectGroups";

export function ProjectsSettings() {
  const gt = useGT();
  const { search: value, scope, selectScope } = useSettingsScope();
  const groups = useSettingsProjectGroups();
  const unavailable =
    scope.kind === "unavailable" ? (
      <SettingsPageContainer>
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted-foreground">{scope.message}</p>
          {value.machine || value.checkout ? (
            <Button
              variant="outline"
              size="xs"
              onClick={() => selectScope(selectEnvironmentAxis(value, ALL_ENVIRONMENTS_VALUE))}
            >
              <LayersIcon />
              <T>Show all environments</T>
            </Button>
          ) : null}
        </div>
      </SettingsPageContainer>
    ) : null;
  // Keep the panel mounted so it can follow members when regrouping changes the project key.
  const projectScope =
    scope.kind === "project" ||
    scope.kind === "checkout" ||
    (scope.kind === "unavailable" &&
      (scope.reason === "project-missing" || scope.reason === "checkout-missing"));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {value.project && projectScope ? (
        <>
          {isAldoCloud && groups.length > 0 ? (
            <div className="px-4 pt-4 sm:px-8 sm:pt-6">
              <div className="mx-auto max-w-3xl">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost-muted"
                  className="-ms-2.5"
                  onClick={() => selectScope(selectProjectAxis(value, ALL_PROJECTS_VALUE))}
                >
                  <ChevronLeftIcon className="size-4" />
                  <T>All projects</T>
                </Button>
              </div>
            </div>
          ) : null}
          <ProjectSettingsPanel
            projectKey={value.project}
            environmentId={value.machine ? EnvironmentId.make(value.machine) : null}
            checkoutKey={value.checkout ?? null}
            unavailable={unavailable}
          />
        </>
      ) : unavailable ? (
        unavailable
      ) : isAldoCloud ? (
        <SettingsPageContainer>
          <SettingsSection title={gt("Projects")} icon={<FolderKanbanIcon className="size-4" />}>
            {groups.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
                <T>
                  No projects yet. Projects appear here once you add one from the sidebar or start
                  working in a repository.
                </T>
              </p>
            ) : (
              groups.map((group) => (
                <button
                  key={group.projectKey}
                  type="button"
                  onClick={() => selectScope(selectProjectAxis(value, group.projectKey))}
                  className="flex min-h-12 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors outline-none first:rounded-t-xl last:rounded-b-xl hover:bg-accent/40 focus-visible:bg-accent/40 active:bg-accent/60 sm:px-4"
                >
                  <ProjectFavicon project={group} className="size-5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground text-sm">
                    {group.displayName}
                  </span>
                  {group.archived ? (
                    <span className="shrink-0 text-muted-foreground text-xs">
                      <T>Archived</T>
                    </span>
                  ) : null}
                  <ChevronRightIcon
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground/70"
                  />
                </button>
              ))
            )}
          </SettingsSection>
        </SettingsPageContainer>
      ) : (
        <SettingsScopeNotice target="project">
          {gt("Choose a project to manage its name, icon, checkouts and actions.")}
        </SettingsScopeNotice>
      )}
    </div>
  );
}
