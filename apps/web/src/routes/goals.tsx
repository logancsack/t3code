import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoGoalsPage } from "../aldo/AldoGoals";
import { isAldoCloud } from "../aldo/api";

// Goals are Aldo's; a T3 client of its own has none.
export const Route = createFileRoute("/goals")({
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: AldoGoalsPage,
});
