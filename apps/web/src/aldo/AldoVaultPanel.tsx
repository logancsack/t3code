import { KeyRoundIcon, LockKeyholeIcon, PlusIcon, UploadIcon, VariableIcon } from "lucide-react";
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
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import {
  aldoVault,
  getAldoEnvironments,
  subscribeAldoEnvironments,
  type AldoVaultItem,
} from "./cloud";

const EVERY_THREAD = "*";

function ago(iso: string | null): string {
  if (!iso) return "never";
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function scopeLabel(scope: string): string {
  return scope === EVERY_THREAD ? "All threads" : scope;
}

function useRepositories(): ReadonlyArray<string> {
  const environments = useSyncExternalStore(
    subscribeAldoEnvironments,
    getAldoEnvironments,
    () => null,
  );
  return useMemo(
    () => [...new Set((environments ?? []).map((e) => e.repo))].sort(),
    [environments],
  );
}

function ScopeSelect(props: { value: string; onChange: (value: string) => void; extra?: string }) {
  const repositories = useRepositories();
  const options = [
    ...new Set([
      ...repositories,
      ...(props.extra && props.extra !== EVERY_THREAD ? [props.extra] : []),
    ]),
  ];
  return (
    <Select value={props.value} onValueChange={(value) => props.onChange(String(value))}>
      <SelectTrigger className="h-8 min-w-40 text-xs" aria-label="Which threads get it">
        <SelectValue>{scopeLabel(props.value)}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="start" alignItemWithTrigger={false}>
        <SelectItem value={EVERY_THREAD}>All threads</SelectItem>
        {options.map((repo) => (
          <SelectItem key={repo} value={repo}>
            Only {repo}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function DeleteButton(props: { onDelete: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!confirming) {
    return (
      <Button type="button" size="compact" variant="ghost" onClick={() => setConfirming(true)}>
        Delete
      </Button>
    );
  }
  return (
    <span className="inline-flex gap-1">
      <Button type="button" size="compact" variant="ghost" onClick={() => setConfirming(false)}>
        Keep
      </Button>
      <Button
        type="button"
        size="compact"
        variant="destructive"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          props.onDelete().finally(() => setBusy(false));
        }}
      >
        Delete
      </Button>
    </span>
  );
}

type VariableDraft = { name: string; value: string; scope: string };
type LoginDraft = {
  id?: string;
  label: string;
  origin: string;
  username: string;
  password: string;
  scope: string;
};

/**
 * Settings → Vault: environment variables and website logins for agents.
 * Values are write-only: once saved they're encrypted and never shown again.
 */
export function AldoVaultPanel() {
  const [items, setItems] = useState<ReadonlyArray<AldoVaultItem> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [variable, setVariable] = useState<VariableDraft | null>(null);
  const [login, setLogin] = useState<LoginDraft | null>(null);
  const [importing, setImporting] = useState<{ scope: string; text: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(() => {
    aldoVault
      .list()
      .then((next) => {
        setItems(next);
        setError(null);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);
  useEffect(() => refresh(), [refresh]);

  const run = async (action: () => Promise<unknown>, done: () => void) => {
    setSaving(true);
    setError(null);
    try {
      await action();
      done();
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const variables = (items ?? []).filter((item) => item.kind === "env");
  const logins = (items ?? []).filter((item) => item.kind === "login");

  const saveVariable = (e: FormEvent) => {
    e.preventDefault();
    if (!variable) return;
    void run(
      () => aldoVault.saveVariable(variable),
      () => {
        setNotice(
          `Saved ${variable.name}. Agents' new commands see it now; restart running dev servers to pick it up.`,
        );
        setVariable(null);
      },
    );
  };

  const saveLogin = (e: FormEvent) => {
    e.preventDefault();
    if (!login) return;
    const { password, ...rest } = login;
    void run(
      () => aldoVault.saveLogin(password ? { ...rest, password } : rest),
      () => {
        setNotice(`Saved the login for ${login.label}.`);
        setLogin(null);
      },
    );
  };

  const importFile = (e: FormEvent) => {
    e.preventDefault();
    if (!importing) return;
    void run(
      async () => {
        const result = await aldoVault.importDotenv(importing.scope, importing.text);
        setNotice(
          `Imported ${result.saved.length} variable${result.saved.length === 1 ? "" : "s"}.` +
            (result.skipped.length ? ` Skipped: ${result.skipped.join("; ")}` : ""),
        );
      },
      () => setImporting(null),
    );
  };

  return (
    <>
      <SettingsSection title="Vault" icon={<LockKeyholeIcon className="size-4" />}>
        <p className="px-3 text-sm text-muted-foreground sm:px-4">
          Secrets for your agents. Everything is encrypted and can't be read back here or by agents'
          tools, only replaced. Variables are in every agent shell in the threads they apply to;
          logins are typed into the browser for the agent, which never sees the password.
        </p>
        {error ? <p className="px-3 text-sm text-destructive-foreground sm:px-4">{error}</p> : null}
        {notice ? <p className="px-3 text-sm text-success-foreground sm:px-4">{notice}</p> : null}
      </SettingsSection>

      <SettingsSection
        title="Environment variables"
        icon={<VariableIcon className="size-4" />}
        headerAction={
          <span className="inline-flex gap-1">
            <Button
              type="button"
              size="compact"
              variant="ghost"
              onClick={() => setImporting({ scope: EVERY_THREAD, text: "" })}
            >
              <UploadIcon className="size-3.5" /> Import .env
            </Button>
            <Button
              type="button"
              size="compact"
              variant="outline"
              onClick={() => setVariable({ name: "", value: "", scope: EVERY_THREAD })}
            >
              <PlusIcon className="size-3.5" /> Add variable
            </Button>
          </span>
        }
      >
        {importing ? (
          <form
            onSubmit={importFile}
            className="mx-3 space-y-2 rounded-xl border border-border p-3 sm:mx-4"
          >
            <Textarea
              autoFocus
              aria-label=".env contents"
              placeholder={"DATABASE_URL=postgres://…\nSTRIPE_SECRET_KEY=sk_test_…"}
              className="min-h-32 font-mono text-xs"
              value={importing.text}
              onChange={(e) => setImporting({ ...importing, text: e.currentTarget.value })}
            />
            <div className="flex flex-wrap items-center gap-2">
              <ScopeSelect
                value={importing.scope}
                onChange={(scope) => setImporting({ ...importing, scope })}
              />
              <span className="flex-1" />
              <Button
                type="button"
                size="compact"
                variant="ghost"
                onClick={() => setImporting(null)}
              >
                Cancel
              </Button>
              <Button type="submit" size="compact" disabled={saving || !importing.text.trim()}>
                Import
              </Button>
            </div>
          </form>
        ) : null}
        {variable ? (
          <form
            onSubmit={saveVariable}
            className="mx-3 space-y-2 rounded-xl border border-border p-3 sm:mx-4"
          >
            <Input
              autoFocus={!variable.name}
              aria-label="Name"
              placeholder="NAME"
              className="font-mono text-xs"
              value={variable.name}
              onChange={(e) =>
                setVariable({
                  ...variable,
                  name: e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"),
                })
              }
            />
            <Textarea
              autoFocus={Boolean(variable.name)}
              aria-label="Value"
              placeholder="Value"
              className="min-h-16 font-mono text-xs"
              autoComplete="off"
              spellCheck={false}
              value={variable.value}
              onChange={(e) => setVariable({ ...variable, value: e.currentTarget.value })}
            />
            <div className="flex flex-wrap items-center gap-2">
              <ScopeSelect
                value={variable.scope}
                onChange={(scope) => setVariable({ ...variable, scope })}
              />
              <span className="flex-1" />
              <Button
                type="button"
                size="compact"
                variant="ghost"
                onClick={() => setVariable(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="compact"
                disabled={saving || !variable.name || !variable.value}
              >
                Save
              </Button>
            </div>
          </form>
        ) : null}
        {items && variables.length === 0 && !variable && !importing ? (
          <p className="px-3 text-sm text-muted-foreground sm:px-4">
            No variables yet. Add API keys and other settings your projects need, or import a .env
            file.
          </p>
        ) : null}
        {variables.map((item) => (
          <SettingsRow
            key={item.id}
            title={<span className="font-mono text-sm">{item.name}</span>}
            description={`${scopeLabel(item.scope)} · updated ${ago(item.updated_at)}`}
            control={
              <span className="inline-flex gap-1">
                <Button
                  type="button"
                  size="compact"
                  variant="ghost"
                  onClick={() => setVariable({ name: item.name, value: "", scope: item.scope })}
                >
                  Replace
                </Button>
                <DeleteButton
                  onDelete={() =>
                    run(
                      () => aldoVault.remove(item.id),
                      () => setNotice(`Deleted ${item.name}.`),
                    )
                  }
                />
              </span>
            }
          />
        ))}
      </SettingsSection>

      <SettingsSection
        title="Logins"
        icon={<KeyRoundIcon className="size-4" />}
        headerAction={
          <Button
            type="button"
            size="compact"
            variant="outline"
            onClick={() =>
              setLogin({ label: "", origin: "", username: "", password: "", scope: EVERY_THREAD })
            }
          >
            <PlusIcon className="size-3.5" /> Add login
          </Button>
        }
      >
        {login ? (
          <form
            onSubmit={saveLogin}
            className="mx-3 space-y-2 rounded-xl border border-border p-3 sm:mx-4"
            autoComplete="off"
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                autoFocus
                aria-label="Name"
                placeholder="Name, e.g. Staging admin"
                value={login.label}
                onChange={(e) => setLogin({ ...login, label: e.currentTarget.value })}
              />
              <Input
                aria-label="Site"
                placeholder="Site, e.g. https://github.com"
                value={login.origin}
                onChange={(e) => setLogin({ ...login, origin: e.currentTarget.value })}
              />
              <Input
                aria-label="Username or email"
                placeholder="Username or email"
                autoComplete="off"
                value={login.username}
                onChange={(e) => setLogin({ ...login, username: e.currentTarget.value })}
              />
              <Input
                type="password"
                aria-label="Password"
                placeholder={login.id ? "New password (leave empty to keep)" : "Password"}
                autoComplete="new-password"
                value={login.password}
                onChange={(e) => setLogin({ ...login, password: e.currentTarget.value })}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ScopeSelect
                value={login.scope}
                onChange={(scope) => setLogin({ ...login, scope })}
              />
              <span className="flex-1" />
              <Button type="button" size="compact" variant="ghost" onClick={() => setLogin(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="compact"
                disabled={saving || !login.label || !login.origin || (!login.id && !login.password)}
              >
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Filled only on this exact site. For two-factor codes, agents ask you in chat or you
              take over the browser.
            </p>
          </form>
        ) : null}
        {items && logins.length === 0 && !login ? (
          <p className="px-3 text-sm text-muted-foreground sm:px-4">
            No logins yet. Save the sign-ins your agents need for your app, staging or dashboards.
          </p>
        ) : null}
        {logins.map((item) => (
          <SettingsRow
            key={item.id}
            title={item.name}
            description={`${item.origin}${item.username ? ` · ${item.username}` : ""} · ${scopeLabel(item.scope)} · used ${ago(item.last_used_at)}`}
            control={
              <span className="inline-flex gap-1">
                <Button
                  type="button"
                  size="compact"
                  variant="ghost"
                  onClick={() =>
                    setLogin({
                      id: item.id,
                      label: item.name,
                      origin: item.origin ?? "",
                      username: item.username ?? "",
                      password: "",
                      scope: item.scope,
                    })
                  }
                >
                  Edit
                </Button>
                <DeleteButton
                  onDelete={() =>
                    run(
                      () => aldoVault.remove(item.id),
                      () => setNotice(`Deleted ${item.name}.`),
                    )
                  }
                />
              </span>
            }
          />
        ))}
      </SettingsSection>
    </>
  );
}
