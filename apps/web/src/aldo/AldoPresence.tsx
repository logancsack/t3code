// Aldo as someone you message: its face (the orb, with eyes that blink, look
// up while it thinks, down while the user writes to it, and smile when
// something's done), its name, and a line beside it saying what it's at, like
// a messaging app's "typing…" (presence.logic.ts). Long work leaves it still;
// only Aldo's own thinking shimmers. Tapping it opens what's working now and
// what's coming up, each a tap from its thread: the detail behind the line,
// not a view of its own.

import { CalendarClockIcon, ChevronDownIcon, RepeatIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { cn } from "~/lib/utils";
import { StateDot, stateSince } from "./AldoLiveCard";
import { ThreadLink } from "./AldoHomeInbox";
import { useAldoAssistant } from "./assistantSession";
import type { AldoHome } from "./cloud";
import { aldoWaitingCount } from "./decisions.logic";
import { PLEASED_MS, useAldoFace } from "./face";
import { boardFor, deliveryLabel, dueIn } from "./home.logic";
import { faceMood, presenceLine, type AldoMood } from "./presence.logic";
import { useAldoReceipts } from "./receipts";
import "./presence.css";

/** Whether Aldo looks pleased now: for a moment after something's done. */
function usePleased(): boolean {
  const pleasedAt = useAldoFace((s) => s.pleasedAt);
  const [pleased, setPleased] = useState(false);
  useEffect(() => {
    if (pleasedAt === 0) return;
    const left = pleasedAt + PLEASED_MS - Date.now();
    if (left <= 0) return;
    const start = setTimeout(() => setPleased(true), 0);
    const stop = setTimeout(() => setPleased(false), left);
    return () => {
      clearTimeout(start);
      clearTimeout(stop);
    };
  }, [pleasedAt]);
  return pleased;
}

/**
 * Aldo's face. `mood` moves its eyes; while it speaks or hears, it swells a
 * little with the voice. `aware` faces (the top's, the empty page's) also
 * react to the user. Too small for eyes, it's the orb.
 */
export function AldoAvatar(props: {
  readonly size: number;
  readonly mood?: AldoMood;
  readonly aware?: boolean;
  readonly className?: string;
}) {
  const levels = useAldoAssistant((s) => s.levels);
  const reading = useAldoFace((s) => s.reading);
  const blinkAt = useAldoFace((s) => s.blinkAt);
  const pleased = usePleased();
  const base = props.mood ?? "idle";
  const mood = props.aware ? faceMood(base, { reading, pleased }) : base;
  const level = mood === "speaking" ? levels.aldo : mood === "listening" ? levels.mic : 0;
  const eyes = props.size >= 20;
  const eyeWidth = Math.max(3, Math.round(props.size * 0.12));
  const eyeHeight = Math.max(4, Math.round(props.size * 0.18));
  return (
    <span
      aria-hidden
      className={cn("relative inline-flex shrink-0 items-center justify-center", props.className)}
      style={{ width: props.size, height: props.size }}
      data-aldo-face=""
    >
      <span
        className={cn(
          "absolute inset-0 rounded-full bg-gradient-to-br from-primary to-primary/60 transition-transform duration-[80ms] ease-linear motion-reduce:transition-none",
          eyes && "shadow-[0_6px_16px_-6px] shadow-primary/45",
        )}
        style={{ transform: `scale(${1 + Math.min(1, level * 2.5) * 0.04})` }}
      />
      {eyes ? (
        <>
          <span className="absolute inset-[7%] rounded-full bg-gradient-to-b from-white/35 to-transparent to-55%" />
          <span
            data-aldo-eyes=""
            className="relative flex items-center"
            data-mood={mood}
            style={{
              gap: Math.round(props.size * 0.17),
              marginTop: -Math.round(props.size * 0.04),
            }}
          >
            {[0, 1].map((eye) => (
              <span
                // Each blink is new eyes: their one blink plays again.
                key={`${eye}:${props.aware ? blinkAt : 0}`}
                data-aldo-eye=""
                className="block rounded-full bg-white"
                style={{ width: eyeWidth, height: eyeHeight }}
              />
            ))}
          </span>
        </>
      ) : null}
    </span>
  );
}

/** The top of Aldo's conversation: its face, name and what it's at, opening what's working and coming up. */
export function AldoPresence(props: { readonly home: AldoHome | null; readonly now: number }) {
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
  const line = presenceLine({ phase, replying, working, waiting });
  const coming = useMemo(() => (home ? comingUp(home, now) : []), [home, now]);
  const detail = working.length > 0 || coming.length > 0;
  // Only Aldo's own thinking shimmers: it's short. Agents' long work says how long, still.
  const thinking = line.mood === "thinking";
  const face = (
    <>
      <AldoAvatar size={32} mood={line.mood} aware />
      <span className="flex min-w-0 flex-col items-start">
        <span className="font-semibold text-[15px] leading-5 tracking-[-0.01em]">Aldo</span>
        <span className="flex max-w-60 items-center gap-1.5 text-[12px] text-muted-foreground leading-[18px] sm:max-w-80">
          {waiting > 0 && !thinking ? (
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />
          ) : null}
          <span className="truncate" {...(thinking ? { "data-aldo-shimmer": "" } : {})}>
            {line.text}
          </span>
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
        {face}
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
        {face}
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
