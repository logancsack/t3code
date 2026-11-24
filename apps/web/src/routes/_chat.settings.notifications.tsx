import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoNotificationsPage } from "../aldo/AldoNotificationSettings";
import { isAldoCloud } from "../aldo/api";

export const Route = createFileRoute("/settings/notifications")({
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: AldoNotificationsPage,
});
