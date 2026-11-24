import { useEffect, useState } from "react";

import type { SettingsSearchAvailability } from "../components/settings/settingsSearch";
import { fetchAldoAgentInbox, fetchAldoPhone } from "./accountApi";
import { isAldoCloud } from "./api";
import { useAldoDeveloperTools } from "./developerTools";
import { useAldoOnboardingState } from "./onboarding";
import { aldoOrgManages } from "./organization.logic";
import { settingsOrg, settingsOrgJoining, settingsPolicy } from "./settingsData";
import { useSettingsResource } from "./settingsResource";

/** Which of Aldo's pages and rows exist for this account, for settings search and the palette. */
export function useAldoSettingsSearchAvailability(): Partial<SettingsSearchAvailability> {
  const [hasAldoPhoneApi, setHasAldoPhoneApi] = useState(false);
  const [hasAldoAgentInbox, setHasAldoAgentInbox] = useState(false);
  // Asks Aldo's API, again on focus and reconnect.
  useEffect(() => {
    if (!isAldoCloud) return;
    let current = true;
    let latest = 0;
    const refresh = () => {
      const seq = ++latest;
      // An outage keeps what was known; focus or the network coming back asks again.
      void fetchAldoPhone()
        .then((settings) => {
          if (current && seq === latest) setHasAldoPhoneApi(settings !== null);
        })
        .catch(() => undefined);
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
  const aldoPolicyRules = useSettingsResource(settingsPolicy, isAldoCloud, false).data?.rules;
  const aldoOrg = useSettingsResource(settingsOrg, isAldoCloud, false).data;
  const hasAldoJoining = Boolean(
    useSettingsResource(settingsOrgJoining, Boolean(aldoOrg && aldoOrgManages(aldoOrg)), false)
      .data,
  );
  const aldoDeveloperTools = useAldoDeveloperTools();
  return {
    hasAldoPhoneApi,
    hasAldoOrganization: Boolean(aldoOrg),
    hasAldoJoining,
    hasAldoAgentInbox,
    hasAldoOnboarding,
    ...(aldoPolicyRules ? { aldoPolicyRules } : {}),
    aldoDeveloperTools,
  };
}
