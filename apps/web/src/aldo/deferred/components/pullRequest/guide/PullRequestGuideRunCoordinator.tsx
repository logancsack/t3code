import { useGuideRunStore } from "../../../../../components/pullRequest/guide/guideRunStore";

type Real =
  typeof import("../../../../../components/pullRequest/guide/PullRequestGuideRunCoordinator");

/** Starts the real notifications once a guide run is being watched; none is when the page loads. */
export const startGuideRunNotifications: Real["startGuideRunNotifications"] = (
  registry,
  router,
) => {
  let stop: (() => void) | null = null;
  let stopped = false;
  const startWhenWatching = () => {
    if (Object.keys(useGuideRunStore.getState().watches).length === 0) return;
    unsubscribe();
    void import("../../../../../components/pullRequest/guide/PullRequestGuideRunCoordinator").then(
      (m) => {
        if (!stopped) stop = m.startGuideRunNotifications(registry, router);
      },
    );
  };
  const unsubscribe = useGuideRunStore.subscribe(startWhenWatching);
  startWhenWatching();
  return () => {
    stopped = true;
    unsubscribe();
    stop?.();
  };
};
