import { settingsInstructions, settingsRepositories } from "./settingsData";
import { useSettingsResource } from "./settingsResource";
import { HomeIcon, NotebookPenIcon, PlusIcon } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";

import { SettingsSection } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import { Skeleton } from "../components/ui/skeleton";
import { Textarea } from "../components/ui/textarea";
import { AldoApiError } from "./api";
import { aldoInstructions, type AldoInstructions } from "./accountApi";
import { AldoInterestChips } from "./AldoInterestChips";
import { useAldoDeveloperTools } from "./developerTools";
import { getAldoEnvironments, subscribeAldoEnvironments } from "./directory";
import { saveAldoOnboarding, useAldoOnboardingState } from "./onboarding";

const EVERY_PROJECT = "*";

const HOSTS: Record<string, string> = {
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
  azure: "Azure DevOps",
  aldo: "Aldo project",
};

/** A repository as the user knows it, with its host unless it's GitHub (the same path can be on two hosts). */
function projectLabel(ref: string): string {
  const [, host, path] = /^(gitlab|bitbucket|azure|aldo):(.*)$/.exec(ref) ?? [];
  return host && path ? `${path} (${HOSTS[host]})` : ref;
}

function placeholderFor(every: boolean, developer: boolean): string {
  if (every) {
    return developer
      ? "Rules every agent follows, e.g.\n- Lead with the answer.\n- Write in British English.\n- Use pnpm, never npm."
      : "Rules every agent follows, e.g.\n- Lead with the takeaway.\n- Write in plain, direct English.\n- Keep emails under 150 words.";
  }
  return developer
    ? "Notes for this project, e.g.\n- Run tests before opening a pull request.\n- Reuse components in packages/ui."
    : "Notes for this project, e.g.\n- Keep decks on-brand and concise.\n- Address clients by first name.";
}

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
  developer: boolean;
  onRemoved: () => void;
}) {
  const { scope } = props;
  // The saved version this edit started from. Saving sends its time, so a line
  // an agent remembered in the meantime isn't overwritten without the user seeing it.
  const [base, setBase] = useState(props.saved);
  const [draft, setDraft] = useState(props.saved?.text ?? "");
  const [shown, setShown] = useState(props.saved);
  // Refresh clean editors; an edit keeps its original version for the conflict check.
  if (shown !== props.saved) {
    setShown(props.saved);
    if (draft === (base?.text ?? "")) {
      setBase(props.saved);
      setDraft(props.saved?.text ?? "");
    }
  }
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
      const list = await aldoInstructions.save(scope, text, base?.updated_at ?? null);
      settingsInstructions.set(list);
      const next = list.find((i) => i.scope === scope) ?? null;
      setBase(next);
      // Keep what the user typed while the save was in flight.
      setDraft((current) => (current === text ? (next?.text ?? "") : current));
      setChanged(null);
      setConfirmingRemove(false);
      if (!next && scope !== EVERY_PROJECT) props.onRemoved();
    } catch (cause) {
      if (cause instanceof AldoApiError && cause.status === 409) {
        try {
          const latest =
            (await settingsInstructions.refresh()).find((i) => i.scope === scope) ?? null;
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
        placeholder={placeholderFor(scope === EVERY_PROJECT, props.developer)}
        className="text-base sm:text-sm"
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

/** What you hand Aldo (moved from General into About you). */
function WorkFocusSection() {
  const onboarding = useAldoOnboardingState();
  const [failed, setFailed] = useState(false);
  if (!onboarding) return null;
  return (
    <SettingsSection title="Your work focus" icon={<HomeIcon className="size-4" />}>
      <div id="aldo-interests" className="space-y-2.5 px-3 py-3 sm:px-4">
        <p className="text-muted-foreground text-xs">
          Shapes the starter ideas on Home. You can also turn Developer tools on or off anytime in
          Preferences.
        </p>
        <AldoInterestChips
          label="Your work focus"
          value={onboarding.interests ?? []}
          onChange={(next) => {
            setFailed(false);
            void saveAldoOnboarding(next, { revert: true }).then((saved) => setFailed(!saved));
          }}
        />
        {failed ? (
          <p role="alert" className="text-destructive-foreground text-xs">
            Couldn’t save that. Try again.
          </p>
        ) : null}
      </div>
    </SettingsSection>
  );
}

/** Settings → About you → Instructions: standing rules every agent reads. */
export function AldoInstructionsPanel() {
  const developer = useAldoDeveloperTools();
  const cached = useSettingsResource(settingsInstructions, true, false);
  const unsupported = cached.cause instanceof AldoApiError && cached.cause.status === 404;
  const error = unsupported ? null : cached.error;
  const [added, setAdded] = useState<ReadonlyArray<string>>([]);
  const entries: ReadonlyArray<Entry> | null = cached.data
    ? [
        { scope: EVERY_PROJECT, saved: cached.data.find((i) => i.scope === EVERY_PROJECT) ?? null },
        ...cached.data
          .filter((i) => i.scope !== EVERY_PROJECT)
          .map((i) => ({ scope: i.scope, saved: i })),
        ...added
          .filter((scope) => !cached.data?.some((i) => i.scope === scope))
          .map((scope) => ({ scope, saved: null })),
      ]
    : null;
  const threads = useSyncExternalStore(subscribeAldoEnvironments, getAldoEnvironments, () => null);
  const [accountRepos, setAccountRepos] = useState<ReadonlyArray<string>>([]);

  useEffect(() => {
    settingsRepositories
      .load()
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
    <>
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
                  <MenuItem key={repo} onClick={() => setAdded((all) => [...all, repo])}>
                    {projectLabel(repo)}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          ) : null
        }
      >
        <p className="px-3 pt-3 pb-1 text-xs text-muted-foreground sm:px-4">
          Standing rules every agent reads before starting. Changes apply the next time a thread’s
          computer starts or wakes.
        </p>
        {unsupported ? (
          <p className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
            This Aldo server doesn’t support instructions yet.
          </p>
        ) : null}
        {error ? <p className="px-3 text-sm text-destructive-foreground sm:px-4">{error}</p> : null}
        {entries === null && !unsupported && !error ? (
          <div className="space-y-2 px-3 py-3 sm:px-4" aria-busy="true">
            <Skeleton className="h-4 w-28 rounded" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ) : null}
        {entries?.map((entry) => (
          <InstructionsEditor
            key={entry.scope}
            scope={entry.scope}
            saved={entry.saved}
            developer={developer}
            onRemoved={() => setAdded((all) => all.filter((scope) => scope !== entry.scope))}
          />
        ))}
      </SettingsSection>
      <WorkFocusSection />
    </>
  );
}
