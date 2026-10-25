import {
  ArrowUpRightIcon,
  ChartNoAxesCombinedIcon,
  FileTextIcon,
  MessageSquareIcon,
} from "lucide-react";
import { lazy, Suspense } from "react";
import { create } from "zustand";

import { useOpenChangeRequestLink } from "../lib/openPullRequestLink";
import { Sheet, SheetPopup, SheetTitle } from "../components/ui/sheet";
import type { AldoChartArtifact, AldoTableArtifact } from "./artifacts.logic";
import { openAldoVoiceThread, useAldoAssistant } from "./assistantSession";
import { minimizeAldoCall } from "./callView";
import { openAldoShare } from "./shareViewer";
import { FOCUS } from "./surface";
import { voiceReferenceKey, type AldoVoiceReference } from "./voiceReferences";

const useCallArtifact = create<{
  artifact: AldoChartArtifact | AldoTableArtifact | null;
  link: Extract<AldoVoiceReference, { kind: "link" }> | null;
}>(() => ({ artifact: null, link: null }));
const ArtifactDetail = lazy(() =>
  import("./AldoArtifacts").then((m) => ({ default: m.AldoArtifactDetail })),
);

export function closeAldoCallArtifact(): void {
  useCallArtifact.setState({ artifact: null, link: null });
}

export function openAldoVoiceReference(reference: AldoVoiceReference): void {
  minimizeAldoCall();
  if (reference.kind === "thread") return openAldoVoiceThread(reference.target);
  if (reference.kind === "link") {
    useCallArtifact.setState({ artifact: null, link: reference });
    return;
  }
  const artifact = reference.artifact;
  if (artifact.kind === "file") {
    openAldoShare({
      id: /^\/s\/([\w-]+)$/.exec(artifact.url)?.[1] ?? null,
      url: artifact.url,
      title: artifact.title,
      contentType: artifact.contentType,
      share: null,
    });
  } else useCallArtifact.setState({ artifact, link: null });
}

export function AldoCallReferences() {
  const openChangeRequest = useOpenChangeRequestLink();
  const references = useAldoAssistant((s) => s.references);
  if (!references.length) return null;
  return (
    <ul aria-label="Mentioned on this call" className="flex w-full max-w-md flex-col gap-2 py-4">
      {references.toReversed().map((r) => {
        const title = r.kind === "artifact" ? r.artifact.title || "Table" : r.title;
        const type =
          r.kind === "artifact"
            ? r.artifact.kind === "file"
              ? "Open file"
              : `Open ${r.artifact.kind}`
            : r.kind === "thread"
              ? "Open thread"
              : "Open pull request";
        const Icon =
          r.kind === "thread"
            ? MessageSquareIcon
            : r.kind === "artifact" && r.artifact.kind !== "file"
              ? ChartNoAxesCombinedIcon
              : FileTextIcon;
        return (
          <li key={voiceReferenceKey(r)}>
            <button
              type="button"
              aria-label={`${type}: ${title}`}
              onClick={(event) => {
                if (r.kind === "link" && openChangeRequest(event, r.url)) {
                  minimizeAldoCall();
                  return;
                }
                openAldoVoiceReference(r);
              }}
              className={`flex min-h-14 w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-accent active:bg-accent ${FOCUS}`}
            >
              <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-sm font-medium">{title}</span>
                <span className="block text-xs text-muted-foreground">{type}</span>
              </span>
              <ArrowUpRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function AldoCallArtifact() {
  const { artifact, link } = useCallArtifact();
  const live = useAldoAssistant((s) => s.phase !== "idle" && s.phase !== "error");
  return (
    <Sheet
      modal={!live}
      open={artifact !== null || link !== null}
      onOpenChange={(open) => {
        if (!open) closeAldoCallArtifact();
      }}
    >
      <SheetPopup side="right" className="w-full max-w-3xl pt-safe pb-safe">
        <SheetTitle className="px-4 py-3">{link?.title || artifact?.title || "Table"}</SheetTitle>
        {link ? (
          <div className="flex flex-col gap-3 px-4 py-3 text-sm">
            <p>Connect this repository in Aldo to read its pull request here.</p>
            <a
              className={FOCUS + " underline underline-offset-4"}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open on {new URL(link.url).hostname === "github.com" ? "GitHub" : "GitLab"} in a new
              tab
            </a>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-28">
          <Suspense fallback={<p>Loading…</p>}>
            {artifact ? <ArtifactDetail artifact={artifact} /> : null}
          </Suspense>
        </div>
      </SheetPopup>
    </Sheet>
  );
}
