import { settingsSkills } from "./settingsData";
import { useSettingsResource } from "./settingsResource";
// Settings → Skills: how the user's agents do a kind of task (the steps, what
// to do and what to avoid, the user's feedback), saved to their account.
// Every agent in every thread sees what each skill is for and reads the rest
// when a task needs it. Agents save them when the user asks (`save_skill`);
// here the user reads, edits, adds and removes them.

import { GraduationCapIcon, LoaderCircleIcon, PlusIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { SettingsSection } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { AldoApiError, aldoSkills, type AldoSkill } from "./cloud";

/** Aldo's rule for a name (the Agent Skills format's). */
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const PLACEHOLDERS = {
  description:
    "Agents decide from this whether to read the rest, e.g. Cut podcast episodes into short clips for social media. Use when making clips, shorts or reels.",
  instructions:
    "The steps, what to do and what to avoid, examples, in Markdown, e.g.\n# Podcast clips\n- Start and end on a complete sentence.\n- Keep each clip under 60 seconds.\n- Avoid clips that need context from earlier in the episode.",
};

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

function SkillEditor(props: {
  /** Null for a new skill. */
  readonly saved: AldoSkill | null;
  readonly onSaved: (skills: AldoSkill[]) => void;
  readonly onClose: () => void;
}) {
  // The saved version this edit started from. Saving sends its time, so a
  // version an agent saved in the meantime isn't overwritten without the user seeing it.
  const [base, setBase] = useState(props.saved);
  const [name, setName] = useState(props.saved?.name ?? "");
  const [description, setDescription] = useState(props.saved?.description ?? "");
  const [instructions, setInstructions] = useState(props.saved?.instructions ?? "");
  // What's saved now, when it changed while the user was editing ("removed": it's gone).
  const [changed, setChanged] = useState<AldoSkill | "removed" | null>(null);
  // All the skills as they were then: the list shows them once this editor closes.
  const [latest, setLatest] = useState<AldoSkill[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const isNew = props.saved === null;
  const nameOk = name.length <= 64 && NAME.test(name);

  const close = () => {
    if (latest) props.onSaved(latest);
    props.onClose();
  };

  // Saves or removes; if the skill changed since `base`, shows what's saved now instead.
  const run = async (action: () => Promise<AldoSkill[]>) => {
    setBusy(true);
    setError(null);
    try {
      props.onSaved(await action());
      props.onClose();
    } catch (cause) {
      if (cause instanceof AldoApiError && cause.status === 409 && !isNew) {
        try {
          const skills = await aldoSkills.list();
          const now = skills.find((s) => s.name === name) ?? null;
          setLatest(skills);
          setBase(now);
          setChanged(now ?? "removed");
        } catch (again) {
          setError(messageOf(again));
        }
      } else {
        // A new skill whose name is taken says so.
        setError(messageOf(cause));
      }
    } finally {
      setBusy(false);
      setConfirmingRemove(false);
    }
  };
  const since = base?.updated_at ?? null;
  const save = () => run(() => aldoSkills.save({ name, description, instructions }, since));
  const remove = () => run(() => aldoSkills.remove(name, since));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save();
  };

  return (
    <li>
      <form onSubmit={submit} className="space-y-2 rounded-lg border border-border/60 px-3 py-3">
        {isNew ? (
          <label className="block space-y-1">
            <span className="text-muted-foreground text-xs">Name</span>
            <Input
              placeholder="e.g. podcast-clips"
              value={name}
              disabled={busy}
              // Spaces and capitals become what a name can hold.
              onChange={(e) => setName(e.currentTarget.value.toLowerCase().replace(/[\s_]+/g, "-"))}
            />
            {name && !nameOk ? (
              <span className="block text-muted-foreground text-xs">
                Lowercase letters, digits and single hyphens, 64 characters at most.
              </span>
            ) : null}
          </label>
        ) : (
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-medium font-mono text-sm">{name}</h3>
            <span className="text-muted-foreground text-xs">
              {base ? `Saved ${ago(base.updated_at)}` : "Not saved"}
            </span>
          </div>
        )}
        <label className="block space-y-1">
          <span className="text-muted-foreground text-xs">When to use it</span>
          <Textarea
            size="sm"
            placeholder={PLACEHOLDERS.description}
            className="text-sm"
            value={description}
            disabled={busy}
            onChange={(e) => setDescription(e.currentTarget.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-muted-foreground text-xs">Instructions</span>
          <Textarea
            placeholder={PLACEHOLDERS.instructions}
            className="font-mono text-xs"
            value={instructions}
            disabled={busy}
            onChange={(e) => setInstructions(e.currentTarget.value)}
          />
        </label>
        {changed ? (
          <div className="space-y-1 rounded-lg bg-muted/60 p-2 text-xs">
            {changed === "removed" ? (
              <p>This skill was removed while you were editing. Save to make it again.</p>
            ) : (
              <>
                <p>
                  This skill changed while you were editing (an agent may have saved something you
                  asked it to). This is what's saved now. Save again to replace it with yours, or
                  remove it, or copy what you need from it first.
                </p>
                <p className="text-muted-foreground">{changed.description}</p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-muted-foreground">
                  {changed.instructions}
                </pre>
              </>
            )}
          </div>
        ) : null}
        {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          {isNew ? null : confirmingRemove ? (
            <>
              <Button
                type="button"
                size="compact"
                variant="ghost"
                disabled={busy}
                onClick={() => setConfirmingRemove(false)}
              >
                Keep
              </Button>
              <Button
                type="button"
                size="compact"
                variant="destructive"
                disabled={busy}
                onClick={() => void remove()}
              >
                {busy ? "Removing…" : "Remove"}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="compact"
              variant="ghost"
              onClick={() => setConfirmingRemove(true)}
            >
              Remove
            </Button>
          )}
          <span className="flex-1" />
          <Button type="button" size="compact" variant="ghost" disabled={busy} onClick={close}>
            {isNew ? "Cancel" : "Close"}
          </Button>
          <Button
            type="submit"
            size="compact"
            disabled={busy || !nameOk || !description.trim() || !instructions.trim()}
          >
            {busy && !confirmingRemove ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </li>
  );
}

function SkillRow(props: { readonly skill: AldoSkill; readonly onOpen: () => void }) {
  const { skill } = props;
  return (
    <li className="rounded-lg border border-border/60 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium font-mono text-sm">{skill.name}</span>
        <span className="text-muted-foreground text-xs">Saved {ago(skill.updated_at)}</span>
      </div>
      <p className="mt-0.5 text-sm text-foreground/90">{skill.description}</p>
      <Button size="xs" variant="ghost" className="mt-1" onClick={props.onOpen}>
        Open
      </Button>
    </li>
  );
}

/** Settings → Skills: what the user's agents know how to do, the way the user wants it done. */
export function AldoSkillsPanel() {
  const cached = useSettingsResource(settingsSkills, true, false);
  const skills = cached.data ?? null;
  const setSkills = settingsSkills.set;
  const unsupported = cached.cause instanceof AldoApiError && cached.cause.status === 404;
  const error = unsupported ? null : cached.error;
  const [adding, setAdding] = useState(false);
  // The skills open for editing, by name (several at once keeps each draft).
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const close = (name: string) => setOpen((names) => new Set([...names].filter((n) => n !== name)));

  return (
    <SettingsSection
      title="Skills"
      icon={<GraduationCapIcon className="size-4" />}
      headerAction={
        skills ? (
          <Button
            size="compact"
            variant="outline"
            disabled={adding}
            onClick={() => setAdding(true)}
          >
            <PlusIcon className="size-3.5" /> New skill
          </Button>
        ) : null
      }
    >
      <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
        How your agents do a kind of task: the steps, what to do and what to avoid, your feedback.
        Every agent in every thread sees what each skill is for and reads the rest when a task needs
        it. Ask an agent to make one ("make a skill for podcast clips with this feedback") or to add
        to one, or write it here. Threads running now get changes at once, the others when their
        machine next starts or wakes.
      </p>
      {unsupported ? (
        <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
          This Aldo server doesn't have skills yet.
        </p>
      ) : null}
      {error ? <p className="px-3 text-sm text-destructive-foreground sm:px-4">{error}</p> : null}
      {skills === null && !unsupported && !error ? (
        <LoaderCircleIcon className="mx-4 size-4 animate-spin text-muted-foreground" />
      ) : null}
      {skills ? (
        <div className="px-3 sm:px-4">
          <ul className="space-y-2">
            {adding ? (
              <SkillEditor saved={null} onSaved={setSkills} onClose={() => setAdding(false)} />
            ) : null}
            {skills.map((skill) =>
              open.has(skill.name) ? (
                <SkillEditor
                  key={skill.name}
                  saved={skill}
                  onSaved={setSkills}
                  onClose={() => close(skill.name)}
                />
              ) : (
                <SkillRow
                  key={skill.name}
                  skill={skill}
                  onOpen={() => setOpen((names) => new Set([...names, skill.name]))}
                />
              ),
            )}
          </ul>
          {skills.length === 0 && !adding ? (
            <p className="text-muted-foreground text-sm">
              No skills yet. When you show an agent how you like something done, it can save a skill
              here, and every agent uses it.
            </p>
          ) : null}
        </div>
      ) : null}
    </SettingsSection>
  );
}
