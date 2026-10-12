import { createFileRoute, redirect } from "@tanstack/react-router";

import { AldoMailPage } from "../aldo/AldoMail";
import { isAldoCloud } from "../aldo/cloud";
import { parseAldoMailSearch, type AldoMailSearch } from "../aldo/mail.logic";

function MailRoute() {
  const navigate = Route.useNavigate();
  return (
    <AldoMailPage
      search={Route.useSearch()}
      onNavigate={(search: AldoMailSearch) => void navigate({ to: "/mail", search })}
    />
  );
}

// The agents' inbox is Aldo's; a T3 client of its own has none.
export const Route = createFileRoute("/mail")({
  validateSearch: parseAldoMailSearch,
  beforeLoad: () => {
    if (!isAldoCloud) throw redirect({ to: "/", replace: true });
  },
  component: MailRoute,
});
