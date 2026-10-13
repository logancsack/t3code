// "Teach this" in the Browser panel (teach.logic.ts): while it records, a bar
// says so, with how long it's run and Stop; once it stops, a short form asks
// what the agent should learn to do, in a sentence, and either teaches it (the
// panel puts the message in the conversation's message box) or discards it.

import { GraduationCapIcon, LoaderIcon, SquareIcon } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { aldoTeachClock, type AldoTeach } from "./teach.logic";

/** Under the toolbar while it records: "Recording · 2:14", and Stop. */
export function AldoTeachBar(props: {
  readonly teach: AldoTeach;
  /** Whether the machine's browser is reachable: Stop waits for it. */
  readonly connected: boolean;
  readonly onStop: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const clock = aldoTeachClock(Math.min(now, props.teach.endsAt) - props.teach.startedAt);
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-b border-destructive/30 bg-destructive/8 px-3 py-1.5 text-xs"
    >
      <span className="size-2 shrink-0 rounded-full bg-destructive" aria-hidden />
      {/* The clock ticks outside what's announced: "Recording" is said once. */}
      <span className="shrink-0 font-medium tabular-nums">
        Recording<span aria-hidden> · {clock}</span>
      </span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        Do the task here. Agents wait; passwords aren't recorded.
      </span>
      <Button
        type="button"
        size="compact"
        variant="outline"
        disabled={!props.connected}
        onClick={props.onStop}
      >
        <SquareIcon className="size-3 fill-current" /> Stop
      </Button>
    </div>
  );
}

/** Over the page once a recording stopped: what it's for, then Teach it or Discard. */
export function AldoTeachForm(props: {
  readonly teach: AldoTeach;
  /** Whether the machine's browser is reachable: Teach it and Discard wait for it. */
  readonly connected: boolean;
  /** Teaches it: rejects with what went wrong, which the form shows. */
  readonly onTeach: (sentence: string) => Promise<void>;
  readonly onDiscard: () => void;
}) {
  const [sentence, setSentence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { steps } = props.teach;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!sentence.trim() || busy || !props.connected) return;
    setBusy(true);
    setError(null);
    try {
      await props.onTeach(sentence);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      role="dialog"
      aria-label="Teach your agent"
      onSubmit={submit}
      className="dropdown-glass space-y-2 rounded-lg p-3 text-sm text-popover-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]"
    >
      <div className="flex items-start gap-2">
        <GraduationCapIcon className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {steps > 0 ? "What should your agent learn to do?" : "Nothing was recorded"}
          </p>
          <p className="text-xs text-muted-foreground">
            {steps > 0
              ? `${steps} ${steps === 1 ? "step" : "steps"} in ${aldoTeachClock(props.teach.elapsedMs)}. Passwords, codes and card details weren't recorded.`
              : "Teach this again, and do the task in the browser while it records."}
          </p>
        </div>
      </div>
      {steps > 0 ? (
        <Input
          autoFocus
          size="compact"
          aria-label="What your agent should learn to do"
          placeholder="e.g. Book a table on OpenTable for the time and party size I say"
          value={sentence}
          onChange={(e) => setSentence(e.currentTarget.value)}
        />
      ) : null}
      {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
      <div className="flex justify-end gap-1">
        <Button
          type="button"
          size="compact"
          variant="ghost"
          disabled={busy || !props.connected}
          onClick={props.onDiscard}
        >
          Discard
        </Button>
        {steps > 0 ? (
          <Button
            type="submit"
            size="compact"
            disabled={busy || !sentence.trim() || !props.connected}
          >
            {busy ? <LoaderIcon className="size-3.5 animate-spin" /> : null} Teach it
          </Button>
        ) : null}
      </div>
    </form>
  );
}
