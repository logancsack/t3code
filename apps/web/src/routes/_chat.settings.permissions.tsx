import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoPermissionsPage } from "../aldo/AldoPermissionsPage";
import { isAldoCloud } from "../aldo/api";

export const Route = createFileRoute("/_chat/settings/permissions")({
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: AldoPermissionsPage,
});
