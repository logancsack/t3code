import { lazy, Suspense } from "react";
import { AldoUpdateCard } from "./AldoUpdateCard";
import {
  currentDecisionReport,
  legacyHomeUpdate,
  technicalUpdateLink,
  type AldoHomeUpdate,
} from "./homeUpdate.logic";
import { artifactShows, linkRows, withoutShownLinks, type AldoArtifact } from "./artifacts.logic";
import { linkRuns, type AldoOpenTarget } from "./assistant.logic";
import { useAldoAssistant } from "./assistantSession";
import { sameTarget } from "./home.logic";
import { useAldoHomeFeed } from "./homeFeed";

/** What a reply shows under its words: loaded once one does, off the first screen. */
const AldoArtifacts = lazy(() => import("./AldoArtifacts"));

/** One logical reply, with task evidence and deliverables kept together. */
export function AldoReply(props: {
  readonly text: string;
  readonly at?: string | undefined;
  readonly update?: AldoHomeUpdate | undefined;
  readonly artifacts?: ReadonlyArray<AldoArtifact> | undefined;
  readonly decisionThreads?: ReadonlyArray<AldoOpenTarget> | undefined;
}) {
  const artifacts = props.artifacts ?? [];
  const update = props.update ?? legacyHomeUpdate(props.text);
  const target = update?.thread;
  const about = useAldoHomeFeed((s) =>
    target ? s.home?.conversations.find((c) => sameTarget(c.thread, target)) : undefined,
  );
  const following = useAldoHomeFeed((s) =>
    target &&
    s.home?.pullRequests.some(
      (pr) => sameTarget(pr.thread, target) && ["checks-running", "deploying"].includes(pr.stage),
    )
      ? "I’m checking the update before it goes live."
      : undefined,
  );
  const kept = withoutShownLinks(update?.summary ?? props.text, artifacts);
  const { text } = update ? linkRows(kept) : { text: kept };
  const links = update?.thread
    ? update.links
        .filter((l) => !technicalUpdateLink(l.url) && !artifactShows(l.url, artifacts))
        .map((l) => ({
          url: l.url,
          title: l.label,
          type: l.url.startsWith("/") ? "Link" : new URL(l.url).host.replace(/^www\./, ""),
        }))
    : [];
  // Home owns outstanding questions and their answer receipts. A task summary must not repeat them,
  // or revive an old “Needs you” label after the work has moved on.
  const failureId = useAldoAssistant((s) => {
    const report =
      about?.state === "failed" ? currentDecisionReport(s.entries, about, "failed") : undefined;
    return report?.kind === "message"
      ? (report.update ?? legacyHomeUpdate(report.text))?.id
      : undefined;
  });
  const hasDecision =
    about !== undefined &&
    (update?.state === "needs-you" ||
      (update?.state === "failed" &&
        about.state === "failed" &&
        failureId === update.id &&
        props.decisionThreads?.some((thread) => sameTarget(thread, about.thread))));
  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      {update ? (
        hasDecision ? null : (
          <AldoUpdateCard
            update={update}
            at={props.at}
            following={following}
            title={update.title === "Work update" ? about?.title : undefined}
          />
        )
      ) : text ? (
        <p className="max-w-[88%] self-start whitespace-pre-wrap wrap-anywhere rounded-[20px] border border-foreground/[0.07] bg-card px-4 py-2 text-[16px] leading-6 sm:max-w-[80%] sm:text-[15px] dark:border-white/[0.08] dark:bg-white/[0.045]">
          {linkRuns(text).map((run) =>
            run.href ? (
              <a
                key={run.at}
                href={run.href}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-foreground/25 underline-offset-4 hover:decoration-foreground"
              >
                {run.text}
              </a>
            ) : (
              run.text
            ),
          )}
        </p>
      ) : null}
      {artifacts.length || links.length ? (
        <Suspense fallback={null}>
          <AldoArtifacts artifacts={artifacts} links={links} />
        </Suspense>
      ) : null}
    </div>
  );
}
