// Moving a draft before its first message (the place picker, the where-card,
// a suggestion): it goes to a machine of its own in the place it moves to
// (aldoProjectForMovedDraft), keeping what's typed, as T3's project picker on
// a draft moves it in place, with that project's default model unless one
// was picked.

import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useState } from "react";

import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { useClientSettings } from "../hooks/useSettings";
import { hasExplicitComposerModelSelection } from "../lib/chatThreadActions";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "../logicalProject";
import { useEnvironments } from "../state/environments";
import { aldoProjectForMovedDraft, type AldoDraftTarget } from "./newThread";

/** Moves a draft to a place; resolves whether it moved (another move, a send or a failure stop it). */
export function useMoveAldoDraft(draftId: DraftId | null | undefined): {
  readonly move: (target: AldoDraftTarget) => Promise<boolean>;
  readonly moving: boolean;
} {
  const { environments } = useEnvironments();
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const [moving, setMoving] = useState(false);
  const move = async (target: AldoDraftTarget) => {
    if (!draftId) return false;
    setMoving(true);
    try {
      const project = await aldoProjectForMovedDraft(draftId, target);
      if (!project) return false;
      const store = useComposerDraftStore.getState();
      const current = store.getComposerDraft(draftId);
      store.setLogicalProjectDraftThreadId(
        deriveLogicalProjectKeyFromSettings(project, groupingSettings),
        scopeProjectRef(project.environmentId, project.id),
        draftId,
      );
      if (!hasExplicitComposerModelSelection(current)) {
        store.applyStickyState(draftId);
        const settings = environments.find(
          (environment) => environment.environmentId === project.environmentId,
        )?.serverConfig?.settings;
        const defaultModelSelection = settings
          ? resolveProjectSettings(settings, project.id, project).settings.defaultModelSelection
          : project.defaultModelSelection;
        if (defaultModelSelection) {
          store.setModelSelection(draftId, defaultModelSelection, { replaceOptions: true });
        }
      }
      return true;
    } finally {
      setMoving(false);
    }
  };
  return { move, moving };
}
