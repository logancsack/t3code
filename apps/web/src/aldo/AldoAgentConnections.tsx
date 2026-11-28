import { CheckCircle2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import type { AuthConnectorMethod } from "@t3tools/contracts";

import { AuthConnectorDialog } from "../components/settings/AuthConnectorDialog";
import { AGENT_AUTH_METHODS } from "../components/settings/authConnectorMethods";
import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toastManager } from "../components/ui/toast";
import { AldoBrandTile } from "./AldoBrandTile";
import {
  disconnectAldoAccount,
  fetchOpenCodeProviders,
  type AldoOpenCodeProvider,
} from "./accountApi";
import { useAldoAccounts } from "./useAldoAccounts";

const GO = {
  method: "opencode-go-api-key" as const,
  label: "OpenCode Go",
  description: "Use models included in your OpenCode Go plan.",
  externalHelpUrl: "https://opencode.ai/console",
  externalHelpLabel: "Get your OpenCode Go API key",
};

const GOOGLE = {
  method: "account" as const,
  label: "Sign in with Google",
  description: "Use your personal Google account and its Antigravity models.",
  browserName: "Google",
  returnInstruction: "After you sign in, paste the code or full address from Antigravity here.",
};

/** How many matches the provider search shows at once. */
const SHOWN = 8;

/** A key for one provider OpenCode knows, as the connect dialog offers it. */
function otherProviderMethod(provider: AldoOpenCodeProvider) {
  return {
    // Aldo takes any provider's "<id>-api-key"; the contract lists only T3's own.
    method: `${provider.id}-api-key` as AuthConnectorMethod,
    label: provider.name,
    description: `Use ${provider.name} models with your own API key.`,
    ...(provider.doc
      ? { externalHelpUrl: provider.doc, externalHelpLabel: `${provider.name} documentation` }
      : {}),
  };
}

/** Google Antigravity row rendered alongside the other AI subscriptions in Models. */
export function AldoGoogleAntigravityRow() {
  const { accounts, refresh } = useAldoAccounts();
  const [confirming, setConfirming] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  if (!accounts?.antigravity) return null;

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnectAldoAccount("antigravity");
      setConfirming(false);
      refresh();
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Couldn’t disconnect Google Antigravity",
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <SettingsRow
      id="aldo-account-antigravity"
      leading={<AldoBrandTile id="antigravity" name="Google Antigravity" />}
      title="Google Antigravity"
      description="Use the models and limits included with your Google account."
      status={
        accounts.antigravity.connected ? (
          <span className="inline-flex items-center gap-1 text-success-foreground">
            <CheckCircle2Icon className="size-3.5" />
            Connected
          </span>
        ) : undefined
      }
      inline
      control={
        confirming && accounts.antigravity.connected ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={disconnecting}
              onClick={() => setConfirming(false)}
            >
              Keep
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={disconnecting}
              onClick={() => void disconnect()}
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
          </>
        ) : (
          <>
            {accounts.antigravity.connected ? (
              <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
                Disconnect
              </Button>
            ) : null}
            <AuthConnectorDialog
              connector="antigravity"
              serviceName="Google Antigravity"
              methods={[GOOGLE]}
              isAuthenticated={accounts.antigravity.connected}
              accountScoped
              triggerLabel={accounts.antigravity.connected ? "Reconnect" : "Connect"}
              onConnected={refresh}
            />
          </>
        )
      }
    />
  );
}

/** Another provider than the ones OpenCode offers by name: search OpenCode's list, then connect its key. */
function OtherOpenCodeProvider(props: {
  /** The named methods and the keys already connected: not offered again. */
  readonly listed: ReadonlySet<string>;
  readonly onConnected: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<ReadonlyArray<AldoOpenCodeProvider> | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<AldoOpenCodeProvider | null>(null);
  useEffect(() => {
    if (!open || providers) return;
    let cancelled = false;
    fetchOpenCodeProviders()
      .then((list) => !cancelled && setProviders(list))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [open, providers]);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (providers ?? []).filter(
    (p) =>
      !props.listed.has(`${p.id}-api-key`) &&
      words.every((w) => `${p.name} ${p.id}`.toLowerCase().includes(w)),
  );
  return (
    <SettingsRow
      title="Another API provider"
      description="Any provider OpenCode supports with an API key, such as Groq, DeepSeek or Mistral. Your provider bills you directly."
      inline
      control={
        chosen ? (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setChosen(null)}>
              Change
            </Button>
            <AuthConnectorDialog
              connector="opencode"
              serviceName={chosen.name}
              methods={[otherProviderMethod(chosen)]}
              isAuthenticated={false}
              accountScoped
              triggerLabel={`Connect ${chosen.name}`}
              onConnected={() => {
                setChosen(null);
                setOpen(false);
                setQuery("");
                props.onConnected();
              }}
            />
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setOpen((was) => !was)}>
            {open ? "Close" : "Choose a provider"}
          </Button>
        )
      }
    >
      {open && !chosen ? (
        <div className="mt-3 space-y-2 pb-2">
          <Input
            type="search"
            aria-label="Search providers"
            placeholder="Search providers"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            autoFocus
          />
          {failed ? (
            <p role="alert" className="text-sm text-destructive-foreground">
              Couldn’t load the providers. Try again in a moment.
            </p>
          ) : !providers ? (
            <p className="text-sm text-muted-foreground">Loading providers…</p>
          ) : matches.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {words.length
                ? `No provider matches “${query}”.`
                : "No other providers are available right now. Try again later."}
            </p>
          ) : (
            <ul
              className="divide-y overflow-hidden rounded-xl border bg-card"
              aria-label="Providers"
            >
              {matches.slice(0, SHOWN).map((provider) => (
                <li key={provider.id}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center justify-between gap-4 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/45"
                    onClick={() => setChosen(provider)}
                  >
                    <span className="min-w-0 truncate font-medium text-foreground">
                      {provider.name}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{provider.id}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {matches.length > SHOWN ? (
            <p className="text-xs text-muted-foreground">
              {matches.length - SHOWN} more. Type to narrow the list.
            </p>
          ) : null}
        </div>
      ) : null}
    </SettingsRow>
  );
}

/** API keys section in Settings → Models (OpenCode and connected provider keys). */
export function AldoAgentConnections() {
  const { accounts, refresh } = useAldoAccounts();
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const disconnect = async (kind: `opencode:${string}`, label: string) => {
    setDisconnecting(kind);
    try {
      await disconnectAldoAccount(kind);
      setConfirmingKey(null);
      refresh();
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: `Couldn’t disconnect ${label}`,
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setDisconnecting(null);
    }
  };

  if (!accounts?.opencode) return null;
  const methods = accounts.opencode.methods ?? [];
  const offered = [GO, ...(AGENT_AUTH_METHODS.opencode?.methods ?? [])].filter((option) =>
    methods.some((method) => method.method === option.method),
  );

  return (
    <SettingsSection title="API keys">
      <SettingsRow
        id="aldo-account-opencode"
        leading={<AldoBrandTile id="opencode" name="OpenCode" />}
        title="OpenCode"
        description="Run models using your own OpenCode, Anthropic, OpenAI or OpenRouter API keys. Your provider bills you directly."
        status={
          accounts.opencode.connected ? (
            <span className="inline-flex items-center gap-1 text-success-foreground">
              <CheckCircle2Icon className="size-3.5" />
              Connected
            </span>
          ) : undefined
        }
        inline
        control={
          <AuthConnectorDialog
            connector="opencode"
            serviceName="OpenCode"
            methods={offered}
            isAuthenticated={accounts.opencode.connected}
            accountScoped
            triggerLabel={accounts.opencode.connected ? "Manage keys" : "Connect"}
            onConnected={refresh}
          />
        }
      />
      {methods
        .filter((method) => method.connected)
        .map(({ method, kind, label }) => {
          const displayLabel =
            offered.find((option) => option.method === method)?.label ?? label ?? "OpenCode key";
          return (
            <SettingsRow
              key={kind}
              title={displayLabel}
              status="Connected"
              inline
              control={
                kind.startsWith("opencode:") ? (
                  confirmingKey === kind ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={disconnecting !== null}
                        onClick={() => setConfirmingKey(null)}
                      >
                        Keep
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={disconnecting !== null}
                        onClick={() => void disconnect(kind as `opencode:${string}`, displayLabel)}
                      >
                        {disconnecting === kind ? "Disconnecting…" : "Disconnect"}
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={disconnecting !== null}
                      onClick={() => setConfirmingKey(kind)}
                    >
                      Disconnect
                    </Button>
                  )
                ) : null
              }
            />
          );
        })}
      {accounts.opencode.otherProviders ? (
        <OtherOpenCodeProvider
          listed={new Set(methods.map((m) => m.method))}
          onConnected={refresh}
        />
      ) : null}
    </SettingsSection>
  );
}
