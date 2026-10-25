// A voice call in Aldo's conversation (assistant.logic.ts AldoCall): one card
// where it began, not a bubble per turn. It says when it was and how long, a
// few lines on what was discussed and decided (or "Summarizing…" until Aldo has
// written them), what the call started or made as links, and the transcript
// behind a tap, closed.

import { ArrowUpRightIcon, ChevronDownIcon, PhoneIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { cn } from "~/lib/utils";
import { AldoApiError } from "./api";
import { callLength, type AldoCall, type AldoCallLink } from "./assistant.logic";
import { aldoAssistant } from "./assistantApi";
import { useAldoArrive } from "./arrive";
import { threadLink } from "./AldoWorkstream";
import { FOCUS, SURFACE } from "./surface";

type Turn = { readonly role: "user" | "assistant"; readonly text: string; readonly at: string };
type Transcript =
  | { readonly state: "loading" }
  | { readonly state: "failed"; readonly error: string }
  | { readonly state: "ready"; readonly turns: ReadonlyArray<Turn>; readonly settled: boolean };

const ROW =
  "flex min-h-11 items-center justify-between gap-3 border-foreground/[0.06] border-t text-[14px] leading-5 dark:border-white/[0.06]";

function time(at: string): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function CallLink(props: { readonly link: AldoCallLink }) {
  const { link } = props;
  const body = (
    <>
      <span className="min-w-0 truncate">{link.title}</span>
      <ArrowUpRightIcon
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground"
        strokeWidth={1.75}
      />
    </>
  );
  const className = cn(ROW, FOCUS, "text-foreground hover:text-foreground/80");
  return link.kind === "thread" ? (
    threadLink(link, body, className)
  ) : (
    <a href={link.url} target="_blank" rel="noreferrer" className={className}>
      {body}
    </a>
  );
}

export function AldoCallCard(props: { readonly call: AldoCall }) {
  const { call } = props;
  const arrive = useAldoArrive();
  const panel = useId();
  const [open, setOpen] = useState(false);
  const [transcript, setTranscript] = useState<Transcript | null>(null);

  // A transcript read before the call was done may miss its last words: it's read again once it is.
  const settled = call.state === "done";
  const fetchTurns = () =>
    aldoAssistant
      .callTranscript(call.id)
      .then((turns) => setTranscript({ state: "ready", turns, settled }));
  const load = () => {
    setTranscript({ state: "loading" });
    fetchTurns().catch((error: unknown) =>
      setTranscript({
        state: "failed",
        error:
          error instanceof AldoApiError && error.status === 404
            ? "This transcript isn’t kept."
            : "Couldn’t load the transcript.",
      }),
    );
  };
  const stale = transcript?.state === "ready" && !transcript.settled && settled;
  useEffect(() => {
    if (open && stale) fetchTurns().catch(() => {});
    // oxlint-disable-next-line react/exhaustive-deps -- Only the call finishing reads it again.
  }, [open, stale]);
  const toggle = () => {
    setOpen(!open);
    if (!open && (!transcript || transcript.state === "failed" || stale)) load();
  };

  const meta = [time(call.at), call.state === "live" ? "on now" : callLength(call.seconds)];
  return (
    <article
      {...arrive}
      aria-label="Call with Aldo"
      data-aldo-call={call.id}
      className={cn(SURFACE, "flex w-full min-w-0 flex-col gap-3 px-4 pt-4 pb-1.5 sm:px-5")}
    >
      <header className="flex items-center gap-1.5 text-[12px] text-muted-foreground leading-[18px]">
        <PhoneIcon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span className="font-medium text-foreground/80">Call</span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">{meta.join(" · ")}</span>
      </header>
      <div aria-live="polite" className="text-[15px] leading-6">
        {call.state === "live" ? (
          <p className="text-muted-foreground">On a call now.</p>
        ) : call.state === "summarizing" ? (
          <p className="text-muted-foreground">Summarizing…</p>
        ) : call.summary ? (
          <p className="whitespace-pre-line wrap-anywhere">{call.summary}</p>
        ) : (
          <p className="text-muted-foreground">No summary for this call.</p>
        )}
      </div>
      {call.links.length > 0 ? (
        <ul className="-mb-1.5 flex flex-col">
          {call.links.map((link) => (
            <li
              key={link.kind === "thread" ? `${link.environmentId}/${link.threadId}` : link.url}
              className="flex flex-col"
            >
              <CallLink link={link} />
            </li>
          ))}
        </ul>
      ) : null}
      {call.state === "live" ? (
        <div className="h-1.5" />
      ) : (
        <div className="-mt-0.5 flex flex-col">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panel}
            onClick={toggle}
            className={cn(
              ROW,
              FOCUS,
              "w-full text-left text-muted-foreground hover:text-foreground",
            )}
          >
            Transcript
            <ChevronDownIcon
              aria-hidden
              className={cn(
                "size-4 shrink-0 transition-transform motion-reduce:transition-none",
                open && "rotate-180",
              )}
              strokeWidth={1.75}
            />
          </button>
          {open ? (
            <div id={panel} className="max-h-[60dvh] overflow-y-auto overscroll-contain pb-3">
              {!transcript || transcript.state === "loading" ? (
                <p className="text-[13px] text-muted-foreground leading-5">Loading…</p>
              ) : transcript.state === "failed" ? (
                <p className="text-[13px] text-muted-foreground leading-5">
                  {transcript.error}{" "}
                  <button
                    type="button"
                    className={cn("min-h-11 underline underline-offset-2", FOCUS)}
                    onClick={load}
                  >
                    Try again
                  </button>
                </p>
              ) : (
                <ol className="flex flex-col gap-2.5">
                  {transcript.turns.map((turn, index) => (
                    // oxlint-disable-next-line react/no-array-index-key -- A transcript never reorders, and two turns may read the same.
                    <li key={index} className="flex flex-col">
                      <span className="text-[12px] text-muted-foreground leading-[18px]">
                        {turn.role === "user" ? "You" : "Aldo"}
                      </span>
                      <span className="whitespace-pre-wrap text-[14px] leading-5 wrap-anywhere">
                        {turn.text}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : null}
        </div>
      )}
    </article>
  );
}
