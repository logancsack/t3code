import { BoxesIcon, LoaderCircleIcon, PlusIcon, TrashIcon } from "lucide-react";
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
import {
  aldoPrebuilds,
  getAldoEnvironments,
  subscribeAldoEnvironments,
  type AldoEnvironmentService,
  type AldoPrebuiltEnvironment,
} from "./cloud";

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
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">
            Repositories (the first is the main project)
          </span>
          <select
            multiple
            className="min-h-24 rounded-md border border-border bg-background p-1 text-sm"
            value={draft.repos}
            onChange={(e) =>
              setDraft({
                ...draft,
                repos: [...e.currentTarget.selectedOptions].map((o) => o.value),
              })
            }
          >
            {props.repoOptions.map((ref) => (
              <option key={ref} value={ref}>
                {short(ref)}
              </option>
            ))}
          </select>
        </label>
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
          <div key={index} className="grid grid-cols-[6rem_1fr_6rem_auto] gap-1.5">
            <Input
              size="compact"
              placeholder="web"
              value={service.name}
              onChange={(e) => setService(index, { name: e.currentTarget.value })}
            />
            <Input
              size="compact"
              className="font-mono text-xs"
              placeholder="pnpm dev --port 3000"
              value={service.command}
              onChange={(e) => setService(index, { command: e.currentTarget.value })}
            />
            <Input
              size="compact"
              placeholder="cwd (opt.)"
              value={service.cwd ?? ""}
              onChange={(e) => setService(index, { cwd: e.currentTarget.value })}
            />
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Remove service"
              onClick={() =>
                setDraft({ ...draft, services: draft.services.filter((_, i) => i !== index) })
              }
            >
              <TrashIcon />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="compact"
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
        <Button type="button" size="compact" variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="compact" disabled={busy || draft.repos.length === 0}>
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
          <Button
            size="compact"
            variant="ghost"
            disabled={busy}
            onClick={() => act(() => aldoPrebuilds.remove(env.id))}
          >
            Delete
          </Button>
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

/** Settings → Environments: prebuilt workspaces new threads start from. */
export function AldoEnvironmentsPanel() {
  const [envs, setEnvs] = useState<ReadonlyArray<AldoPrebuiltEnvironment> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const threads = useSyncExternalStore(subscribeAldoEnvironments, getAldoEnvironments, () => null);
  const repoOptions = useMemo(
    () => [...new Set((threads ?? []).flatMap((t) => t.repos ?? [t.repo]))].sort(),
    [threads],
  );

  const refresh = useCallback(() => {
    aldoPrebuilds
      .list()
      .then((next) => {
        setEnvs(next);
        setError(null);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);
  useEffect(() => refresh(), [refresh]);
  // Follow builds in progress.
  const building = envs?.some((e) => e.building) ?? false;
  useEffect(() => {
    if (!building) return;
    const timer = setInterval(refresh, 10_000);
    return () => clearInterval(timer);
  }, [building, refresh]);

  return (
    <SettingsSection
      title="Environments"
      icon={<BoxesIcon className="size-4" />}
      headerAction={
        <Button
          size="compact"
          variant="outline"
          onClick={() => setDraft({ repos: [], install: "", services: [] })}
        >
          <PlusIcon className="size-3.5" /> Add environment
        </Button>
      }
    >
      <p className="px-3 text-sm text-muted-foreground sm:px-4">
        A ready-to-go environment prebuilds a repository (or a set of repositories) with
        dependencies installed, so new threads start working immediately, with their dev servers
        already running. Agents set one up with <code className="text-xs">save_environment</code>, a
        repository can define one in <code className="text-xs">.aldo/environment.json</code>, or add
        one here. Aldo rebuilds them daily.
      </p>
      {error ? <p className="px-3 text-destructive-foreground text-sm sm:px-4">{error}</p> : null}
      {draft ? (
        <EnvironmentForm
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
        <p className="px-3 text-muted-foreground text-sm sm:px-4">No environments yet.</p>
      ) : null}
      {envs === null ? (
        <LoaderCircleIcon className="mx-4 size-4 animate-spin text-muted-foreground" />
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
