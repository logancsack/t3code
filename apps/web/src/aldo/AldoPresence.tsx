// Aldo as someone you message: its halo (AldoHalo.tsx, turning while it
// thinks, following the voice on a call), its name, and a line beside it
// saying what it's at, like a messaging app's "typing…" (presence.logic.ts).
// Tapping it opens what's working now and what's coming up, each a tap
// from its thread: the detail behind the line, not a view of its own; and,
// under them, the way to what runs under the conversation (routines, what's
// due, pull requests, usage and rules, AldoUnderTheHood.tsx).

import {
  CalendarClockIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  RepeatIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useMemo } from "react";

import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { cn } from "~/lib/utils";
import { StateDot, stateSince } from "./AldoLiveCard";
import { ThreadLink } from "./AldoHomeInbox";
import { AldoHalo } from "./AldoHalo";
import { useAldoAssistant } from "./assistantSession";
import type { AldoHome } from "./cloud";
import { aldoWaitingCount } from "./decisions.logic";
import { boardFor, deliveryLabel, dueIn } from "./home.logic";
import { setAldoUnderTheHood } from "./simpleMode";
import { presenceLine } from "./presence.logic";
import { useAldoReceipts } from "./receipts";
import "./presence.css";

/** The top of Aldo's conversation: its halo, name and what it's at, opening what's working and coming up. */
export function AldoPresence(props: {
  readonly home: AldoHome | null;
  readonly now: number;
  /** The home read failed before anything was read. */
  readonly unread?: boolean;
}) {
  const { home, now } = props;
  const phase = useAldoAssistant((s) => s.phase);
  const replying = useAldoAssistant((s) => s.replying);
  const working = useMemo(
    () => (home ? boardFor(home.conversations, now).working : []),
    [home, now],
  );
  // What was just decided here no longer waits, though the home read still has it.
  const receipts = useAldoReceipts((s) => s.receipts);
  const waiting = home
    ? aldoWaitingCount(
        home,
        now,
        receipts.map((r) => r.key),
      )
    : 0;
  const line = presenceLine({ phase, replying, working, waiting, unread: props.unread === true });
  const coming = useMemo(() => (home ? comingUp(home, now) : []), [home, now]);
  // Once there's a read, there's what runs under the conversation to open.
  const detail = home !== null;
  const thinking = line.mood === "thinking";
  const presence = (
    <>
      <AldoHalo size={32} mood={line.mood} />
      <span className="flex min-w-0 flex-col items-start">
        <span className="font-semibold text-[15px] leading-5 tracking-[-0.01em]">Aldo</span>
        <span className="flex max-w-60 items-center gap-1.5 text-[12px] text-muted-foreground leading-[18px] sm:max-w-80">
          {waiting > 0 && !thinking ? (
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />
          ) : null}
          <span className="truncate">{line.text}</span>
          {detail ? (
            <ChevronDownIcon aria-hidden className="size-3 shrink-0 opacity-60" strokeWidth={2} />
          ) : null}
        </span>
      </span>
    </>
  );
  const layout = "flex items-center gap-2.5 rounded-2xl py-1 ps-1 pe-3 text-left outline-none";
  if (!detail)
    return (
      <div className={layout} data-aldo-presence="">
        {presence}
      </div>
    );
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          layout,
          "transition-colors hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring",
        )}
        aria-label={`Aldo: ${line.text}`}
        data-aldo-presence=""
      >
        {presence}
      </PopoverTrigger>
      <PopoverPopup width="md" padding="compact" align="center">
        <div className="flex flex-col gap-3 py-1">
          {working.length > 0 ? (
            <section className="flex flex-col gap-0.5">
              <h3 className="px-1.5 font-medium text-[12px] text-muted-foreground">Working now</h3>
              <ul className="flex flex-col">
                {working.map((c) => (
                  <li key={c.ref}>
                    <ThreadLink
                      target={c.thread}
                      className="flex w-full items-start gap-2.5 rounded-lg px-1.5 py-2 text-left outline-none hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <StateDot conversation={c} now={now} className="mt-1.5" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-sm">{c.title}</span>
                        <span className="block truncate text-[12px] text-muted-foreground tabular-nums">
                          {c.summary ? `${c.summary} · ` : ""}
                          {stateSince(c, now)}
                        </span>
                      </span>
                    </ThreadLink>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {coming.length > 0 ? (
            <section className="flex flex-col gap-0.5">
              <h3 className="px-1.5 font-medium text-[12px] text-muted-foreground">Coming up</h3>
              <ul className="flex flex-col">
                {coming.map((item) => (
                  <li key={item.key} className="flex items-start gap-2.5 px-1.5 py-2">
                    {item.routine ? (
                      <RepeatIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <CalendarClockIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{item.title}</span>
                      <span className="block truncate text-[12px] text-muted-foreground tabular-nums">
                        {item.detail} · {item.when}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <div
            className={cn(
              (working.length > 0 || coming.length > 0) && "border-foreground/[0.06] border-t pt-1",
            )}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-2 text-left outline-none hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setAldoUnderTheHood(true)}
            >
              <SlidersHorizontalIcon
                aria-hidden
                className="size-3.5 shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-sm">Under the hood</span>
                <span className="block truncate text-[12px] text-muted-foreground">
                  Routines, what's scheduled, pull requests, usage
                </span>
              </span>
              <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/** What's due: messages and reminders to be sent, and routines' next runs, soonest first. */
function comingUp(home: AldoHome, now: number) {
  const deliveries = home.upcoming.map((d) => ({
    key: `delivery:${d.id}`,
    at: d.dueAt,
    title: d.message,
    detail: `${deliveryLabel(d)} · ${d.threadTitle}`,
    when: dueIn(d.dueAt, now),
    routine: false,
  }));
  const routines = (home.routines ?? []).flatMap((r) =>
    r.enabled && r.nextRunAt
      ? [
          {
            key: `routine:${r.id}`,
            at: r.nextRunAt,
            title: r.title,
            detail: r.when,
            when: dueIn(r.nextRunAt, now),
            routine: true,
          },
        ]
      : [],
  );
  return [...deliveries, ...routines].sort((a, b) => a.at.localeCompare(b.at)).slice(0, 6);
}
