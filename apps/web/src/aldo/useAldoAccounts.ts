import { useCallback } from "react";

import { settingsAccounts, settingsRepositories } from "./settingsData";
import { useSettingsResource } from "./settingsResource";

export function useAldoAccounts() {
  const { data, error } = useSettingsResource(settingsAccounts);
  const refresh = useCallback(() => {
    void settingsAccounts.refresh().catch(() => undefined);
    void settingsRepositories.refresh().catch(() => undefined);
  }, []);
  return { accounts: data ?? null, error, refresh };
}
