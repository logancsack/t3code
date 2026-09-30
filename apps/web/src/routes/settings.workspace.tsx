import { Navigate, createFileRoute, redirect } from "@tanstack/react-router";

import { ManagedDevPcStatus } from "../components/ManagedDevPcStatus";
import { usePrimaryIsHub } from "../hubMode";
import { isManagedDevPc, isManagedHubBootstrap } from "../managedDevPc";

function WorkspaceSettingsRoute() {
  // A hub has no workspace machine to manage; each thread has its own.
  if (usePrimaryIsHub()) return <Navigate to="/settings/general" replace />;
  return <ManagedDevPcStatus view="settings" />;
}

export const Route = createFileRoute("/settings/workspace")({
  beforeLoad: () => {
    if (!isManagedDevPc || isManagedHubBootstrap()) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: WorkspaceSettingsRoute,
});
