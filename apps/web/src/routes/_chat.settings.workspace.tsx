import { createFileRoute, redirect } from "@tanstack/react-router";

import { ManagedDevPcStatus } from "../components/ManagedDevPcStatus";
import { isManagedDevPc } from "../managedDevPc";

function WorkspaceSettingsRoute() {
  return <ManagedDevPcStatus view="settings" />;
}

export const Route = createFileRoute("/settings/workspace")({
  beforeLoad: () => {
    if (!isManagedDevPc) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: WorkspaceSettingsRoute,
});
