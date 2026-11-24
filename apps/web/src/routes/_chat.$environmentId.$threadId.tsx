import { createFileRoute } from "@tanstack/react-router";

import { loadThreadRouteView } from "../threadRoutes";

// The _chat layout owns ChatView so draft promotion keeps it mounted.
export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  // Its code loads with the route, so the layout renders it without waiting.
  loader: async () => {
    await loadThreadRouteView();
  },
  component: () => null,
});
