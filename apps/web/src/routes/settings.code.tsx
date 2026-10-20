import { Navigate, createFileRoute, redirect } from "@tanstack/react-router";

import { AldoCodePage } from "../aldo/AldoCodePage";
import { isAldoCloud } from "../aldo/api";
import { useAldoDeveloperToolsState } from "../aldo/developerTools";

export const Route = createFileRoute("/settings/code")({
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: AldoCodeSettingsRoute,
});

/** Code is a developer tool: an account without them goes to General. */
function AldoCodeSettingsRoute() {
  if (useAldoDeveloperToolsState() === false) return <Navigate to="/settings/general" replace />;
  return <AldoCodePage />;
}
