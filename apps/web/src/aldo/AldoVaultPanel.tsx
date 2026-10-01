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
  type AldoSecretKind,
  type AldoVaultItem,
} from "./cloud";
import {
  answersAldoSecretRequest,
  parseAldoSecretRequest,
  type AldoSecretRequest,
} from "./secretRequest.logic";

const EVERY_THREAD = "*";

/** A name a shell can hold; other names reach services and `aldo env` only. */
const SHELL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const DELIVERY: Record<AldoSecretKind, { label: string; help: string }> = {
  env: {
    label: "Variable",
    help: "In every agent shell and dev service. Agents can read it, so use it for settings and for secrets a sandbox needs in full, like a database URL.",
  },
  request: {
    label: "Injected into requests",
    help: "The sandbox's network adds it to HTTPS requests to the sites you list. Agents see only a stand-in, so they can't read it or send it anywhere else. Best for API keys.",
  },
  file: {
    label: "File",
    help: "Written to a path in the sandbox, readable only by the agent's user. For SSH keys, credential JSON files and config files.",
  },
};

/** Sites and headers of common APIs, for injected secrets. */
const PRESETS: ReadonlyArray<{
  label: string;
  name: string;
  hosts: string;
  header: string;
  template: string;
}> = [
  {
    label: "Anthropic",
    name: "ANTHROPIC_API_KEY",
    hosts: "api.anthropic.com",
    header: "x-api-key",
    template: "{value}",
  },
  {
    label: "OpenAI",
    name: "OPENAI_API_KEY",
    hosts: "api.openai.com",
    header: "Authorization",
    template: "Bearer {value}",
  },
  {
    label: "Stripe",
    name: "STRIPE_SECRET_KEY",
    hosts: "api.stripe.com",
    header: "Authorization",
    template: "Bearer {value}",
  },
  {
    label: "GitHub",
    name: "GITHUB_TOKEN",
    hosts: "api.github.com",
    header: "Authorization",
    template: "Bearer {value}",
  },
  {
    label: "Vercel",
    name: "VERCEL_TOKEN",
    hosts: "api.vercel.com, vercel.com",
    header: "Authorization",
    template: "Bearer {value}",
  },
  {
    label: "Resend",
    name: "RESEND_API_KEY",
    hosts: "api.resend.com",
    header: "Authorization",
    template: "Bearer {value}",
  },
];

function deliveryLabel(item: AldoVaultItem): string {
  if (item.kind === "request") return `Injected into requests to ${(item.hosts ?? []).join(", ")}`;
  if (item.kind === "file") return `File at ${(item.path ?? "").replace(/^\/vercel\//, "~/")}`;
  return SHELL_NAME.test(item.name) ? "Variable" : "Variable (services and aldo env)";
}

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

function useEnvironments() {
  return useSyncExternalStore(subscribeAldoEnvironments, getAldoEnvironments, () => null);
}

function useRepositories(): ReadonlyArray<string> {
  const environments = useEnvironments();
  return useMemo(
    () => [...new Set((environments ?? []).map((e) => e.repo))].sort(),
    [environments],
  );
}

/** " · saved by an agent in <thread>" for what an agent saved; it's the user's once they save it here. */
function useSavedBy(): (item: AldoVaultItem) => string {
  const environments = useEnvironments();
  return (item) => {
    if (!item.agent_thread_id) return "";
    const thread = environments?.find((e) => e.threadId === item.agent_thread_id)?.label;
    return ` · saved by an agent${thread ? ` in “${thread}”` : ""}`;
  };
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

type SecretDraft = {
  /** Editing a saved secret: an empty value keeps it. */
  saved: boolean;
  kind: AldoSecretKind;
  name: string;
  value: string;
  scope: string;
  hosts: string;
  header: string;
  template: string;
  path: string;
};

const NEW_SECRET: SecretDraft = {
  saved: false,
  kind: "env",
  name: "",
  value: "",
  scope: EVERY_THREAD,
  hosts: "",
  header: "Authorization",
  template: "Bearer {value}",
  path: "",
};

function draftOf(item: AldoVaultItem): SecretDraft {
  return {
    saved: true,
    kind: item.kind === "login" ? "env" : item.kind,
    name: item.name,
    value: "",
    scope: item.scope,
    hosts: (item.hosts ?? []).join(", "),
    header: item.header ?? "Authorization",
    template: item.template ?? "Bearer {value}",
    path: (item.path ?? "").replace(/^\/vercel\//, "~/"),
  };
}
function SecretForm(props: {
  draft: SecretDraft;
  saving: boolean;
  onChange: (draft: SecretDraft) => void;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
}) {
  const { draft, onChange } = props;
  const set = (patch: Partial<SecretDraft>) => onChange({ ...draft, ...patch });
  const ready =
    draft.name.trim() &&
    (draft.value || draft.saved) &&
    (draft.kind !== "request" || draft.hosts.trim()) &&
    (draft.kind !== "file" || draft.path.trim());
  return (
    <form
      onSubmit={props.onSubmit}
      className="mx-3 space-y-2 rounded-xl border border-border p-3 sm:mx-4"
      autoComplete="off"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          autoFocus={!draft.saved}
          aria-label="Name"
          placeholder={
            draft.kind === "file" ? "Name, e.g. Deploy key" : "Name, e.g. STRIPE_SECRET_KEY"
          }
          className="min-w-48 flex-1 font-mono text-xs"
          value={draft.name}
          readOnly={draft.saved}
          onChange={(e) => set({ name: e.currentTarget.value })}
        />
        <Select
          value={draft.kind}
          onValueChange={(value) => set({ kind: value as AldoSecretKind })}
        >
          <SelectTrigger className="h-8 min-w-48 text-xs" aria-label="How agents get it">
            <SelectValue>{DELIVERY[draft.kind].label}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="start" alignItemWithTrigger={false}>
            {(Object.keys(DELIVERY) as AldoSecretKind[]).map((kind) => (
              <SelectItem key={kind} value={kind}>
                {DELIVERY[kind].label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">
        {DELIVERY[draft.kind].help}
        {draft.kind === "env" && draft.name.trim() && !SHELL_NAME.test(draft.name.trim())
          ? " A shell can't hold this name, so it reaches dev services and `aldo env`, not shell commands."
          : ""}
      </p>
      {draft.kind === "request" ? (
        <>
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-xs text-muted-foreground">Fill in for</span>
            {PRESETS.map((preset) => (
              <Button
                key={preset.label}
                type="button"
                size="compact"
                variant="ghost"
                onClick={() =>
                  set({
                    name: draft.saved || draft.name ? draft.name : preset.name,
                    hosts: preset.hosts,
                    header: preset.header,
                    template: preset.template,
                  })
                }
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <Input
            aria-label="Sites"
            placeholder="Sites, e.g. api.stripe.com, *.example.com"
            className="font-mono text-xs"
            value={draft.hosts}
            onChange={(e) => set({ hosts: e.currentTarget.value })}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              aria-label="Header"
              placeholder="Header, e.g. Authorization"
              className="font-mono text-xs"
              value={draft.header}
              onChange={(e) => set({ header: e.currentTarget.value })}
            />
            <Input
              aria-label="Header value"
              placeholder="Header value, e.g. Bearer {value}"
              className="font-mono text-xs"
              value={draft.template}
              onChange={(e) => set({ template: e.currentTarget.value })}
            />
          </div>
        </>
      ) : null}
      {draft.kind === "file" ? (
        <Input
          aria-label="Path"
          placeholder="Path, e.g. ~/.ssh/id_ed25519"
          className="font-mono text-xs"
          value={draft.path}
          onChange={(e) => set({ path: e.currentTarget.value })}
        />
      ) : null}
      <Textarea
        autoFocus={draft.saved}
        aria-label="Value"
        placeholder={draft.saved ? "New value (leave empty to keep the saved one)" : "Value"}
        className="min-h-16 font-mono text-xs"
        autoComplete="off"
        spellCheck={false}
        value={draft.value}
        onChange={(e) => set({ value: e.currentTarget.value })}
      />
      <div className="flex flex-wrap items-center gap-2">
        {draft.saved ? (
          <span className="text-xs text-muted-foreground">{scopeLabel(draft.scope)}</span>
        ) : (
          <ScopeSelect value={draft.scope} onChange={(scope) => set({ scope })} />
        )}
        <span className="flex-1" />
        <Button type="button" size="compact" variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="compact" disabled={props.saving || !ready}>
          Save
        </Button>
      </div>
    </form>
  );
}

type LoginDraft = {
  id?: string;
  label: string;
  origin: string;
  username: string;
  password: string;
  scope: string;
};

/**
 * Settings → Vault: secrets (variables, secrets injected into requests, files)
 * and website logins for agents. Values are write-only: once saved they're
 * encrypted and never shown again.
 */
export function AldoVaultPanel() {
  const [items, setItems] = useState<ReadonlyArray<AldoVaultItem> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<SecretDraft | null>(null);
  const [login, setLogin] = useState<LoginDraft | null>(null);
  const [importing, setImporting] = useState<{ scope: string; text: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savedBy = useSavedBy();
  // An agent's request_secret link: the form filled in, and the thread told once it's saved.
  const [requested, setRequested] = useState<AldoSecretRequest | null>(null);
  useEffect(() => {
    const request = parseAldoSecretRequest(window.location.search, EVERY_THREAD);
    if (!request) return;
    setRequested(request);
    setSecret({
      ...NEW_SECRET,
      kind: request.kind,
      name: request.name,
      scope: request.scope,
      hosts: request.hosts,
      path: request.path,
    });
  }, []);
  const clearRequest = () => {
    setRequested(null);
    window.history.replaceState(window.history.state, "", window.location.pathname);
  };

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

  const secrets = (items ?? []).filter((item) => item.kind !== "login");
  const logins = (items ?? []).filter((item) => item.kind === "login");

  const saveSecret = (e: FormEvent) => {
    e.preventDefault();
    if (!secret) return;
    const { saved: _saved, ...input } = secret;
    // Only the form the agent asked for tells its thread; another secret leaves the request open.
    const answer = requested && answersAldoSecretRequest(requested, secret) ? requested : null;
    void run(
      () => aldoVault.saveSecret(answer ? { ...input, requestedBy: answer.requestedBy } : input),
      () => {
        if (answer) clearRequest();
        setNotice(
          secret.kind === "request"
            ? `Saved ${secret.name}. Requests to ${secret.hosts} get it now; agents see a stand-in.`
            : secret.kind === "file"
              ? `Saved ${secret.name} to ${secret.path} in running threads.`
              : `Saved ${secret.name}. Agents' new commands see it now; restart running dev servers to pick it up.`,
        );
        setSecret(null);
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
          Secrets for your agents, under any name. Everything is encrypted and can't be read back
          here, only replaced. A secret can be a variable in every agent shell, injected into
          requests to the sites you list (agents see only a stand-in, so they can't read or leak
          it), or a file. Logins are typed into the browser for the agent, which never sees the
          password. Agents save what they sign in with here too, and when you sign in in a thread's
          browser, it offers to save the login.
        </p>
        {error ? <p className="px-3 text-sm text-destructive-foreground sm:px-4">{error}</p> : null}
        {notice ? <p className="px-3 text-sm text-success-foreground sm:px-4">{notice}</p> : null}
      </SettingsSection>

      <SettingsSection
        title="Secrets"
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
              onClick={() => setSecret(NEW_SECRET)}
            >
              <PlusIcon className="size-3.5" /> Add secret
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
            <p className="text-xs text-muted-foreground">
              Imported as variables. To keep an API key out of agents' reach, change it to Injected
              into requests afterwards.
            </p>
          </form>
        ) : null}
        {secret && requested && answersAldoSecretRequest(requested, secret) ? (
          <p className="px-3 text-sm sm:px-4">
            An agent asked for <span className="font-mono">{requested.name}</span>
            {requested.why ? `: ${requested.why}` : ""}. Paste the value below, not in the
            conversation.{" "}
            {secret.kind === "request"
              ? "Injected into requests, it never reaches the cloud machine; agents only see a stand-in."
              : "As a variable or a file it's on the cloud machine, where agents can read it; for an API key, prefer Injected into requests."}{" "}
            The thread that asked carries on once it's saved.
          </p>
        ) : null}
        {secret ? (
          <SecretForm
            draft={secret}
            saving={saving}
            onChange={setSecret}
            onSubmit={saveSecret}
            onCancel={() => {
              // Cancelling the requested form declines the request.
              if (requested && answersAldoSecretRequest(requested, secret)) clearRequest();
              setSecret(null);
            }}
          />
        ) : null}
        {items && secrets.length === 0 && !secret && !importing ? (
          <p className="px-3 text-sm text-muted-foreground sm:px-4">
            No secrets yet. Add API keys, settings and files your projects need, or import a .env
            file.
          </p>
        ) : null}
        {secrets.map((item) => (
          <SettingsRow
            key={item.id}
            title={<span className="font-mono text-sm">{item.name}</span>}
            description={`${deliveryLabel(item)} · ${scopeLabel(item.scope)} · updated ${ago(item.updated_at)}${savedBy(item)}`}
            control={
              <span className="inline-flex gap-1">
                <Button
                  type="button"
                  size="compact"
                  variant="ghost"
                  onClick={() => setSecret(draftOf(item))}
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
            description={`${item.origin}${item.username ? ` · ${item.username}` : ""} · ${scopeLabel(item.scope)} · used ${ago(item.last_used_at)}${savedBy(item)}`}
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
