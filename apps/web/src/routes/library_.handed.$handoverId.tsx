import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoHandoverPage } from "../aldo/AldoHandoverPage";
import { isAldoCloud } from "../aldo/api";

function HandoverRoute() {
  const { handoverId } = Route.useParams();
  return <AldoHandoverPage handoverId={handoverId} />;
}

// A colleague's thread handed to the user is Aldo's; a T3 client of its own has none.
export const Route = createFileRoute("/library_/handed/$handoverId")({
  beforeLoad: () => {
    if (!isAldoCloud) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: HandoverRoute,
});
