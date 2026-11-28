import {
  AlertCircleIcon,
  CheckIcon,
  CircleDashedIcon,
  CircleMinusIcon,
  ClockIcon,
  MessageCircleQuestionIcon,
  ChevronDownIcon,
} from "lucide-react";
import { useState } from "react";
import { cn } from "~/lib/utils";
import { AgentMarkdown } from "./AldoQuoted";
import { threadLink } from "./AldoWorkstream";
import {
  UPDATE_STATE_LABELS,
  distinctSources,
  technicalUpdateLink,
  type AldoHomeUpdate,
} from "./homeUpdate.logic";
import { relativeTime } from "./home.logic";
import { useNowMinute } from "../hooks/useNowMinute";
import { FOCUS } from "./surface";
import { linkRuns } from "./assistant.logic";

const EMPTY_LINES: ReadonlyArray<string> = [];
const EMPTY_LINKS: ReadonlyArray<{ readonly url: string; readonly label: string }> = [];

const ICONS = {
  done: CheckIcon,
  "needs-you": MessageCircleQuestionIcon,
  working: CircleDashedIcon,
  scheduled: ClockIcon,
  unfinished: CircleMinusIcon,
  failed: AlertCircleIcon,
  update: CircleMinusIcon,
};

/** One outcome and its original evidence, without inventing a new action or approval. */
export function AldoUpdateCard({
  update,
  title,
  following,
  at,
}: {
  readonly update: AldoHomeUpdate;
  readonly title?: string | undefined;
  readonly following?: string | undefined;
  readonly at?: string | undefined;
}) {
  const Icon = ICONS[update.state];
  const now = Date.parse(`${useNowMinute()}:00Z`);
  const [answerShown, setAnswerShown] = useState(true);
  const answer = update.answer;
  const evidenceLinks = update.links.filter(
    (link) => !update.thread || technicalUpdateLink(link.url),
  );
  return (
    <article
      data-aldo-update={update.id}
      className="w-full min-w-0 rounded-lg border border-foreground/[0.14] bg-card p-4 dark:bg-white/[0.045]"
    >
      <div className="flex items-center gap-2 text-[13px] leading-5">
        <Icon
          aria-hidden
          className={cn(
            "size-4 shrink-0",
            update.state === "done"
              ? "text-success-foreground"
              : update.state === "needs-you" || update.state === "failed"
                ? "text-warning-foreground"
                : update.state === "working"
                  ? "text-primary"
                  : "text-muted-foreground",
          )}
          strokeWidth={1.75}
        />
        <span className="font-semibold">{UPDATE_STATE_LABELS[update.state]}</span>
        {at ? (
          <time
            dateTime={at}
            aria-label={new Date(at).toLocaleString()}
            className="ml-auto text-muted-foreground"
          >
            {relativeTime(at, now)}
          </time>
        ) : null}
      </div>
      <h3 className="mt-3 mb-2 wrap-anywhere text-[14px] font-semibold leading-5">
        {title ?? update.title}
      </h3>
      <p className="whitespace-pre-wrap wrap-anywhere text-[16px] leading-6">{update.summary}</p>
      {update.partial ? (
        <p className="mt-2 text-[14px] leading-5 text-muted-foreground">
          What it made before it stopped is below. It isn't the finished result.
        </p>
      ) : null}
      {answer && answerShown ? (
        <AldoFullAnswer
          answer={answer}
          checked={update.checked}
          notChecked={update.notChecked}
          sources={update.sources ?? update.links}
        />
      ) : null}
      <div className="mt-3 flex flex-wrap items-start gap-x-4">
        {update.thread
          ? threadLink(
              update.thread,
              "Open work ↗",
              cn(
                FOCUS,
                "inline-flex min-h-11 items-center rounded-sm text-[14px] underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground",
              ),
            )
          : null}
        {answer ? (
          <button
            type="button"
            aria-expanded={answerShown}
            onClick={() => setAnswerShown((shown) => !shown)}
            className={cn(
              FOCUS,
              "inline-flex min-h-11 items-center rounded-sm text-[14px] text-muted-foreground hover:text-foreground",
            )}
          >
            {answerShown ? "Hide full answer" : "Show full answer"}
          </button>
        ) : null}
        {/* With the full answer shown, its checks and sources are in it; the rest stays under Details. */}
        <AldoUpdateDetails
          checked={answer && answerShown ? EMPTY_LINES : update.checked}
          notChecked={answer && answerShown ? EMPTY_LINES : update.notChecked}
          notes={update.notes}
          links={answer && answerShown ? EMPTY_LINKS : evidenceLinks}
          following={following}
        />
      </div>
    </article>
  );
}

/** Under the summary: the agent's own answer, what was checked, and every source it gave. */
function AldoFullAnswer({
  answer,
  checked,
  notChecked,
  sources,
}: {
  readonly answer: string;
  readonly checked: ReadonlyArray<string>;
  readonly notChecked: ReadonlyArray<string>;
  readonly sources: ReadonlyArray<{ readonly url: string; readonly label: string }>;
}) {
  const heading =
    "mt-4 mb-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground";
  const checks = [...new Set(checked)];
  const missed = [...new Set(notChecked)];
  return (
    <section aria-label="Full answer" className="mt-4 border-t border-foreground/10 pt-1">
      <h4 className={heading}>Full answer</h4>
      <AgentMarkdown text={answer} className="text-[15px] leading-6" />
      {checks.length || missed.length ? (
        <>
          <h4 className={heading}>
            Checked · {checks.length} of {checks.length + missed.length}
          </h4>
          <ul className="space-y-1.5 text-[15px] leading-[22px]">
            {checks.map((line) => (
              <li key={`c:${line}`} className="flex gap-2">
                <CheckIcon
                  aria-hidden
                  className="mt-[3px] size-4 shrink-0 text-success-foreground"
                />
                <span className="wrap-anywhere">{line}</span>
              </li>
            ))}
            {missed.map((line) => (
              <li key={`n:${line}`} className="flex gap-2 text-muted-foreground">
                <CircleMinusIcon aria-hidden className="mt-[3px] size-4 shrink-0" />
                <span className="wrap-anywhere">
                  <span className="sr-only">Not checked: </span>
                  {line}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {sources.length ? (
        <>
          <h4 className={heading}>Sources · {sources.length}</h4>
          <div className="flex flex-wrap gap-1.5">
            {distinctSources(sources).map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  FOCUS,
                  "inline-flex min-h-9 max-w-full items-center truncate rounded-full border border-foreground/[0.14] px-3 text-[13.5px] text-primary hover:border-foreground/30 pointer-coarse:min-h-11",
                )}
              >
                <span className="truncate">{link.label}</span>
              </a>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

/** The same evidence disclosure is used beside a result and its existing retry controls. */
export function AldoUpdateDetails({
  checked = EMPTY_LINES,
  notChecked = EMPTY_LINES,
  notes = EMPTY_LINES,
  links = EMPTY_LINKS,
  following,
}: {
  readonly checked?: ReadonlyArray<string> | undefined;
  readonly notChecked?: ReadonlyArray<string> | undefined;
  readonly notes?: ReadonlyArray<string> | undefined;
  readonly links?: ReadonlyArray<{ readonly url: string; readonly label: string }> | undefined;
  readonly following?: string | undefined;
}) {
  if (!checked.length && !notChecked.length && !notes.length && !links.length && !following)
    return null;
  return (
    <details className="group ml-auto max-w-full text-[14px] text-muted-foreground open:ml-0 open:basis-full">
      <summary
        className={cn(
          FOCUS,
          "flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-sm [&::-webkit-details-marker]:hidden",
        )}
      >
        <ChevronDownIcon aria-hidden className="size-3.5 group-open:rotate-180" />
        Details
      </summary>
      <div className="space-y-3 border-t border-foreground/10 pt-3 pb-1 leading-[22px]">
        {checked.length ? <Evidence label="Reported checks" lines={checked} /> : null}
        {notChecked.length ? <Evidence label="Not checked" lines={notChecked} /> : null}
        {notes?.length ? <Evidence label="Report" lines={notes} /> : null}
        {following ? <Evidence label="Current status" lines={[following]} /> : null}
        {links.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              FOCUS,
              "inline-flex min-h-11 items-center wrap-anywhere rounded-sm underline underline-offset-4",
            )}
          >
            {link.label}
          </a>
        ))}
      </div>
    </details>
  );
}

function Evidence({
  label,
  lines,
}: {
  readonly label: string;
  readonly lines: ReadonlyArray<string>;
}) {
  return (
    <section>
      <h4 className="font-medium text-foreground">{label}</h4>
      {[...new Set(lines)].map((line) => (
        <p key={line} className="mt-1 whitespace-pre-wrap wrap-anywhere">
          {linkRuns(line).map((run) =>
            run.href ? (
              <a
                key={run.at}
                href={run.href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(FOCUS, "underline underline-offset-4")}
              >
                {run.text}
              </a>
            ) : (
              run.text
            ),
          )}
        </p>
      ))}
    </section>
  );
}
