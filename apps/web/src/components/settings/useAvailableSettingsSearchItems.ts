import { useEffect, useMemo, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AuthAccessWriteScope } from "@t3tools/contracts";

import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { isElectron } from "~/env";
import { desktopWslStateAtom } from "~/state/desktopWslState";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { usePrimarySessionState } from "~/environments/primary";
import { primaryServerConfigAtom } from "~/state/server";
import { fetchAldoPhone, isAldoCloud } from "../../aldo/cloud";
import { isWslSettingsRowVisible } from "./ConnectionsSettings.logic";
import { isProviderSettingsEnvironmentAvailable } from "./ProviderSettingsPanel.logic";
import { filterAvailableSettingsSearchItems } from "./settingsSearch";

export function useAvailableSettingsSearchItems() {
  const [hasAldoPhoneApi, setHasAldoPhoneApi] = useState(false);
  useEffect(() => {
    if (!isAldoCloud) return;
    let current = true;
    let latest = 0;
    // Both settings search and the command palette use this hook. A supported
    // API can still report an unconfigured provider; its settings section exists.
    const refresh = () => {
      const seq = ++latest;
      void fetchAldoPhone()
        .then((settings) => {
          if (current && seq === latest) setHasAldoPhoneApi(settings !== null);
        })
        .catch(() => {
          // Keep known support through an outage; retry when focus or network returns.
        });
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
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const primarySessionState = usePrimarySessionState();
  const primaryServerConfig = useAtomValue(primaryServerConfigAtom);
  const desktopWsl = useEnvironmentQuery(isElectron ? desktopWslStateAtom : null);
  const canManageLocalBackend =
    isElectron ||
    ((primarySessionState.data?.authenticated &&
      primarySessionState.data.scopes?.includes(AuthAccessWriteScope)) ??
      false);

  return useMemo(
    () =>
      filterAvailableSettingsSearchItems({
        hasAldoPhoneApi,
        hasCloudPublicConfig: hasCloudPublicConfig(),
        hasPrimaryEnvironment: primaryEnvironmentId !== null,
        hasProviderSettingsEnvironment: environments.some((environment) =>
          isProviderSettingsEnvironmentAvailable({
            connectionPhase: environment.connection.phase,
            hasServerConfig: environment.serverConfig !== null,
          }),
        ),
        canManageLocalBackend,
        isWslSettingsRowVisible: isWslSettingsRowVisible({
          state: desktopWsl.data,
          error: desktopWsl.error,
        }),
        hasThreadAutoSettlement:
          primaryServerConfig?.environment.capabilities.threadAutoSettlement === true,
      }),
    [
      hasAldoPhoneApi,
      canManageLocalBackend,
      desktopWsl.data,
      desktopWsl.error,
      environments,
      primaryEnvironmentId,
      primaryServerConfig,
    ],
  );
}
