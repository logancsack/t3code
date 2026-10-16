import { createFileRoute, redirect } from "@tanstack/react-router";
import { isAldoCloud } from "../aldo/api";
import { StorageSettingsPanel } from "../components/settings/StorageSettings";

export const Route = createFileRoute("/settings/storage")({
  beforeLoad: () => {
    // Aldo's machines keep no worktrees to clean up, and its settings don't reach them.
    if (isAldoCloud) {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: StorageSettingsPanel,
});
