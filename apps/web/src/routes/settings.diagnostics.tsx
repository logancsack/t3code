import { createFileRoute, redirect } from "@tanstack/react-router";

import { isAldoCloud } from "../aldo/api";
import { DiagnosticsSettingsPanel } from "../components/settings/DiagnosticsSettings";

export const Route = createFileRoute("/settings/diagnostics")({
  beforeLoad: () => {
    // It would inspect, and kill processes on, one arbitrary thread's machine.
    if (isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: DiagnosticsSettingsPanel,
});
