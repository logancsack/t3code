import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoAccountPage } from "../aldo/AldoAccountPage";
import { isAldoCloud } from "../aldo/api";

export const Route = createFileRoute("/settings/account")({
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: AldoAccountPage,
});
