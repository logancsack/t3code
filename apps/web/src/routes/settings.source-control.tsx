import { createFileRoute, redirect } from "@tanstack/react-router";

import { isAldoCloud } from "../aldo/cloud";
import { aldoSettingsRedirect } from "../aldo/settings.logic";
import { SourceControlSettingsPanel } from "../components/settings/SourceControlSettings";

export const Route = createFileRoute("/settings/source-control")({
  beforeLoad: ({ location }) => {
    // Aldo's code hosts are among its Connections.
    if (isAldoCloud) {
      throw redirect({
        href: aldoSettingsRedirect(location) ?? "/settings/connections",
        replace: true,
      });
    }
  },
  component: SourceControlSettingsPanel,
});
