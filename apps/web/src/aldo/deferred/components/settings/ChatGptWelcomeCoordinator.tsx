import { useAtomValue } from "@effect/atom-react";
import { usesChatGptSharing } from "@t3tools/shared/usageLimits";

import { environmentPresentations } from "../../../../state/presentation";
import { deferred } from "../../../deferred";

const Coordinator = deferred(() =>
  import("../../../../components/settings/ChatGptWelcomeCoordinator").then(
    (m) => m.ChatGptWelcomeCoordinator,
  ),
);

/** The welcome is for a connected ChatGPT plan, so it loads once an environment has one. */
export function ChatGptWelcomeCoordinator() {
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const providersByEnvironment = useAtomValue(environmentPresentations.providersByEnvironmentAtom);
  const shared = [...presentations].some(
    ([environmentId, presentation]) =>
      presentation.connection.phase === "connected" &&
      (providersByEnvironment.get(environmentId) ?? []).some(usesChatGptSharing),
  );
  return shared ? <Coordinator /> : null;
}
