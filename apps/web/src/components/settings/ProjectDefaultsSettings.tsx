import {
  DEFAULT_SERVER_SETTINGS,
  type ModelSelection,
  ProviderInstanceId,
  type WorktreeSubmodules,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useNavigate } from "@tanstack/react-router";

import { isAldoCloud } from "../../aldo/cloud";
import { aldoSavesSettings } from "../../aldo/machineSettings.logic";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  resolveDefaultProviderModelSelection,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { useEnvironments } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { resolveEnvModeLabel, WORKTREE_SUBMODULES_LABELS } from "../BranchToolbar.logic";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { runtimeModeConfig, runtimeModeOptions } from "../chat/runtimeModeConfig";
import { PULL_REQUEST_MERGE_METHOD_LABELS } from "../pullRequest/pullRequestDetail.logic";
import { TraitsPicker } from "../chat/TraitsPicker";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { Switch } from "../ui/switch";
import type { ProjectSettingsCategory } from "./ProjectSettingsPanel";
import { searchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useScopedSettingSource,
  useUpdateScopedSettings,
} from "./useScopedSettings";

/**
 * Rows for the settings a project may override. The same rows edit
 * environment defaults at an environment scope and project overrides at a
 * project or checkout scope; the scoped hooks route the write.
 */
const WORKTREE_SUBMODULES_OPTIONS = ["recursive", "top-level", "none"] as const;
function isWorktreeSubmodules(value: string | null): value is WorktreeSubmodules {
  return value !== null && (WORKTREE_SUBMODULES_OPTIONS as readonly string[]).includes(value);
}

export function ProjectDefaultsSettings({
  category,
  aldoPart,
}: {
  category: ProjectSettingsCategory;
  /** Aldo shows one row on a page of its own: the model on Agents, the access on Permissions. */
  aldoPart?: "model" | "permissions";
}) {
  const { scope, target, targets, connectedEnvironments, aldo } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  const representative = target
    ? environments.find((environment) => environment.environmentId === target.environmentId)
    : undefined;
  const providers =
    representative?.serverConfig?.providers ??
    // Aldo: with no machine connected, a sleeping one's, to choose the user's model from.
    (isAldoCloud ? aldo?.providers : null) ??
    EMPTY_SERVER_PROVIDERS;
  const selection = resolveDefaultProviderModelSelection(providers, settings.defaultModelSelection);
  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
  );
  const modelOptions = getCustomModelOptionsByInstance(
    settings,
    providers,
    selection?.instanceId,
    selection?.model,
  );
  const activeEntry = entries.find((entry) => entry.instanceId === selection?.instanceId);
  const mixedModel = useScopedSettingsMixed(["defaultModelSelection"]);
  const mixedPermissions = useScopedSettingsMixed(["defaultRuntimeMode"]);
  const PermissionIcon = runtimeModeConfig[settings.defaultRuntimeMode].icon;
  const mixedWorkspace = useScopedSettingsMixed(["defaultThreadEnvMode"]);
  const mixedSubmodules = useScopedSettingsMixed(["worktreeSubmodules"]);
  const mixedBrowser = useScopedSettingsMixed(["enableAgentBrowserAccess"]);
  const mixedAutoPull = useScopedSettingsMixed(["defaultAutoPull"]);
  const mixedMergeMethod = useScopedSettingsMixed(["pullRequestMergeMethod"]);
  const modelSource = useScopedSettingSource(["defaultModelSelection"]);
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const unavailable = connectedEnvironments.length === 0;
  // Aldo: the user's model saves with no machine connected.
  const modelUnavailable =
    unavailable && !(isAldoCloud && aldoSavesSettings(aldo, ["defaultModelSelection"]));
  // File-backed keys show their effective value; the target already carries
  // the checkout's t3.json, and a null file here only fills the built-in.
  // The reset arrow beside the title clears the tier (SettingsRow handles a
  // project override, the environment value is cleared here), so the picker
  // has no "inherit" item.
  const effective = target
    ? resolveProjectSettings(target.settings, null, null, null).settings
    : null;

  function modelDisabledReason(instanceId: ProviderInstanceId, model: string): string | null {
    const sourceEntry = entries.find((entry) => entry.instanceId === instanceId);
    for (const candidate of targets) {
      const environment = environments.find(
        (entry) => entry.environmentId === candidate.environmentId,
      );
      const config = environment?.serverConfig;
      if (!config) continue;
      const entry = applyProviderInstanceSettings(
        deriveProviderInstanceEntries(config.providers),
        candidate.settings,
      ).find((option) => option.instanceId === instanceId);
      const options = getCustomModelOptionsByInstance(
        { ...settings, ...candidate.settings },
        config.providers,
      ).get(instanceId);
      if (
        !entry?.enabled ||
        !entry.isAvailable ||
        entry.driverKind !== sourceEntry?.driverKind ||
        !options?.some((option) => option.slug === model && !option.isUnavailable)
      ) {
        return `This model is unavailable on ${environment?.label ?? "a selected environment"}. Select that environment to choose its model separately.`;
      }
    }
    return null;
  }

  const setModel = (value: ModelSelection | null) => {
    const reason = value ? modelDisabledReason(value.instanceId, value.model) : null;
    if (reason) {
      toastManager.add({ type: "error", title: "Default model not saved", description: reason });
      return;
    }
    updateSettings({ defaultModelSelection: value });
  };

  const aldoModel = isAldoCloud && aldoPart === "model";
  const automaticModel = aldoModel && settings.defaultModelSelection == null;
  const shownSelection = aldoModel ? settings.defaultModelSelection : selection;

  const modelRow = (
    <SettingsRow
      serverScoped
      settingKeys={["defaultModelSelection"]}
      mixed={mixedModel}
      id="default-model"
      title="Model"
      description={
        aldoModel
          ? automaticModel
            ? "Aldo chooses the model and reasoning for each task using the room left on your plans."
            : "Override for every new thread, including requests to Aldo. A model you choose for one thread takes priority."
          : isProjectScope
            ? "Model for new threads in this project."
            : "Default model for new threads. Projects can override it."
      }
      status={
        modelUnavailable || mixedModel || modelSource === "project"
          ? undefined
          : settings.defaultModelSelection === null
            ? aldoModel
              ? "Router"
              : "Automatic"
            : aldoModel
              ? "Override"
              : undefined
      }
      resetAction={
        settings.defaultModelSelection !== null ? (
          <SettingResetButton label="default model" onClick={() => setModel(null)} />
        ) : null
      }
      control={
        aldoModel || (selection && activeEntry) ? (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            <ProviderModelPicker
              activeInstanceId={
                shownSelection?.instanceId ??
                selection?.instanceId ??
                ProviderInstanceId.make("aldo")
              }
              model={shownSelection?.model ?? selection?.model ?? ""}
              lockedProvider={null}
              instanceEntries={entries}
              modelOptionsByInstance={modelOptions}
              triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
              {...(aldoModel
                ? {
                    automaticOption: {
                      label: "Let Aldo decide",
                      selected: automaticModel,
                      onSelect: () => setModel(null),
                    },
                    ...(automaticModel ? { triggerLabel: "Let Aldo decide" } : {}),
                  }
                : {})}
              {...(mixedModel ? { triggerLabel: "Mixed" } : {})}
              getModelDisabledReason={modelDisabledReason}
              onOpenProviderSetup={(instanceId) => {
                if (representative)
                  void navigate({
                    to: "/settings/providers",
                    search: { environmentId: representative.environmentId, instanceId },
                  });
              }}
              onInstanceModelChange={(instanceId, model) =>
                setModel(createModelSelection(instanceId, model))
              }
            />
            {!mixedModel && selection && activeEntry && !automaticModel ? (
              <TraitsPicker
                provider={activeEntry.driverKind}
                models={activeEntry.models}
                model={selection.model}
                prompt=""
                onPromptChange={() => {}}
                modelOptions={selection.options ?? []}
                allowPromptInjectedEffort={false}
                planModeEnabled={settings.planModeEnabled}
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                onModelOptionsChange={(options) =>
                  setModel(createModelSelection(selection.instanceId, selection.model, options))
                }
              />
            ) : null}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">No providers available</span>
        )
      }
    />
  );
  const workspaceRow = (
    <SettingsRow
      serverScoped
      settingKeys={["defaultThreadEnvMode"]}
      mixed={mixedWorkspace}
      id={searchableSetting("new-threads").id}
      title="Workspace"
      description={
        isProjectScope
          ? "Where new threads in this project start."
          : "Where new threads start. Projects and their t3.json can override it."
      }
      resetAction={
        !isProjectScope && settings.defaultThreadEnvMode !== null ? (
          <SettingResetButton
            label="default workspace"
            onClick={() => updateSettings({ defaultThreadEnvMode: null })}
          />
        ) : null
      }
      control={
        <Select
          value={mixedWorkspace ? null : (effective?.defaultThreadEnvMode ?? null)}
          onValueChange={(value) => {
            if (value === "local" || value === "worktree")
              updateSettings({ defaultThreadEnvMode: value });
          }}
        >
          <SelectTrigger size="sm" aria-label="Default workspace">
            <SelectValue>
              {(value: string | null) =>
                value === "local" || value === "worktree"
                  ? resolveEnvModeLabel(value)
                  : unavailable
                    ? "Unavailable"
                    : "Mixed"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem value="local">{resolveEnvModeLabel("local")}</SelectItem>
            <SelectItem value="worktree">{resolveEnvModeLabel("worktree")}</SelectItem>
          </SelectPopup>
        </Select>
      }
    />
  );

  const submodulesRow = (
    <SettingsRow
      serverScoped
      settingKeys={["worktreeSubmodules"]}
      mixed={mixedSubmodules}
      {...searchableSetting("worktree-submodules")}
      description={
        isProjectScope
          ? "How new worktrees in this project populate git submodules."
          : "How new worktrees populate git submodules. Projects and their t3.json can override it."
      }
      resetAction={
        !isProjectScope && settings.worktreeSubmodules !== null ? (
          <SettingResetButton
            label="worktree submodules"
            onClick={() => updateSettings({ worktreeSubmodules: null })}
          />
        ) : null
      }
      control={
        <Select
          value={mixedSubmodules ? null : (effective?.worktreeSubmodules ?? null)}
          onValueChange={(value) => {
            if (isWorktreeSubmodules(value)) updateSettings({ worktreeSubmodules: value });
          }}
        >
          <SelectTrigger size="sm" aria-label="Worktree submodules">
            <SelectValue>
              {(value: string | null) =>
                isWorktreeSubmodules(value)
                  ? WORKTREE_SUBMODULES_LABELS[value]
                  : unavailable
                    ? "Unavailable"
                    : "Mixed"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {WORKTREE_SUBMODULES_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {WORKTREE_SUBMODULES_LABELS[option]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
  const worktreeRows = (
    <>
      {workspaceRow}
      {submodulesRow}
    </>
  );

  const permissionsRow = (
    <SettingsRow
      serverScoped
      settingKeys={["defaultRuntimeMode"]}
      mixed={mixedPermissions}
      {...searchableSetting("default-permissions")}
      description={
        isProjectScope
          ? "Permissions for new threads in this project."
          : "Default permissions for new threads. Projects can override them."
      }
      resetAction={
        settings.defaultRuntimeMode !== DEFAULT_SERVER_SETTINGS.defaultRuntimeMode ? (
          <SettingResetButton
            label="default permissions"
            onClick={() =>
              updateSettings({
                defaultRuntimeMode: DEFAULT_SERVER_SETTINGS.defaultRuntimeMode,
              })
            }
          />
        ) : null
      }
      control={
        <Select
          value={mixedPermissions ? null : settings.defaultRuntimeMode}
          onValueChange={(value) => {
            if (value) updateSettings({ defaultRuntimeMode: value });
          }}
        >
          <SelectTrigger size="sm" aria-label="Default permissions">
            {!mixedPermissions && (
              <PermissionIcon className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <SelectValue>
              {mixedPermissions ? "Mixed" : runtimeModeConfig[settings.defaultRuntimeMode].label}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {runtimeModeOptions.map((mode) => {
              const option = runtimeModeConfig[mode];
              const Icon = option.icon;
              return (
                <SelectItem key={mode} value={mode} className="min-w-64">
                  <div className="grid gap-0.5">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                      {option.label}
                    </span>
                    <span className="text-xs leading-4 text-muted-foreground">
                      {option.description}
                    </span>
                  </div>
                </SelectItem>
              );
            })}
          </SelectPopup>
        </Select>
      }
    />
  );
  if (aldoPart === "model") return modelRow;
  if (aldoPart === "permissions") return permissionsRow;

  return (
    <SettingsSection
      id={
        category === "general" || category === "project"
          ? "project-defaults"
          : category === "integrations"
            ? "browser-access"
            : "source-control-defaults"
      }
      title={
        category === "general" || category === "project"
          ? "New threads"
          : category === "integrations"
            ? "Browser"
            : "Repositories"
      }
    >
      {category === "project" ? (
        <>
          {modelRow}
          {/* Aldo starts each thread on a cloud agent of its own, so there is no workspace to pick. */}
          {isAldoCloud ? null : workspaceRow}
        </>
      ) : category === "general" ? (
        <>
          {modelRow}
          {permissionsRow}
          {/* Each Aldo thread works in its machine's own checkout, so these do nothing there. */}
          {isAldoCloud ? null : worktreeRows}
        </>
      ) : category === "source-control" ? (
        <>
          <SettingsRow
            serverScoped
            settingKeys={["defaultAutoPull"]}
            mixed={mixedAutoPull}
            id="automatic-pull"
            title="Automatically pull"
            description={
              isProjectScope
                ? "Keeps this project's default branch current when the checkout has no local changes or commits."
                : "Keeps the default branch current when the checkout has no local changes or commits. Projects can override it."
            }
            resetAction={
              settings.defaultAutoPull ? (
                <SettingResetButton
                  label="default automatic pull"
                  tooltip="Reset automatic pull to off"
                  onClick={() => updateSettings({ defaultAutoPull: false })}
                />
              ) : null
            }
            control={
              <Switch
                aria-label="Default automatic pull"
                mixed={mixedAutoPull}
                checked={mixedAutoPull ? false : settings.defaultAutoPull}
                onCheckedChange={(enabled) => updateSettings({ defaultAutoPull: enabled })}
              />
            }
          />
          <SettingsRow
            serverScoped
            settingKeys={["pullRequestMergeMethod"]}
            mixed={mixedMergeMethod}
            {...searchableSetting("pull-request-merge-method")}
            description={
              isProjectScope
                ? "Pull requests in this project start with this method."
                : "Pull requests start with this method. Last selected reuses whatever you chose most recently on this device."
            }
            resetAction={
              settings.pullRequestMergeMethod !== null ? (
                <SettingResetButton
                  label="default merge method"
                  tooltip="Reset to last selected"
                  onClick={() => updateSettings({ pullRequestMergeMethod: null })}
                />
              ) : null
            }
            control={
              <Select
                value={mixedMergeMethod ? null : (settings.pullRequestMergeMethod ?? "last")}
                onValueChange={(value) => {
                  if (value === "last") updateSettings({ pullRequestMergeMethod: null });
                  else if (value === "merge" || value === "squash" || value === "rebase")
                    updateSettings({ pullRequestMergeMethod: value });
                }}
              >
                <SelectTrigger size="sm" aria-label="Default pull request merge method">
                  <SelectValue>
                    {(value: string | null) =>
                      value === "merge" || value === "squash" || value === "rebase"
                        ? PULL_REQUEST_MERGE_METHOD_LABELS[value]
                        : value === "last"
                          ? "Last selected"
                          : "Mixed"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="last">Last selected</SelectItem>
                  <SelectItem value="merge">{PULL_REQUEST_MERGE_METHOD_LABELS.merge}</SelectItem>
                  <SelectItem value="squash">{PULL_REQUEST_MERGE_METHOD_LABELS.squash}</SelectItem>
                  <SelectItem value="rebase">{PULL_REQUEST_MERGE_METHOD_LABELS.rebase}</SelectItem>
                </SelectPopup>
              </Select>
            }
          />
        </>
      ) : (
        <>
          <SettingsRow
            serverScoped
            settingKeys={["enableAgentBrowserAccess"]}
            mixed={mixedBrowser}
            id={searchableSetting("agent-browser-access").id}
            title="Agent browser access"
            description={
              isProjectScope
                ? "Allow agents in this project to use the shared browser. Applies when the agent session next starts."
                : "Allow agents to use the shared browser. Projects can override it."
            }
            resetAction={
              settings.enableAgentBrowserAccess !==
              DEFAULT_SERVER_SETTINGS.enableAgentBrowserAccess ? (
                <SettingResetButton
                  label="default browser access"
                  onClick={() =>
                    updateSettings({
                      enableAgentBrowserAccess: DEFAULT_SERVER_SETTINGS.enableAgentBrowserAccess,
                    })
                  }
                />
              ) : null
            }
            control={
              <Switch
                aria-label="Agent browser access"
                mixed={mixedBrowser}
                checked={mixedBrowser ? false : settings.enableAgentBrowserAccess}
                onCheckedChange={(enabled) => updateSettings({ enableAgentBrowserAccess: enabled })}
              />
            }
          />
        </>
      )}
    </SettingsSection>
  );
}
