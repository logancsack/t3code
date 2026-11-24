import { create } from "zustand";

import type { AldoChartArtifact, AldoTableArtifact } from "./artifacts.logic";
import type { AldoVoiceReference } from "./voiceReferences";

/** What a call's reference opened beside it (AldoCallReferences.tsx): a table, a chart or a link. */
export const useCallArtifact = create<{
  artifact: AldoChartArtifact | AldoTableArtifact | null;
  link: Extract<AldoVoiceReference, { kind: "link" }> | null;
}>(() => ({ artifact: null, link: null }));

export function closeAldoCallArtifact(): void {
  useCallArtifact.setState({ artifact: null, link: null });
}
