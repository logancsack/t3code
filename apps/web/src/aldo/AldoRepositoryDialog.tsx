import type { SourceControlRepositorySummary } from "@t3tools/contracts";
import { FolderGit2Icon, LoaderCircleIcon, SparklesIcon } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";

import { GitHubRepositoryBrowser } from "../components/GitHubRepositoryBrowser";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { Textarea } from "../components/ui/textarea";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { cn } from "../lib/utils";
import { AldoAccountButton, useAldoAccounts } from "./AldoAccountsPanel";
import { isAldoCloud, listAldoRepositories } from "./cloud";
import { startAldoSandbox } from "./threads";

const OPEN_EVENT = "aldo:open-repository-picker";

type Mode = "new" | "existing";

/** Opens the start dialog: a new project, or a thread in an existing repository. */
export function openAldoRepositoryPicker(mode: Mode = "existing"): void {
  window.dispatchEvent(new CustomEvent<Mode>(OPEN_EVENT, { detail: mode }));
}

export function AldoRepositoryDialog() {
  const [open, setOpen] = useState<Mode | null>(null);
  useEffect(() => {
    if (!isAldoCloud) return;
    const handleOpen = (event: Event) => setOpen((event as CustomEvent<Mode>).detail ?? "existing");
    window.addEventListener(OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_EVENT, handleOpen);
  }, []);
  if (!isAldoCloud) return null;
  return (
    <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
      {open ? <StartPicker initialMode={open} onDone={() => setOpen(null)} /> : null}
    </Dialog>
  );
}

/** "My Cool App" → "my-cool-app": a GitHub repository name. */
function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100);
}

function StartPicker(props: { readonly initialMode: Mode; readonly onDone: () => void }) {
  const { accounts, refresh: refreshAccounts } = useAldoAccounts();
  const githubConnected = accounts?.github.connected === true;
  const [mode, setMode] = useState<Mode>(props.initialMode);

  return (
    <DialogPopup className="flex max-h-[min(720px,calc(100dvh-2rem))] w-[min(640px,calc(100vw-2rem))] flex-col">
      <DialogHeader>
        <DialogTitle>{mode === "new" ? "New project" : "Start a thread"}</DialogTitle>
        <DialogDescription>
          {mode === "new"
            ? "Aldo creates a GitHub repository for it and opens a thread in its own sandbox. Tell the agent what to build."
            : "Pick a repository. The thread gets its own sandbox with a fresh clone on a new branch."}
        </DialogDescription>
      </DialogHeader>
      {accounts === null ? (
        <DialogPanel>
          <LoaderCircleIcon className="mx-auto size-5 animate-spin text-muted-foreground" />
        </DialogPanel>
      ) : !githubConnected ? (
        <DialogPanel className="flex flex-col items-start gap-3">
          <p className="text-muted-foreground text-sm">
            Connect GitHub so Aldo can create and clone your repositories and open pull requests.
          </p>
          <AldoAccountButton
            kind="github"
            account={accounts.github}
            onConnected={refreshAccounts}
            triggerLabel="Connect GitHub"
          />
        </DialogPanel>
      ) : (
        <>
          <div className="px-4 pb-3 sm:px-6">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/60 p-1" role="tablist">
              <ModeButton active={mode === "new"} onClick={() => setMode("new")}>
                <SparklesIcon className="size-3.5" /> New project
              </ModeButton>
              <ModeButton active={mode === "existing"} onClick={() => setMode("existing")}>
                <FolderGit2Icon className="size-3.5" /> Existing repository
              </ModeButton>
            </div>
          </div>
          {mode === "new" ? (
            <NewProjectForm owner={accounts.github.account} onDone={props.onDone} />
          ) : (
            <ExistingRepositoryPicker onDone={props.onDone} />
          )}
        </>
      )}
    </DialogPopup>
  );
}

function ModeButton(props: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.active}
      onClick={props.onClick}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-md text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        props.active
          ? "bg-background font-medium text-foreground shadow-xs"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {props.children}
    </button>
  );
}

function NewProjectForm(props: { readonly owner: string | null; readonly onDone: () => void }) {
  const handleNewThread = useNewThreadHandler();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = slugify(title);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!name || creating) return;
    setCreating(true);
    setError(null);
    try {
      const projectRef = await startAldoSandbox(
        {
          create: {
            name,
            isPrivate,
            ...(description.trim() ? { description: description.trim() } : {}),
          },
        },
        name,
      );
      props.onDone();
      await handleNewThread(projectRef);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setCreating(false);
    }
  };

  return (
    <form onSubmit={create} className="flex flex-col gap-4 px-4 pb-5 sm:px-6">
      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-sm">Name</span>
        <Input
          autoFocus
          placeholder="e.g. Recipe planner"
          value={title}
          disabled={creating}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        <span className="text-muted-foreground text-xs">
          {name ? (
            <>
              Creates{" "}
              <span className="font-mono">
                github.com/{props.owner?.replace(/^@/, "") || "you"}/{name}
              </span>
            </>
          ) : (
            "Becomes the repository name on GitHub."
          )}
        </span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-sm">
          Description <span className="font-normal text-muted-foreground">(optional)</span>
        </span>
        <Textarea
          placeholder="What is it? It goes on the repository and in its README."
          className="min-h-16"
          value={description}
          disabled={creating}
          onChange={(event) => setDescription(event.currentTarget.value)}
        />
      </label>
      <label className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
        <span className="flex flex-col">
          <span className="font-medium text-sm">Private repository</span>
          <span className="text-muted-foreground text-xs">
            {isPrivate
              ? "Only you (and people you invite) can see it."
              : "Anyone on GitHub can see it."}
          </span>
        </span>
        <Switch
          checked={isPrivate}
          disabled={creating}
          onCheckedChange={(checked) => setIsPrivate(checked)}
        />
      </label>
      {error ? <p className="text-destructive-foreground text-sm">{error}</p> : null}
      <div className="flex items-center justify-end gap-2">
        {creating ? (
          <span className="mr-auto flex items-center gap-2 text-muted-foreground text-sm">
            <LoaderCircleIcon className="size-4 animate-spin" /> Creating {name}…
          </span>
        ) : null}
        <Button type="button" variant="ghost" onClick={props.onDone}>
          {creating ? "Hide" : "Cancel"}
        </Button>
        <Button type="submit" disabled={!name || creating}>
          Create project
        </Button>
      </div>
    </form>
  );
}

function ExistingRepositoryPicker(props: { readonly onDone: () => void }) {
  const handleNewThread = useNewThreadHandler();
  const [repositories, setRepositories] = useState<ReadonlyArray<SourceControlRepositorySummary>>(
    [],
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [starting, setStarting] = useState<string | null>(null);

  const load = useCallback(() => {
    setIsLoading(true);
    setError(null);
    listAldoRepositories()
      .then(setRepositories)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const start = async (nameWithOwner: string) => {
    setStarting(nameWithOwner);
    setError(null);
    try {
      const projectRef = await startAldoSandbox({ repo: nameWithOwner }, nameWithOwner);
      props.onDone();
      await handleNewThread(projectRef);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStarting(null);
    }
  };

  return (
    <>
      <div className="px-4 pb-2 sm:px-6">
        <Input
          id="aldo-repository-search"
          autoFocus
          placeholder="Search your repositories, or type owner/name"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={starting !== null}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <GitHubRepositoryBrowser
          repositories={repositories}
          query={query}
          isLoading={isLoading}
          error={error}
          activeRepository={starting}
          projectForRepository={() => null}
          onClone={(repository) => void start(repository.nameWithOwner)}
          onSync={() => undefined}
          onRefresh={load}
          onManualLookup={() => void start(query.trim())}
        />
      </div>
      {starting ? (
        <div className="flex items-center gap-2 border-t px-6 py-3 text-muted-foreground text-sm">
          <LoaderCircleIcon className="size-4 animate-spin" />
          Starting a sandbox for {starting}…
          <Button className="ml-auto" size="sm" variant="ghost" onClick={props.onDone}>
            Hide
          </Button>
        </div>
      ) : null}
    </>
  );
}
