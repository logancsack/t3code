// Aldo as someone you message: its face (the orb, with eyes that blink, look
// about while its agents work and look up while it thinks), its name, and a
// line under it saying what it's at, like a messaging app's "typing…"
// (presence.logic.ts). Tapping it opens what's working now and what's coming
// up, each a tap from a peek: the detail behind the line, not a view of its own.

import { CalendarClockIcon, ChevronDownIcon, RepeatIcon } from "lucide-react";
import { useContext, useMemo } from "react";

import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { cn } from "~/lib/utils";
import { AldoPeekContext, StateDot, stateSince } from "./AldoLiveCard";
import { useAldoAssistant } from "./assistantSession";
import type { AldoHome } from "./cloud";
import { aldoWaitingCount } from "./decisions.logic";
import { boardFor, deliveryLabel, dueIn } from "./home.logic";
import { presenceLine, type AldoMood } from "./presence.logic";
import "./presence.css";

/** Aldo's face. `mood` moves its eyes; while it speaks or hears, it swells with the voice. */
export function AldoAvatar(props: {
  readonly size: number;
  readonly mood?: AldoMood;
  readonly className?: string;
}) {
  const levels = useAldoAssistant((s) => s.levels);
  const mood = props.mood ?? "idle";
  const level = mood === "speaking" ? levels.aldo : mood === "listening" ? levels.mic : 0;
  const eyeWidth = Math.max(3, Math.round(props.size * 0.13));
  const eyeHeight = Math.max(4, Math.round(props.size * 0.18));
  return (
    <span
      aria-hidden
      className={cn("relative inline-flex shrink-0 items-center justify-center", props.className)}
      style={{ width: props.size, height: props.size }}
    >
      <span
        className="absolute inset-0 rounded-full bg-gradient-to-br from-primary to-primary/55 shadow-md shadow-primary/25 transition-transform duration-100 motion-reduce:transition-none"
        style={{ transform: `scale(${1 + Math.min(1, level * 2.5) * 0.12})` }}
      />
      <span className="absolute inset-[8%] rounded-full bg-gradient-to-b from-white/30 to-transparent to-60%" />
      <span
        data-aldo-eyes=""
        className="relative flex items-center"
        data-mood={mood}
        style={{ gap: Math.round(props.size * 0.18), marginTop: -Math.round(props.size * 0.04) }}
      >
        {[0, 1].map((eye) => (
          <span
            key={eye}
            data-aldo-eye=""
            className="block rounded-full bg-white/95"
            style={{ width: eyeWidth, height: eyeHeight }}
          />
        ))}
      </span>
    </span>
  );
}

/** The top of Aldo's conversation: its face, name and what it's at, opening what's working and coming up. */
export function AldoPresence(props: {
  readonly home: AldoHome | null;
  readonly now: number;
  readonly compact?: boolean;
}) {
  const { home, now } = props;
  const phase = useAldoAssistant((s) => s.phase);
  const replying = useAldoAssistant((s) => s.replying);
  const working = useMemo(
    () => (home ? boardFor(home.conversations, now).working : []),
    [home, now],
  );
  const waiting = home ? aldoWaitingCount(home, now) : 0;
  const line = presenceLine({ phase, replying, working, waiting });
  const coming = useMemo(() => (home ? comingUp(home, now) : []), [home, now]);
  const peek = useContext(AldoPeekContext);
  const detail = working.length > 0 || coming.length > 0;
  const face = (
    <>
      <AldoAvatar size={props.compact ? 30 : 36} mood={line.mood} />
      <span className="flex min-w-0 flex-col items-start leading-tight">
        <span className="font-semibold text-[15px]">Aldo</span>
        <span
          className={cn(
            "flex max-w-56 items-center gap-1 truncate text-xs sm:max-w-80",
            line.mood === "working" || line.mood === "thinking"
              ? "text-primary"
              : waiting > 0
                ? "text-warning-foreground"
                : "text-muted-foreground",
          )}
        >
          <span className="truncate">{line.text}</span>
          {detail ? <ChevronDownIcon aria-hidden className="size-3 shrink-0 opacity-70" /> : null}
        </span>
      </span>
    </>
  );
  if (!detail)
    return <div className="flex items-center gap-2.5 rounded-full py-1 ps-1 pe-3">{face}</div>;
  return (
    <Popover>
      <PopoverTrigger
        className="flex items-center gap-2.5 rounded-full py-1 ps-1 pe-3 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Aldo: ${line.text}`}
      >
        {face}
      </PopoverTrigger>
      <PopoverPopup width="md" padding="compact" align="center">
        <div className="flex flex-col gap-3 py-1">
          {working.length > 0 ? (
            <section className="flex flex-col gap-1">
              <h3 className="px-1 font-medium text-muted-foreground text-xs">Working now</h3>
              <ul className="flex flex-col">
                {working.map((c) => (
                  <li key={c.ref}>
                    <button
                      type="button"
                      className="flex w-full items-start gap-2.5 rounded-lg px-1.5 py-2 text-left hover:bg-accent/60"
                      onClick={() => peek?.(c.thread)}
                    >
                      <StateDot conversation={c} now={now} className="mt-1.5" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-sm">{c.title}</span>
                        {c.summary ? (
                          <span className="block truncate text-muted-foreground text-xs">
                            {c.summary}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-muted-foreground text-xs">
                        {stateSince(c, now)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {coming.length > 0 ? (
            <section className="flex flex-col gap-1">
              <h3 className="px-1 font-medium text-muted-foreground text-xs">Coming up</h3>
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
                      <span className="block truncate text-muted-foreground text-xs">
                        {item.detail}
                      </span>
                    </span>
                    <span className="shrink-0 text-muted-foreground text-xs">{item.when}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
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
