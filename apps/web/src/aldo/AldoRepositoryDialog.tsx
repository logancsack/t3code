import type { SourceControlRepositorySummary } from "@t3tools/contracts";
import {
  CheckIcon,
  FolderGit2Icon,
  LoaderCircleIcon,
  LockIcon,
  RefreshCwIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

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
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { Textarea } from "../components/ui/textarea";
import { environmentCatalog } from "../connection/catalog";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { cn } from "../lib/utils";
import { useAtomCommand } from "../state/use-atom-command";
import { AldoAccountButton, useAldoAccounts } from "./AldoAccountsPanel";
import {
  isAldoCloud,
  listAldoRepositoryDirectory,
  type AldoAccount,
  type AldoHostKind,
} from "./cloud";
import { startAldoSandbox } from "./threads";

const OPEN_EVENT = "aldo:open-repository-picker";
const MAX_REPOS = 6;

type Mode = "new" | "existing";

const HOST_LABELS: Record<AldoHostKind, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
  azure: "Azure DevOps",
};
const HOST_KINDS = Object.keys(HOST_LABELS) as AldoHostKind[];

/** "gitlab:group/project" → GitLab; "owner/repo" → GitHub. */
function hostOf(ref: string): AldoHostKind {
  const match = /^(gitlab|bitbucket|azure):/.exec(ref);
  return (match?.[1] as AldoHostKind | undefined) ?? "github";
}

function pathOf(ref: string): string {
  return ref.replace(/^(gitlab|bitbucket|azure):/, "");
}

function shortName(ref: string): string {
  return pathOf(ref).split("/").at(-1) ?? ref;
}

/** Opens the start dialog: a new project, or a thread in existing repositories. */
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

/** "My Cool App" → "my-cool-app": a repository name. */
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
  const connectedHosts = HOST_KINDS.filter((kind) => accounts?.[kind]?.connected === true);
  const [mode, setMode] = useState<Mode>(props.initialMode);

  return (
    <DialogPopup className="flex max-h-[min(760px,calc(100dvh-2rem))] w-[min(680px,calc(100vw-2rem))] flex-col">
      <DialogHeader>
        <DialogTitle>{mode === "new" ? "New project" : "Start a thread"}</DialogTitle>
        <DialogDescription>
          {mode === "new"
            ? "Aldo creates the repository and a cloud sandbox for the project, then opens a thread in it. Tell the agent what to build."
            : "Pick one or more repositories. Each project gets one cloud sandbox, shared by all of its threads; a project you already have opens where it is."}
        </DialogDescription>
      </DialogHeader>
      {accounts === null ? (
        <DialogPanel>
          <LoaderCircleIcon className="mx-auto size-5 animate-spin text-muted-foreground" />
        </DialogPanel>
      ) : connectedHosts.length === 0 ? (
        <DialogPanel className="flex flex-col items-start gap-3">
          <p className="text-muted-foreground text-sm">
            Connect GitHub (or GitLab, Bitbucket or Azure DevOps in Settings → Source Control) so
            threads can clone your repositories and open pull requests.
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
                <FolderGit2Icon className="size-3.5" /> Existing repositories
              </ModeButton>
            </div>
          </div>
          {mode === "new" ? (
            <NewProjectForm hosts={connectedHosts} accounts={accounts} onDone={props.onDone} />
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

function NewProjectForm(props: {
  readonly hosts: ReadonlyArray<AldoHostKind>;
  readonly accounts: Partial<Record<AldoHostKind, AldoAccount>>;
  readonly onDone: () => void;
}) {
  const handleNewThread = useNewThreadHandler();
  const [host, setHost] = useState<AldoHostKind>(
    props.hosts.includes("github") ? "github" : props.hosts[0]!,
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = slugify(title);
  const account = props.accounts[host]?.account?.replace(/^@/, "") ?? null;

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!name || creating) return;
    setCreating(true);
    setError(null);
    try {
      const projectRef = await startAldoSandbox(
        {
          create: {
            host,
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
    <form onSubmit={create} className="flex flex-col gap-4 overflow-y-auto px-4 pb-5 sm:px-6">
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
              Creates <span className="font-mono">{name}</span> on {HOST_LABELS[host]}
              {account ? ` (${account})` : ""}
            </>
          ) : (
            "Becomes the repository name."
          )}
        </span>
      </label>
      {props.hosts.length > 1 ? (
        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-sm">Where</span>
          <Select value={host} onValueChange={(value) => setHost(value as AldoHostKind)}>
            <SelectTrigger className="h-9 text-sm" disabled={creating}>
              <SelectValue>{HOST_LABELS[host]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="start" alignItemWithTrigger={false}>
              {props.hosts.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {HOST_LABELS[kind]}
                  {props.accounts[kind]?.account ? ` · ${props.accounts[kind]!.account}` : ""}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </label>
      ) : null}
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
            {isPrivate ? "Only you (and people you invite) can see it." : "Anyone can see it."}
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

/** A typed repository ref or a pasted URL, if it looks like one. */
function typedRef(query: string): string | null {
  const text = query
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  if (/^(?:https?:\/\/)?(github\.com|gitlab\.com|bitbucket\.org|dev\.azure\.com)\//.test(text))
    return text;
  if (/^(gitlab|bitbucket|azure):[^\s]+\/[^\s]+$/.test(text) || /^[\w.-]+\/[\w.-]+$/.test(text))
    return text;
  return null;
}

function ExistingRepositoryPicker(props: { readonly onDone: () => void }) {
  const handleNewThread = useNewThreadHandler();
  const reconnect = useAtomCommand(environmentCatalog.retryNow, { reportFailure: false });
  const [repositories, setRepositories] = useState<ReadonlyArray<SourceControlRepositorySummary>>(
    [],
  );
  const [hostErrors, setHostErrors] = useState<ReadonlyArray<string>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlyArray<string>>([]);
  const [starting, setStarting] = useState(false);

  const load = useCallback(() => {
    setIsLoading(true);
    setError(null);
    listAldoRepositoryDirectory()
      .then((result) => {
        setRepositories(result.repositories);
        setHostErrors(result.errors);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = repositories.filter((r) => !r.isArchived);
    if (!q) return list.slice(0, 200);
    return list
      .filter((r) => `${r.nameWithOwner} ${r.description ?? ""}`.toLowerCase().includes(q))
      .slice(0, 200);
  }, [repositories, query]);

  const manual = typedRef(query);
  const manualIsListed = manual !== null && repositories.some((r) => r.nameWithOwner === manual);

  const toggle = (ref: string) => {
    setSelected((current) =>
      current.includes(ref)
        ? current.filter((r) => r !== ref)
        : current.length >= MAX_REPOS
          ? current
          : [...current, ref],
    );
  };

  const start = async () => {
    if (selected.length === 0) return;
    setStarting(true);
    setError(null);
    try {
      const label = selected.map(shortName).join(" + ");
      const projectRef = await startAldoSandbox({ repos: selected }, label, reconnect);
      props.onDone();
      await handleNewThread(projectRef);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStarting(false);
    }
  };

  return (
    <>
      <div className="flex gap-2 px-4 pb-2 sm:px-6">
        <Input
          autoFocus
          placeholder="Search your repositories, or paste owner/name or a URL"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={starting}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Refresh"
          onClick={load}
          disabled={isLoading}
        >
          <RefreshCwIcon className={cn("size-4", isLoading && "animate-spin")} />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 sm:px-4">
        {manual && !manualIsListed ? (
          <RepoRow
            refName={manual}
            title={`Use ${manual}`}
            subtitle="A repository by name or URL"
            host={hostOf(manual)}
            isPrivate={false}
            checked={selected.includes(manual)}
            onToggle={() => toggle(manual)}
          />
        ) : null}
        {isLoading && repositories.length === 0 ? (
          <div className="flex items-center gap-2 px-2 py-6 text-muted-foreground text-sm">
            <LoaderCircleIcon className="size-4 animate-spin" /> Loading your repositories…
          </div>
        ) : null}
        {visible.map((repo) => (
          <RepoRow
            key={repo.nameWithOwner}
            refName={repo.nameWithOwner}
            title={pathOf(repo.nameWithOwner)}
            subtitle={repo.description}
            host={hostOf(repo.nameWithOwner)}
            isPrivate={repo.isPrivate}
            checked={selected.includes(repo.nameWithOwner)}
            onToggle={() => toggle(repo.nameWithOwner)}
          />
        ))}
        {!isLoading && visible.length === 0 && !manual ? (
          <p className="px-2 py-6 text-muted-foreground text-sm">No repositories match.</p>
        ) : null}
        {hostErrors.map((message) => (
          <p key={message} className="px-2 py-1 text-destructive-foreground text-xs">
            {message}
          </p>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3 sm:px-6">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {selected.length === 0 ? (
            <span className="text-muted-foreground text-sm">
              Choose repositories (the first is the main project).
            </span>
          ) : (
            selected.map((ref, index) => (
              <span
                key={ref}
                className="inline-flex max-w-56 items-center gap-1 rounded-full border border-border bg-muted/50 py-0.5 pr-1 pl-2 text-xs"
              >
                <span className="truncate">
                  {shortName(ref)}
                  {index === 0 && selected.length > 1 ? (
                    <span className="text-muted-foreground"> · main</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${ref}`}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => toggle(ref)}
                >
                  <XIcon className="size-3" />
                </button>
              </span>
            ))
          )}
        </div>
        {error ? <p className="basis-full text-destructive-foreground text-sm">{error}</p> : null}
        {starting ? (
          <span className="flex items-center gap-2 text-muted-foreground text-sm">
            <LoaderCircleIcon className="size-4 animate-spin" /> Starting a sandbox…
          </span>
        ) : null}
        <Button type="button" variant="ghost" onClick={props.onDone}>
          {starting ? "Hide" : "Cancel"}
        </Button>
        <Button
          type="button"
          disabled={selected.length === 0 || starting}
          onClick={() => void start()}
        >
          Start thread
        </Button>
      </div>
    </>
  );
}

function RepoRow(props: {
  readonly refName: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly host: AldoHostKind;
  readonly isPrivate: boolean;
  readonly checked: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={props.checked}
      onClick={props.onToggle}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring",
        props.checked && "bg-accent/40",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
          props.checked ? "border-primary bg-primary text-primary-foreground" : "border-border",
        )}
      >
        {props.checked ? <CheckIcon className="size-3" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm">
          <span className="truncate font-medium">{props.title}</span>
          {props.isPrivate ? <LockIcon className="size-3 shrink-0 text-muted-foreground" /> : null}
        </span>
        {props.subtitle ? (
          <span className="line-clamp-1 text-muted-foreground text-xs">{props.subtitle}</span>
        ) : null}
      </span>
      <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase tracking-wide">
        {HOST_LABELS[props.host]}
      </span>
    </button>
  );
}
