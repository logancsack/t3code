import { createFileRoute, redirect } from "@tanstack/react-router";

import { isAldoCloud } from "../aldo/cloud";
import { SnapShotSettings } from "../components/settings/SnapShotSettings";

function SettingsSnapShotRoute() {
  return <SnapShotSettings />;
}

export const Route = createFileRoute("/settings/snap-shot")({
  beforeLoad: () => {
    // SnapShots need T3's desktop app.
    if (isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsSnapShotRoute,
});
