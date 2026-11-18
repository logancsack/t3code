import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoAgentsPage } from "../aldo/AldoAgentsPage";
import { isAldoCloud } from "../aldo/api";

export const Route = createFileRoute("/settings/agents")({
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: AldoAgentsPage,
});
