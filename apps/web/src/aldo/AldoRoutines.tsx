// The home screen's routines: what the user has Aldo do on a schedule (in
// their time zone) or when a webhook is called, each in a thread of its own.
// Each one can be run now, paused, opened at its thread, or removed, and a new
// one set up here (or by telling Aldo). Shown only when Aldo reports routines.

import {
  CopyIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RepeatIcon,
  Trash2Icon,
  WebhookIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { Textarea } from "../components/ui/textarea";
import { toastManager } from "../components/ui/toast";
import { requestConfirmDialog } from "../confirmDialog";
import { cn } from "~/lib/utils";
import { Section } from "./AldoHomeBoard";
import { ThreadLink } from "./AldoHomeInbox";
import {
  createAldoRoutine,
  deleteAldoRoutine,
  requestAldoDirectoryRefresh,
  runAldoRoutine,
  updateAldoRoutine,
  type AldoRoutine,
} from "./cloud";
import { dueIn } from "./home.logic";
import {
  ALDO_WEEKDAYS,
  EMPTY_ROUTINE_FORM,
  ROUTINE_FREQUENCIES,
  routineLastResult,
  routineRequest,
  routineStatus,
  type RoutineForm,
  type RoutineFrequency,
} from "./routines.logic";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function RoutinesSection(props: {
  readonly routines: ReadonlyArray<AldoRoutine>;
  readonly now: number;
  readonly onChanged: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (routine: AldoRoutine, what: "run" | "pause" | "resume" | "delete") => {
    if (what === "delete") {
      const confirmed = await (requestConfirmDialog(
        `Remove the routine "${routine.title}"? Its thread stays.`,
        { variant: "destructive" },
      ) ?? Promise.resolve(true));
      if (!confirmed) return;
    }
    setBusy(routine.id);
    try {
      if (what === "run") {
        const result = await runAldoRoutine(routine.id);
        const failed = result.startsWith("failed");
        toastManager.add({
          type: failed ? "error" : "success",
          title: failed
            ? `"${routine.title}" couldn't run`
            : result.startsWith("skipped")
              ? "Not run"
              : `Running "${routine.title}"`,
          description: result.replace(/^(failed|skipped): /, ""),
        });
        // Its first run makes its thread: list it now, so "Open its thread" goes somewhere.
        requestAldoDirectoryRefresh();
      } else if (what === "delete") {
        await deleteAldoRoutine(routine.id);
      } else {
        await updateAldoRoutine(routine.id, { enabled: what === "resume" });
      }
      props.onChanged();
    } catch (cause) {
      toastManager.add({ type: "error", title: "Couldn't do that", description: messageOf(cause) });
    } finally {
      setBusy(null);
    }
  };

  const copyWebhook = (url: string) => {
    void navigator.clipboard
      .writeText(url)
      .then(() =>
        toastManager.add({
          type: "success",
          title: "Webhook URL copied",
          description: "Anything that POSTs to it runs the routine; keep it private.",
        }),
      )
      .catch(() =>
        toastManager.add({ type: "error", title: "Couldn't copy it", description: url }),
      );
  };

  return (
    <Section
      title="Routines"
      {...(props.routines.length > 0 ? { count: props.routines.length } : {})}
      action={
        <button
          type="button"
          className="inline-flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
          onClick={() => setCreating(true)}
        >
          <PlusIcon className="size-3" /> New routine
        </button>
      }
    >
      {props.routines.length === 0 ? (
        <p className="rounded-xl border border-border/60 border-dashed px-4 py-3 text-muted-foreground text-xs">
          Things to have done regularly, or whenever something happens: a morning briefing from your
          inbox and calendar, a weekly check on your subscriptions, triaging what a form sends. Each
          runs in a thread of its own, and you hear when it's done. Tell Aldo, or set one up here.
        </p>
      ) : (
        <ul className="rounded-xl border border-border/60 bg-card/30 p-1.5">
          {props.routines.map((routine) => {
            const last = routineLastResult(routine);
            return (
              <li
                key={routine.id}
                className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-accent/40"
              >
                <RepeatIcon
                  className={cn(
                    "mt-1 size-3.5 shrink-0",
                    routine.enabled ? "text-muted-foreground" : "text-muted-foreground/50",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                    <span
                      className={cn("font-medium", !routine.enabled && "text-muted-foreground")}
                    >
                      {routine.title}
                    </span>
                    <Badge variant={routine.enabled ? "outline" : "warning"} size="sm">
                      {routineStatus(routine, (iso) => dueIn(iso, props.now))}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate text-muted-foreground text-xs">{routine.when}</p>
                  {last ? (
                    <p
                      className={cn(
                        "mt-0.5 line-clamp-1 text-xs",
                        last.failed ? "text-destructive-foreground" : "text-muted-foreground",
                      )}
                    >
                      Last run: {last.text}
                    </p>
                  ) : null}
                  {routine.thread ? (
                    <ThreadLink
                      target={routine.thread}
                      className="mt-0.5 block truncate text-muted-foreground text-xs hover:text-foreground"
                    >
                      Open its thread
                    </ThreadLink>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  {routine.webhook ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Copy webhook URL"
                      title="Copy webhook URL"
                      onClick={() => copyWebhook(routine.webhook!)}
                    >
                      <CopyIcon className="size-3.5" />
                    </Button>
                  ) : null}
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={routine.enabled ? "Pause" : "Resume"}
                    title={routine.enabled ? "Pause" : "Resume"}
                    disabled={busy !== null}
                    onClick={() => void act(routine, routine.enabled ? "pause" : "resume")}
                  >
                    {routine.enabled ? (
                      <PauseIcon className="size-3.5" />
                    ) : (
                      <PlayIcon className="size-3.5" />
                    )}
                  </Button>
                  <Button
                    size="compact"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => void act(routine, "run")}
                  >
                    Run now
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Remove"
                    title="Remove"
                    disabled={busy !== null}
                    onClick={() => void act(routine, "delete")}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={creating} onOpenChange={(open) => !open && setCreating(false)}>
        {creating ? (
          <NewRoutine
            onDone={(created) => {
              setCreating(false);
              if (created) props.onChanged();
            }}
          />
        ) : null}
      </Dialog>
    </Section>
  );
}

function NewRoutine(props: { readonly onDone: (created: boolean) => void }) {
  const [form, setForm] = useState<RoutineForm>(EMPTY_ROUTINE_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<RoutineForm>) => setForm((current) => ({ ...current, ...patch }));
  const request = routineRequest(form);
  const timed = form.frequency !== "hours" && form.frequency !== "webhook";

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!request.ok || saving) return;
    setSaving(true);
    setError(null);
    try {
      const routine = await createAldoRoutine({
        title: request.title,
        instruction: request.instruction,
        schedule: request.schedule,
        webhook: request.webhook,
      });
      toastManager.add({
        type: "success",
        title: `"${routine.title}" is set up`,
        description: routine.nextRunAt
          ? `It runs ${routine.when.charAt(0).toLowerCase()}${routine.when.slice(1)}.`
          : "Copy its webhook URL from the list to use it.",
      });
      props.onDone(true);
    } catch (cause) {
      setError(messageOf(cause));
      setSaving(false);
    }
  };

  return (
    <DialogPopup className="flex max-h-[min(760px,calc(100dvh-2rem))] w-[min(560px,calc(100vw-2rem))] flex-col">
      <DialogHeader>
        <DialogTitle>New routine</DialogTitle>
        <DialogDescription>
          Its instruction runs in a thread of its own, on a cloud computer with a browser and the
          accounts you connected, at your local time. You get a notification when each run is done.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={save} className="flex flex-col gap-4 overflow-y-auto px-4 pb-5 sm:px-6">
        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-sm">Name</span>
          <Input
            autoFocus
            placeholder="e.g. Morning briefing"
            value={form.title}
            disabled={saving}
            onChange={(event) => set({ title: event.currentTarget.value })}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-sm">What it does</span>
          <Textarea
            className="min-h-24"
            placeholder="e.g. Read my unread email and today's calendar. Tell me what needs a reply and what's on today, and draft replies for the simple ones."
            value={form.instruction}
            disabled={saving}
            onChange={(event) => set({ instruction: event.currentTarget.value })}
          />
          <span className="text-muted-foreground text-xs">
            Each run knows only this and its thread, so say it all. It drafts rather than sends,
            buys or deletes unless you say to.
          </span>
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-48 flex-1 flex-col gap-1.5">
            <span className="font-medium text-sm">When</span>
            <Select
              value={form.frequency}
              onValueChange={(value) => set({ frequency: value as RoutineFrequency })}
            >
              <SelectTrigger className="h-9 text-sm" disabled={saving}>
                <SelectValue>
                  {ROUTINE_FREQUENCIES.find((f) => f.value === form.frequency)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="start" alignItemWithTrigger={false}>
                {ROUTINE_FREQUENCIES.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </label>
          {form.frequency === "month" ? (
            <label className="flex w-24 flex-col gap-1.5">
              <span className="font-medium text-sm">Day</span>
              <Input
                type="number"
                min={1}
                max={31}
                value={String(form.dayOfMonth)}
                disabled={saving}
                onChange={(event) => set({ dayOfMonth: Number(event.currentTarget.value) })}
              />
            </label>
          ) : null}
          {form.frequency === "hours" ? (
            <label className="flex w-28 flex-col gap-1.5">
              <span className="font-medium text-sm">Hours apart</span>
              <Input
                type="number"
                min={1}
                max={24}
                value={String(form.hours)}
                disabled={saving}
                onChange={(event) => set({ hours: Number(event.currentTarget.value) })}
              />
            </label>
          ) : null}
          {timed ? (
            <label className="flex w-32 flex-col gap-1.5">
              <span className="font-medium text-sm">At</span>
              <Input
                type="time"
                value={form.time}
                disabled={saving}
                onChange={(event) => set({ time: event.currentTarget.value })}
              />
            </label>
          ) : null}
        </div>
        {form.frequency === "week" ? (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Days">
            {ALDO_WEEKDAYS.map(({ day, short }) => {
              const on = form.days.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  disabled={saving}
                  onClick={() =>
                    set({ days: on ? form.days.filter((d) => d !== day) : [...form.days, day] })
                  }
                  className={cn(
                    "h-8 rounded-md border px-2.5 text-xs transition-colors",
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {short}
                </button>
              );
            })}
          </div>
        ) : null}
        {form.frequency !== "webhook" ? (
          <label className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
            <span className="flex items-start gap-2">
              <WebhookIcon className="mt-0.5 size-4 text-muted-foreground" />
              <span className="flex flex-col">
                <span className="font-medium text-sm">Also run it from a webhook</span>
                <span className="text-muted-foreground text-xs">
                  A private URL that runs it with whatever is POSTed to it: an alert, a form,
                  another app.
                </span>
              </span>
            </span>
            <Switch
              checked={form.webhook}
              disabled={saving}
              onCheckedChange={(checked) => set({ webhook: checked })}
            />
          </label>
        ) : null}
        {error ? <p className="text-destructive-foreground text-sm">{error}</p> : null}
        <div className="flex items-center justify-end gap-2">
          {!request.ok && (form.title || form.instruction) ? (
            <span className="mr-auto text-muted-foreground text-xs">{request.reason}</span>
          ) : null}
          <Button
            disabled={saving}
            type="button"
            variant="ghost"
            onClick={() => props.onDone(false)}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!request.ok || saving}>
            Set it up
          </Button>
        </div>
      </form>
    </DialogPopup>
  );
}
