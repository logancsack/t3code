import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoGoalPage } from "../aldo/AldoGoals";
import { isAldoCloud } from "../aldo/api";

function GoalRoute() {
  const { goalId } = Route.useParams();
  // Another goal is another page: nothing read for one shows under the next.
  return <AldoGoalPage key={goalId} goalId={goalId} />;
}

// One goal's page is Aldo's; a T3 client of its own has none.
export const Route = createFileRoute("/goals_/$goalId")({
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: GoalRoute,
});
