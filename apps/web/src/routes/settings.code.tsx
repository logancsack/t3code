import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoCodePage } from "../aldo/AldoCodePage";
import { isAldoCloud } from "../aldo/cloud";

export const Route = createFileRoute("/settings/code")({
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: AldoCodePage,
});
