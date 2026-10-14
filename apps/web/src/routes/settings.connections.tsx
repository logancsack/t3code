import { createFileRoute, redirect } from "@tanstack/react-router";

import { isAldoCloud } from "../aldo/cloud";
import { ConnectionsSettings } from "../components/settings/ConnectionsSettings";

export const Route = createFileRoute("/settings/connections")({
  beforeLoad: () => {
    // Aldo connects to each thread's machine itself; there's nothing to pair or save.
    if (isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: ConnectionsSettings,
});
