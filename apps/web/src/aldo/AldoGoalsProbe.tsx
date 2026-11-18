// Whether the account has a goal, for the account menu (AldoAccountMenu.tsx),
// which lists Goals only then. It shows nothing. A file of its own so the menu
// loads it after the first screen: most accounts have no goal, and none of
// them should wait on the goals' code to see Home.

import { useEffect } from "react";

import { refreshAldoGoals, useAldoGoals } from "./goals";

export default function AldoGoalsProbe(props: {
  /** The menu is open: a read that failed is tried again then. */
  readonly menuOpen: boolean;
  readonly onHasGoals: (has: boolean) => void;
}) {
  const { menuOpen, onHasGoals } = props;
  const { goals } = useAldoGoals();
  const has = (goals?.length ?? 0) > 0;
  const unread = goals === undefined;
  useEffect(() => {
    onHasGoals(has);
  }, [has, onHasGoals]);
  useEffect(() => {
    if (menuOpen && unread) void refreshAldoGoals();
  }, [menuOpen, unread]);
  return null;
}
