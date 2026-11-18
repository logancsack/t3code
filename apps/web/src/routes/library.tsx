import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoLibraryPage } from "../aldo/AldoPlaces";
import { isAldoCloud } from "../aldo/api";

// What the user's agents shared is Aldo's; a T3 client of its own has none.
export const Route = createFileRoute("/library")({
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: AldoLibraryPage,
});
