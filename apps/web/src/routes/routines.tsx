import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoRoutinesPage } from "../aldo/AldoPlaces";
import { isAldoCloud } from "../aldo/cloud";

// Routines are Aldo's; a T3 client of its own has none.
export const Route = createFileRoute("/routines")({
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: AldoRoutinesPage,
});
