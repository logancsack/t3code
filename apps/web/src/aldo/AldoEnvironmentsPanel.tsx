import { settingsPrebuilds, settingsRepositories } from "./settingsData";
import { useSettingsResource } from "./settingsResource";
import { BoxesIcon, CheckIcon, LoaderCircleIcon, PlusIcon, TrashIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";

import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { cn } from "~/lib/utils";
import {
  aldoPrebuilds,
  type AldoEnvironmentService,
  type AldoPrebuiltEnvironment,
} from "./workspaceApi";
import { getAldoEnvironments, subscribeAldoEnvironments } from "./directory";

function ago(iso: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

const short = (ref: string) => ref.replace(/^(gitlab|bitbucket|azure):/, "");

function statusOf(env: AldoPrebuiltEnvironment): { label: string; tone: string } {
  const current = env.builds.find((b) => b.id === env.current_build);
  if (env.building) return { label: "Building…", tone: "text-muted-foreground" };
  if (current) {
    return {
      label: `Ready · built ${ago(current.finished_at)}${current.commit_sha ? ` at ${current.commit_sha.slice(0, 7)}` : ""}`,
      tone: "text-success-foreground",
    };
  }
  if (env.builds[0]?.status === "failed")
    return { label: "Last build failed", tone: "text-destructive-foreground" };
  return { label: "Not built", tone: "text-muted-foreground" };
}

type Draft = { id?: string; repos: string[]; install: string; services: AldoEnvironmentService[] };

function EnvironmentForm(props: {
  draft: Draft;
  repoOptions: string[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(props.draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await aldoPrebuilds.save({
        repos: draft.repos,
        install: draft.install,
        services: draft.services
          .filter((s) => s.name.trim() && s.command.trim())
          .map((s) => ({
            name: s.name.trim(),
            command: s.command.trim(),
            ...(s.cwd?.trim() ? { cwd: s.cwd.trim() } : {}),
          })),
      });
      props.onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const setService = (index: number, patch: Partial<AldoEnvironmentService>) =>
    setDraft({
      ...draft,
      services: draft.services.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    });

  return (
    <form onSubmit={submit} className="mx-3 space-y-3 rounded-xl border border-border p-3 sm:mx-4">
      {draft.id ? (
        <p className="text-sm font-medium">{draft.repos.map(short).join(" + ")}</p>
      ) : (
        <div className="space-y-1.5">
          <span className="text-muted-foreground text-xs">
            Repositories (the first picked is the main project)
          </span>
          {props.repoOptions.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              Connect a code host in Connections to pick repositories.
            </p>
          ) : (
            <div
              role="group"
              aria-label="Repositories"
              className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border/80 bg-background p-1.5"
            >
              {props.repoOptions.map((ref) => {
                const index = draft.repos.indexOf(ref);
                const selected = index !== -1;
                return (
                  <button
                    key={ref}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        repos: selected
                          ? draft.repos.filter((item) => item !== ref)
                          : [...draft.repos, ref],
                      })
                    }
                    className={cn(
                      "flex min-h-10 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8",
                      selected
                        ? "bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded border",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background",
                      )}
                    >
                      {selected ? <CheckIcon className="size-3" /> : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{short(ref)}</span>
                    {index === 0 ? (
                      <span className="shrink-0 text-muted-foreground text-xs">Main</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">
          Install command (run in the main repository after a fresh clone)
        </span>
        <Input
          className="font-mono text-xs"
          placeholder="pnpm install"
          value={draft.install}
          onChange={(e) => setDraft({ ...draft, install: e.currentTarget.value })}
        />
      </label>
      <div className="space-y-2">
        <span className="text-muted-foreground text-xs">
          Dev services (started with every thread, restarted after sleeps)
        </span>
        {draft.services.map((service, index) => (
          <div
            // oxlint-disable-next-line react/no-array-index-key -- Rows are edited in place and have no id.
            key={index}
            className="flex flex-col gap-2 rounded-lg border border-border/60 p-2 sm:grid sm:grid-cols-[7rem_1fr_7.5rem_auto] sm:items-center sm:gap-1.5 sm:border-0 sm:p-0"
          >
            <Input
              size="sm"
              placeholder="web"
              aria-label="Service name"
              value={service.name}
              onChange={(e) => setService(index, { name: e.currentTarget.value })}
            />
            <Input
              size="sm"
              className="font-mono text-xs"
              placeholder="pnpm dev --port 3000"
              aria-label="Service command"
              value={service.command}
              onChange={(e) => setService(index, { command: e.currentTarget.value })}
            />
            <Input
              size="sm"
              placeholder="Folder (optional)"
              aria-label="Working folder (optional)"
              value={service.cwd ?? ""}
              onChange={(e) => setService(index, { cwd: e.currentTarget.value })}
            />
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Remove service"
              className="self-end sm:self-auto"
              onClick={() =>
                setDraft({ ...draft, services: draft.services.filter((_, i) => i !== index) })
              }
            >
              <TrashIcon className="size-3.5" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() =>
            setDraft({ ...draft, services: [...draft.services, { name: "", command: "" }] })
          }
        >
          <PlusIcon className="size-3.5" /> Add a service
        </Button>
      </div>
      {error ? <p className="text-destructive-foreground text-xs">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy || draft.repos.length === 0}>
          {busy ? "Saving…" : "Save and build"}
        </Button>
      </div>
    </form>
  );
}

function EnvironmentRow(props: {
  env: AldoPrebuiltEnvironment;
  onChanged: () => void;
  onEdit: () => void;
}) {
  const { env } = props;
  const [showHistory, setShowHistory] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const status = statusOf(env);
  const act = (action: () => Promise<unknown>) => {
    setBusy(true);
    action()
      .catch(() => undefined)
      .finally(() => {
        setBusy(false);
        props.onChanged();
      });
  };
  const failed = env.builds[0]?.status === "failed" ? env.builds[0] : null;

  return (
    <SettingsRow
      title={env.repos.map(short).join(" + ")}
      description={
        <span className="space-y-0.5">
          <span className={`block ${status.tone}`}>
            {env.building ? <LoaderCircleIcon className="mr-1 inline size-3 animate-spin" /> : null}
            {status.label}
          </span>
          <span className="block font-mono text-[11px]">{env.install || "No install step"}</span>
          {env.services.length ? (
            <span className="block text-[11px]">
              Services: {env.services.map((s) => `${s.name} (${s.command})`).join(", ")}
            </span>
          ) : null}
        </span>
      }
      control={
        <span className="inline-flex flex-wrap justify-end gap-1">
          <Button size="compact" variant="ghost" onClick={props.onEdit}>
            Edit
          </Button>
          <Button
            size="compact"
            variant="ghost"
            disabled={busy || Boolean(env.building)}
            onClick={() => act(() => aldoPrebuilds.rebuild(env.id))}
          >
            Rebuild
          </Button>
          <Button size="compact" variant="ghost" onClick={() => setShowHistory((v) => !v)}>
            History
          </Button>
          {confirmingDelete ? (
            <>
              <Button size="compact" variant="ghost" onClick={() => setConfirmingDelete(false)}>
                Keep
              </Button>
              <Button
                size="compact"
                variant="destructive"
                disabled={busy}
                onClick={() => act(() => aldoPrebuilds.remove(env.id))}
              >
                Delete
              </Button>
            </>
          ) : (
            <Button size="compact" variant="ghost" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          )}
        </span>
      }
    >
      {failed && !env.building ? (
        <pre className="mb-2 max-h-40 overflow-auto rounded-lg bg-muted/60 p-2 text-[11px] whitespace-pre-wrap">
          {failed.log ?? "No log."}
        </pre>
      ) : null}
      {showHistory ? (
        <div className="mb-2 space-y-1">
          {env.builds.map((build) => (
            <div key={build.id} className="flex items-center gap-2 text-xs">
              <span className="w-20 text-muted-foreground">{ago(build.started_at)}</span>
              <span className="w-20">
                {build.id === env.current_build ? "current" : build.status}
              </span>
              <span className="font-mono text-muted-foreground">
                {build.commit_sha?.slice(0, 7) ?? ""}
              </span>
              {build.snapshot_id && build.id !== env.current_build && build.status !== "failed" ? (
                <Button
                  size="compact"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => act(() => aldoPrebuilds.use(env.id, build.id))}
                >
                  Use this build
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </SettingsRow>
  );
}

/** Settings → Code: prebuilt workspaces new threads start from. */
export function AldoEnvironmentsPanel() {
  const cached = useSettingsResource(settingsPrebuilds);
  const envs = cached.data ?? null;
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const threads = useSyncExternalStore(subscribeAldoEnvironments, getAldoEnvironments, () => null);
  // The connected accounts' repositories, so the first environment can come before any thread.
  const [accountRepos, setAccountRepos] = useState<ReadonlyArray<string>>([]);
  useEffect(() => {
    settingsRepositories
      .load()
      .then((repositories) => setAccountRepos(repositories.map((r) => r.nameWithOwner)))
      .catch(() => setAccountRepos([]));
  }, []);
  // (Aldo's own projects, `aldo:<slug>`, have nothing to prebuild.)
  const repoOptions = useMemo(
    () =>
      [...new Set([...(threads ?? []).flatMap((t) => t.repos ?? [t.repo]), ...accountRepos])]
        .filter((repo) => !repo.startsWith("aldo:"))
        .sort(),
    [threads, accountRepos],
  );

  const refresh = useCallback(() => {
    settingsPrebuilds
      .refresh()
      .then(() => setError(null))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);
  // Follow builds in progress.
  const building = envs?.some((e) => e.building) ?? false;
  useEffect(() => {
    if (!building) return;
    const timer = setInterval(refresh, 10_000);
    return () => clearInterval(timer);
  }, [building, refresh]);

  return (
    <SettingsSection
      id="aldo-environments"
      title="Environments"
      icon={<BoxesIcon className="size-4" />}
      headerAction={
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDraft({ repos: [], install: "", services: [] })}
        >
          <PlusIcon className="size-3.5" /> Add environment
        </Button>
      }
    >
      <p className="px-3 pt-3 pb-1 text-xs text-muted-foreground sm:px-4">
        Prebuilt environments install dependencies and start dev services ahead of time so new
        threads start ready. Rebuilt daily.
      </p>
      {error || cached.error ? (
        <p className="px-3 text-destructive-foreground text-sm sm:px-4">{error ?? cached.error}</p>
      ) : null}
      {draft ? (
        <EnvironmentForm
          key={draft.id ?? "new"}
          draft={draft}
          repoOptions={repoOptions}
          onCancel={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            refresh();
          }}
        />
      ) : null}
      {envs && envs.length === 0 && !draft ? (
        <p className="px-3 py-3 text-muted-foreground text-sm sm:px-4">
          No environments yet. A repository’s ready-to-go setup shows here once an agent saves one
          or you add one.
        </p>
      ) : null}
      {envs === null ? (
        <div className="space-y-2 px-3 py-3 sm:px-4">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-3.5 w-64" />
        </div>
      ) : null}
      {envs?.map((env) => (
        <EnvironmentRow
          key={env.id}
          env={env}
          onChanged={refresh}
          onEdit={() =>
            setDraft({
              id: env.id,
              repos: [...env.repos],
              install: env.install,
              services: [...env.services],
            })
          }
        />
      ))}
    </SettingsSection>
  );
}
