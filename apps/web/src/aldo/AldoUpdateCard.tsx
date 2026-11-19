import {
  AlertCircleIcon,
  CheckIcon,
  CircleDashedIcon,
  CircleMinusIcon,
  ClockIcon,
  MessageCircleQuestionIcon,
  ChevronDownIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { threadLink } from "./AldoWorkstream";
import { UPDATE_STATE_LABELS, technicalUpdateLink, type AldoHomeUpdate } from "./homeUpdate.logic";
import { relativeTime } from "./home.logic";
import { useNowMinute } from "../hooks/useNowMinute";
import { FOCUS } from "./surface";

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
        <AldoUpdateDetails
          checked={update.checked}
          notChecked={update.notChecked}
          notes={update.notes}
          links={evidenceLinks}
          following={following}
        />
      </div>
    </article>
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
          {line}
        </p>
      ))}
    </section>
  );
}
