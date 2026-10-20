import { useEffect, useMemo, useState } from "react";
import { AuthAccessWriteScope } from "@t3tools/contracts";

import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { isElectron } from "~/env";
import { isLocalEnvironmentDisabled } from "~/localEnvironment";
import { desktopWslStateAtom } from "~/state/desktopWslState";
import { useEnvironments } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { usePrimarySessionState } from "~/environments/primary";
import { fetchAldoAgentInbox, fetchAldoPhone } from "../../aldo/accountApi";
import { isAldoCloud } from "../../aldo/api";
import { useAldoDeveloperTools } from "../../aldo/developerTools";
import { useAldoOnboardingState } from "../../aldo/onboarding";
import { settingsPolicy } from "../../aldo/settingsData";
import { useSettingsResource } from "../../aldo/settingsResource";
import { isWslSettingsRowVisible } from "./ConnectionsSettings.logic";
import { isProviderSettingsEnvironmentAvailable } from "./ProviderSettingsPanel.logic";
import type { SettingsScopeSearch } from "./settingsScope";
import {
  filterAvailableSettingsSearchItems,
  getThreadAutoSettlementSearchAvailability,
} from "./settingsSearch";

export function useAvailableSettingsSearchItems(scopeSearch: SettingsScopeSearch = {}) {
  const [hasAldoPhoneApi, setHasAldoPhoneApi] = useState(false);
  const [hasAldoAgentInbox, setHasAldoAgentInbox] = useState(false);
  useEffect(() => {
    if (!isAldoCloud) return;
    let current = true;
    let latest = 0;
    // Both settings search and the command palette use this hook. A supported
    // API can still report an unconfigured provider; its settings section exists.
    // The agent inbox row shows only once Aldo says it has inboxes.
    const refresh = () => {
      const seq = ++latest;
      void fetchAldoPhone()
        .then((settings) => {
          if (current && seq === latest) setHasAldoPhoneApi(settings !== null);
        })
        .catch(() => {
          // Keep known support through an outage; retry when focus or network returns.
        });
      void fetchAldoAgentInbox()
        .then((inbox) => {
          if (current && seq === latest) setHasAldoAgentInbox(inbox?.available === true);
        })
        .catch(() => undefined);
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      current = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, []);
  const hasAldoOnboarding = Boolean(useAldoOnboardingState());
  // Permissions' newer rules are found only once Aldo says it takes them.
  const aldoPolicy = useSettingsResource(settingsPolicy, isAldoCloud, false).data;
  const aldoPolicyRules = aldoPolicy?.rules;
  const aldoDeveloperTools = useAldoDeveloperTools();
  const { environments } = useEnvironments();
  const primarySessionState = usePrimarySessionState();
  const localEnvironmentDisabled = isLocalEnvironmentDisabled();
  const desktopWsl = useEnvironmentQuery(
    isElectron && !localEnvironmentDisabled ? desktopWslStateAtom : null,
  );
  const canManageLocalBackend =
    !localEnvironmentDisabled &&
    (isElectron ||
      ((primarySessionState.data?.authenticated &&
        primarySessionState.data.scopes?.includes(AuthAccessWriteScope)) ??
        false));

  return useMemo(
    () =>
      filterAvailableSettingsSearchItems({
        hasAldoPhoneApi,
        hasAldoAgentInbox,
        hasAldoOnboarding,
        ...(aldoPolicyRules ? { aldoPolicyRules } : {}),
        aldoDeveloperTools,
        localEnvironmentDisabled,
        hasCloudPublicConfig: hasCloudPublicConfig(),
        hasEnvironment: environments.some((environment) => environment.serverConfig !== null),
        hasProviderSettingsEnvironment: environments.some((environment) =>
          isProviderSettingsEnvironmentAvailable({
            connectionPhase: environment.connection.phase,
            hasServerConfig: environment.serverConfig !== null,
          }),
        ),
        hasMacProviderSettingsEnvironment: environments.some(
          (environment) =>
            (scopeSearch.machine === undefined ||
              environment.environmentId === scopeSearch.machine) &&
            environment.serverConfig?.environment.platform.os === "darwin" &&
            isProviderSettingsEnvironmentAvailable({
              connectionPhase: environment.connection.phase,
              hasServerConfig: true,
            }),
        ),
        canManageLocalBackend,
        isWslSettingsRowVisible: isWslSettingsRowVisible({
          state: desktopWsl.data,
          error: desktopWsl.error,
        }),
        hasThreadAutoSettlement:
          getThreadAutoSettlementSearchAvailability(environments).eligibleEnvironmentIds.length > 0,
      }),
    [
      hasAldoPhoneApi,
      hasAldoAgentInbox,
      hasAldoOnboarding,
      aldoPolicyRules,
      aldoDeveloperTools,
      canManageLocalBackend,
      desktopWsl.data,
      desktopWsl.error,
      environments,
      localEnvironmentDisabled,
      scopeSearch.machine,
    ],
  );
}
