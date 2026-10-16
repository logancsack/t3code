import { createFileRoute, redirect } from "@tanstack/react-router";

import { isAldoCloud } from "../aldo/cloud";
import { aldoSettingsRedirect } from "../aldo/settings.logic";

// Aldo's ready-to-go environments are on Settings → Code now.
export const Route = createFileRoute("/settings/environments")({
  beforeLoad: ({ location }) => {
    if (isAldoCloud) {
      throw redirect({ href: aldoSettingsRedirect(location) ?? "/settings/code", replace: true });
    }
    throw redirect({ to: "/settings/general", replace: true });
  },
});
