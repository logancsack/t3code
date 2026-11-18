import { createFileRoute } from "@tanstack/react-router";

import { loadThreadRouteView } from "../threadRoutes";

// The view lives in the `_chat` layout (see ThreadRouteView) so a draft's
// promotion to `/$environmentId/$threadId` keeps the same ChatView mounted.
export const Route = createFileRoute("/_chat/draft/$draftId")({
  // Its code loads with the route, so the layout renders it without waiting.
  loader: async () => {
    await loadThreadRouteView();
  },
  component: () => null,
});
