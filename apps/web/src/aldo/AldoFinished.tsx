// What finished, at the end of Aldo's conversation, under Needs you
// (AldoConversationPage.tsx): threads that are done whose pull requests are
// still on their way (finished.logic.ts). Each is a line saying where it
// honestly stands (amber when something failed, a green check only once it's
// shipped), which opens in place into its receipt: what the agent said, the
// evidence Aldo has (checks, how often it went back to the agent), and what
// to do. A merge Aldo makes on its own shows when, with Hold: held, it waits
// for the user's merge in Needs you. What's only waiting on checks is a quiet
// line under the rest until it's ready.

import { ChevronDownIcon, CircleDashedIcon } from "lucide-react";
import { lazy, Suspense, useContext, useMemo, useState } from "react";

import { cn } from "~/lib/utils";
import { AldoOpenContext } from "./AldoLiveCard";
import { ResultGlyph } from "./AldoResultMark";
import { useAldoArrive } from "./arrive";
import type { AldoAssistantMessage } from "./assistant.logic";
import { finishedResults, onlyWaiting, type AldoFinishedResult } from "./finished.logic";
import { sameTarget } from "./home.logic";
import { type AldoHome } from "./homeApi";
import { legacyHomeUpdate } from "./homeUpdate.logic";
import { FOCUS, SURFACE } from "./surface";

/** A receipt, loaded when one is first opened (or about to be: a pointer on its line). */
const loadCard = () => import("./AldoFinishedCard");
const ResultCard = lazy(loadCard);

/** Results shown before the rest unfold. */
const SHOWN = 3;

export function AldoFinished(props: {
  readonly home: AldoHome;
  readonly now: number;
  readonly told?: ReadonlyArray<Pick<AldoAssistantMessage, "text" | "update" | "call" | "source">>;
}) {
  const results = useMemo(() => {
    // Only a rendered result card carries the current-status disclosure. Ordinary links,
    // call transcripts, briefs and old asks leave the quiet progress line in place.
    const replacements = props.told?.flatMap((m) => {
      if (m.call !== undefined || m.source === "brief") return [];
      const update = m.update ?? legacyHomeUpdate(m.text);
      return update?.thread && update.state !== "needs-you" ? [update.thread] : [];
    });
    return finishedResults(props.home, props.now).filter(
      (r) =>
        !onlyWaiting(r) ||
        !replacements?.some((thread) => sameTarget(thread, r.conversation.thread)),
    );
  }, [props.home, props.now, props.told]);
  const rows = results.filter((r) => !onlyWaiting(r));
  const waiting = results.filter(onlyWaiting);
  const [opened, setOpened] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  if (results.length === 0) return null;
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <details
      aria-label="Following updates"
      className="group flex flex-col gap-2"
      data-aldo-finished=""
    >
      <summary
        className={cn(
          FOCUS,
          "flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-sm px-1 text-[14px] text-muted-foreground [&::-webkit-details-marker]:hidden",
        )}
      >
        <span>
          Following {results.length} {results.length === 1 ? "update" : "updates"}
        </span>
        <ChevronDownIcon aria-hidden className="ml-auto size-3.5 group-open:rotate-180" />
      </summary>
      {shown.map((r) => {
        const row = (
          <ResultRow key={r.key} result={r} now={props.now} onOpen={() => setOpened(r.key)} />
        );
        // Its line stays while its receipt loads, the first time one opens.
        return r.key === opened ? (
          <Suspense key={r.key} fallback={row}>
            <ResultCard result={r} now={props.now} onClose={() => setOpened(null)} />
          </Suspense>
        ) : (
          row
        );
      })}
      {rows.length > SHOWN ? (
        <button
          type="button"
          className={cn(
            FOCUS,
            "mx-auto flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
          )}
          onClick={() => setAll((v) => !v)}
        >
          {all ? "Show fewer" : `${rows.length - SHOWN} more`}
          <ChevronDownIcon
            className={cn("size-3.5 transition-transform", all && "rotate-180")}
            strokeWidth={1.75}
          />
        </button>
      ) : null}
      {waiting.map((r) => (
        <WaitingLine key={r.key} result={r} />
      ))}
    </details>
  );
}

/** A result in a line: what it is, where it stands (under it on a phone, so it isn't cut off), and a tap opens it. */
function ResultRow(props: {
  readonly result: AldoFinishedResult;
  readonly now: number;
  readonly onOpen: () => void;
}) {
  const arrive = useAldoArrive();
  const r = props.result;
  return (
    <article
      {...arrive}
      className={cn(SURFACE, "overflow-hidden")}
      data-aldo-finished-result={r.key}
    >
      <button
        type="button"
        aria-expanded={false}
        className={cn(
          FOCUS,
          "flex min-h-13 w-full min-w-0 items-center gap-3 rounded-[20px] px-4 py-2.5 text-left transition-colors hover:bg-foreground/[0.025]",
        )}
        onClick={props.onOpen}
        // About to be opened: its receipt starts loading.
        onPointerEnter={() => void loadCard().catch(() => {})}
        onFocus={() => void loadCard().catch(() => {})}
      >
        <ResultGlyph state={r.state} />
        <span className="flex min-w-0 flex-1 flex-col gap-px sm:flex-row sm:items-center sm:gap-3">
          <span className="min-w-0 flex-1 truncate font-medium text-[14px] leading-5">
            {r.conversation.title}
          </span>
          <span className="text-[13px] text-muted-foreground">
            {r.state.tone === "failing"
              ? "I found a problem with this update."
              : r.state.tone === "shipped"
                ? "The change is ready."
                : "I’m preparing the update."}
          </span>
        </span>
        <ChevronDownIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.75}
        />
      </button>
    </article>
  );
}

/** Done, but its checks or deploy are still going: a quiet line, a tap from its thread. */
function WaitingLine(props: { readonly result: AldoFinishedResult }) {
  const open = useContext(AldoOpenContext);
  const r = props.result;

  const body = (
    <>
      <span aria-hidden className="flex h-5 w-4 shrink-0 items-center justify-center">
        <CircleDashedIcon className="size-[15px]" strokeWidth={1.75} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <span className="min-w-0 flex-1 truncate text-foreground/80">{r.conversation.title}</span>
        <span className="text-[13px] text-muted-foreground">
          I’m checking the update before it goes live.
        </span>
      </span>
    </>
  );
  const className =
    "flex min-h-11 w-full items-center gap-2.5 rounded-md px-4 py-2 text-left text-[13px] text-muted-foreground leading-5 sm:min-h-8";
  return open ? (
    <button
      type="button"
      className={cn(FOCUS, className, "hover:text-foreground")}
      data-aldo-finished-result={r.key}
      onClick={(event) => open(r.conversation.thread, event.currentTarget)}
    >
      {body}
    </button>
  ) : (
    <div className={className} data-aldo-finished-result={r.key}>
      {body}
    </div>
  );
}
