import { createFileRoute } from "@tanstack/react-router";
import { AldoConnectionsPage } from "../aldo/AldoConnectionsPage";
import { isAldoCloud } from "../aldo/api";
import { ConnectionsSettings } from "../components/settings/ConnectionsSettings";

function SettingsConnectionsRoute() {
  // Aldo connects each thread's machine itself; its Connections are accounts and apps.
  if (isAldoCloud) return <AldoConnectionsPage />;
  return <ConnectionsSettings view="environments" />;
}

export const Route = createFileRoute("/_chat/settings/connections")({
  component: SettingsConnectionsRoute,
});
