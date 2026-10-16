import { createFileRoute, redirect } from "@tanstack/react-router";

import { isAldoCloud } from "../aldo/api";
import { aldoSettingsRedirect } from "../aldo/settings.logic";
import { IntegrationsSettingsPanel } from "../components/settings/IntegrationsSettings";

export const Route = createFileRoute("/settings/integrations")({
  beforeLoad: ({ location }) => {
    // Aldo's accounts and apps are its Connections, with what a sign-in or app sent back here.
    if (isAldoCloud) {
      throw redirect({
        href: aldoSettingsRedirect(location) ?? "/settings/connections",
        replace: true,
      });
    }
  },
  component: IntegrationsSettingsPanel,
});
