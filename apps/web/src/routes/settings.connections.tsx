import { createFileRoute } from "@tanstack/react-router";

import { AldoConnectionsPage } from "../aldo/AldoConnectionsPage";
import { isAldoCloud } from "../aldo/api";
import { ConnectionsSettings } from "../components/settings/ConnectionsSettings";

function SettingsConnectionsRoute() {
  // Aldo connects to each thread's machine itself; its connections are the user's accounts and apps.
  return isAldoCloud ? <AldoConnectionsPage /> : <ConnectionsSettings />;
}

export const Route = createFileRoute("/settings/connections")({
  component: SettingsConnectionsRoute,
});
