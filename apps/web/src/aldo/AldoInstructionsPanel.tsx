import { LoaderCircleIcon, NotebookPenIcon, PlusIcon } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";

import { SettingsSection } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import { Textarea } from "../components/ui/textarea";
import {
  AldoApiError,
  aldoInstructions,
  getAldoEnvironments,
  listAldoRepositories,
  subscribeAldoEnvironments,
  type AldoInstructions,
} from "./cloud";

const EVERY_PROJECT = "*";

const HOSTS: Record<string, string> = {
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
  azure: "Azure DevOps",
};

/** A repository as the user knows it, with its host unless it's GitHub (the same path can be on two hosts). */
function projectLabel(ref: string): string {
  const [, host, path] = /^(gitlab|bitbucket|azure):(.*)$/.exec(ref) ?? [];
  return host && path ? `${path} (${HOSTS[host]})` : ref;
}

const PLACEHOLDERS = {
  every:
    "How you like agents to work everywhere, e.g.\n- Keep answers short.\n- Use pnpm, never npm.\n- Write commit messages in the imperative mood.",
  project:
    "What agents should know about this project, e.g.\n- Run pnpm test before opening a pull request.\n- Reuse the components in packages/ui.",
};

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

function InstructionsEditor(props: {
  scope: string;
  saved: AldoInstructions | null;
  onRemoved: () => void;
}) {
  const { scope } = props;
  // The saved version this edit started from. Saving sends its time, so a line
  // an agent remembered in the meantime isn't overwritten without the user seeing it.
  const [base, setBase] = useState(props.saved);
  const [draft, setDraft] = useState(props.saved?.text ?? "");
  // What's saved now, when it changed while the user was editing.
  const [changed, setChanged] = useState<{ text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const dirty = draft.trim() !== (base?.text ?? "");

  const save = async (text: string) => {
    setBusy(true);
    setError(null);
    try {
      const next =
        (await aldoInstructions.save(scope, text, base?.updated_at ?? null)).find(
          (i) => i.scope === scope,
        ) ?? null;
      setBase(next);
      // Keep what the user typed while the save was in flight.
      setDraft((current) => (current === text ? (next?.text ?? "") : current));
      setChanged(null);
      setConfirmingRemove(false);
      if (!next && scope !== EVERY_PROJECT) props.onRemoved();
    } catch (cause) {
      if (cause instanceof AldoApiError && cause.status === 409) {
        try {
          const latest = (await aldoInstructions.list()).find((i) => i.scope === scope) ?? null;
          setBase(latest);
          setChanged({ text: latest?.text ?? "" });
        } catch (again) {
          setError(messageOf(again));
        }
      } else {
        setError(messageOf(cause));
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save(draft);
  };

  const title = scope === EVERY_PROJECT ? "All projects" : projectLabel(scope);
  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl px-3 py-3 sm:px-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium tracking-[-0.005em]">{title}</h3>
        <span className="text-xs text-muted-foreground">
          {base ? `Saved ${ago(base.updated_at)}` : scope === EVERY_PROJECT ? "" : "Not saved yet"}
        </span>
      </div>
      <Textarea
        aria-label={`Instructions for ${scope === EVERY_PROJECT ? "all projects" : title}`}
        placeholder={scope === EVERY_PROJECT ? PLACEHOLDERS.every : PLACEHOLDERS.project}
        className="text-sm"
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
      />
      {changed ? (
        <div className="space-y-1 rounded-lg bg-muted/60 p-2 text-xs">
          <p>
            These changed while you were editing (an agent may have saved something you asked it to
            remember). This is what's saved now. Save again to replace it with your text, or copy
            what you need from it first.
          </p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-muted-foreground">
            {changed.text || "(Nothing: they were removed.)"}
          </pre>
        </div>
      ) : null}
      {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {scope === EVERY_PROJECT ? null : confirmingRemove ? (
          <>
            <Button
              type="button"
              size="compact"
              variant="ghost"
              onClick={() => setConfirmingRemove(false)}
            >
              Keep
            </Button>
            <Button
              type="button"
              size="compact"
              variant="destructive"
              disabled={busy}
              onClick={() => (base ? void save("") : props.onRemoved())}
            >
              Remove
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="compact"
            variant="ghost"
            onClick={() => (base ? setConfirmingRemove(true) : props.onRemoved())}
          >
            Remove
          </Button>
        )}
        <span className="flex-1" />
        {dirty ? (
          <Button
            type="button"
            size="compact"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setDraft(base?.text ?? "");
              setChanged(null);
            }}
          >
            Discard changes
          </Button>
        ) : null}
        <Button type="submit" size="compact" disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

type Entry = { scope: string; saved: AldoInstructions | null };

/** Settings → Instructions: what every agent is told, for all projects and for each one. */
export function AldoInstructionsPanel() {
  const [entries, setEntries] = useState<ReadonlyArray<Entry> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const threads = useSyncExternalStore(subscribeAldoEnvironments, getAldoEnvironments, () => null);
  // The connected accounts' repositories too, so a project can have instructions before its first thread.
  const [accountRepos, setAccountRepos] = useState<ReadonlyArray<string>>([]);

  useEffect(() => {
    aldoInstructions
      .list()
      .then((list) =>
        setEntries([
          { scope: EVERY_PROJECT, saved: list.find((i) => i.scope === EVERY_PROJECT) ?? null },
          ...list
            .filter((i) => i.scope !== EVERY_PROJECT)
            .map((i) => ({ scope: i.scope, saved: i })),
        ]),
      )
      .catch((cause: unknown) => {
        // An Aldo from before instructions.
        if (cause instanceof AldoApiError && cause.status === 404) setUnsupported(true);
        else setError(messageOf(cause));
      });
    listAldoRepositories()
      .then((repositories) => setAccountRepos(repositories.map((r) => r.nameWithOwner)))
      .catch(() => setAccountRepos([]));
  }, []);

  const addable = useMemo(() => {
    const present = new Set((entries ?? []).map((e) => e.scope));
    return [...new Set([...(threads ?? []).flatMap((t) => t.repos ?? [t.repo]), ...accountRepos])]
      .filter((repo) => !present.has(repo))
      .sort();
  }, [entries, threads, accountRepos]);

  return (
    <SettingsSection
      title="Instructions"
      icon={<NotebookPenIcon className="size-4" />}
      headerAction={
        entries ? (
          <Menu>
            <MenuTrigger
              disabled={addable.length === 0}
              render={<Button size="compact" variant="outline" />}
            >
              <PlusIcon className="size-3.5" /> Add a project
            </MenuTrigger>
            <MenuPopup align="end" className="max-w-80">
              {addable.map((repo) => (
                <MenuItem
                  key={repo}
                  onClick={() =>
                    setEntries((all) => [...(all ?? []), { scope: repo, saved: null }])
                  }
                >
                  {projectLabel(repo)}
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        ) : null
      }
    >
      <p className="px-3 text-sm text-muted-foreground sm:px-4">
        What every agent is told, like a CLAUDE.md or AGENTS.md of your own that stays out of your
        repositories: for all projects, or for one. When you ask an agent to remember something for
        later threads, it's saved here too. A thread picks up changes the next time its machine
        starts or wakes. A repository's own AGENTS.md or CLAUDE.md still applies.
      </p>
      {unsupported ? (
        <p className="px-3 text-sm text-muted-foreground sm:px-4">
          This Aldo server doesn't have instructions yet.
        </p>
      ) : null}
      {error ? <p className="px-3 text-sm text-destructive-foreground sm:px-4">{error}</p> : null}
      {entries === null && !unsupported && !error ? (
        <LoaderCircleIcon className="mx-4 size-4 animate-spin text-muted-foreground" />
      ) : null}
      {entries?.map((entry) => (
        <InstructionsEditor
          key={entry.scope}
          scope={entry.scope}
          saved={entry.saved}
          onRemoved={() => setEntries((all) => all?.filter((e) => e.scope !== entry.scope) ?? all)}
        />
      ))}
    </SettingsSection>
  );
}
