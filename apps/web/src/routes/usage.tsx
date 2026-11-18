import { createFileRoute, redirect } from "@tanstack/react-router";

import { isAldoCloud } from "../aldo/api";
import { aldoCheckoutReturn } from "../aldo/billing.logic";
import { UsagePage } from "../components/usage/UsagePage";

export const Route = createFileRoute("/usage")({
  beforeLoad: ({ location }) => {
    // Back from Stripe: Aldo's plan is on Settings → Account, where it was bought.
    if (isAldoCloud && aldoCheckoutReturn(location.searchStr)) {
      throw redirect({ href: `/settings/account${location.searchStr}`, replace: true });
    }
  },
  component: UsagePage,
});
