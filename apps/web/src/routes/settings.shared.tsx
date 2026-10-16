import { createFileRoute, redirect } from "@tanstack/react-router";

import { isAldoCloud } from "../aldo/cloud";

// What the user's agents shared is Aldo's Library now.
export const Route = createFileRoute("/settings/shared")({
  beforeLoad: () => {
    throw redirect(
      isAldoCloud ? { to: "/library", replace: true } : { to: "/settings/general", replace: true },
    );
  },
});
