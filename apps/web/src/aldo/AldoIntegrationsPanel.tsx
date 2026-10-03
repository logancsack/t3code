// Settings → Integrations: accounts the user connects for their agents to use,
// beyond their code: Google and Microsoft, for their mail, calendar, contacts
// and files. Connecting signs in with the provider in a popup; how the sign-in
// reports back to this tab is in integrations.logic.ts. Once one is connected,
// Aldo's heads-ups (it looks at new mail and coming events between
// conversations) can be turned off here. Below them, the image, video and
// audio generators agents use with the user's own API keys
// (AldoGeneratorRows.tsx).

import { BlocksIcon, CheckCircle2Icon, SparklesIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { toastManager } from "../components/ui/toast";
import {
  aldoIntegrationConnectUrl,
  disconnectAldoIntegration,
  fetchAldoHeadsUps,
  fetchAldoIntegrations,
  setAldoHeadsUps,
  type AldoHeadsUps,
  type AldoIntegration,
  type AldoIntegrationAccountType,
} from "./cloud";
import { AldoGeneratorRows } from "./AldoGeneratorRows";
import {
  ALDO_INTEGRATIONS_CHANNEL,
  describeAldoCapabilities,
  aldoIntegrationResultFilter,
  parseAldoIntegrationMessage,
  parseAldoIntegrationRedirect,
  withoutAldoIntegrationRedirect,
  type AldoIntegrationResult,
} from "./integrations.logic";

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** The integrations this client can show; any others a newer Aldo offers are left out. */
const INTEGRATIONS: Record<
  string,
  {
    readonly name: string;
    readonly description: string;
    /** The first is the main way to connect; a provider without account types has one. */
    readonly accounts: ReadonlyArray<{
      readonly type?: AldoIntegrationAccountType;
      readonly label: string;
    }>;
  }
> = {
  google: {
    name: "Google",
    description:
      "Lets your agents read your Gmail and draft replies, see and add to your calendar, look up contacts, and open and save your Drive files, Docs and Sheets.",
    accounts: [{ label: "Connect Google account" }],
  },
  microsoft: {
    name: "Microsoft",
    description:
      "Lets your agents read your Outlook mail and draft replies, see and add to your calendar, look up contacts, and open and save your OneDrive and SharePoint files and the Excel workbooks there.",
    accounts: [
      { type: "work", label: "Connect work or school account" },
      { type: "personal", label: "Connect personal account" },
    ],
  },
};

const ACCOUNT_TYPE: Record<AldoIntegrationAccountType, string> = {
  work: "work account",
  personal: "personal account",
};

function connect(provider: string, account?: AldoIntegrationAccountType) {
  const url = aldoIntegrationConnectUrl(provider, account);
  // With the popup blocked, sign in in this tab: Aldo sends it back here after.
  if (!window.open(url, "aldo-integration", "popup,width=520,height=720")) {
    window.location.assign(url);
  }
}

function toastFailure(result: AldoIntegrationResult) {
  toastManager.add({
    type: "error",
    title: `Couldn't connect ${INTEGRATIONS[result.provider]?.name ?? "the account"}`,
    description: result.message ?? "The sign-in didn't finish. Try again.",
  });
}

function IntegrationRow(props: {
  readonly integration: AldoIntegration;
  readonly onChanged: () => void;
}) {
  const { integration } = props;
  const spec = INTEGRATIONS[integration.provider];
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!spec) return null;
  // Connected, but the provider stopped accepting the sign-in: it needs connecting again.
  const broken = integration.connected && integration.error !== null;
  // Connected from before Aldo asked for mail and calendar (or with some left out): connecting
  // again adds them. What a newer Aldo names and this client doesn't know is left out of both.
  const canUse = integration.connected ? describeAldoCapabilities(integration.can ?? []) : "";
  const toAdd =
    integration.connected && !broken ? describeAldoCapabilities(integration.missing ?? []) : "";
  // Connecting again goes the way it was connected; when that's unknown, every way is offered.
  const sameWay = spec.accounts.find((account) => account.type === integration.account?.type);
  const reconnect = broken || toAdd ? (sameWay ? [sameWay] : spec.accounts) : [];

  const disconnect = () => {
    setBusy(true);
    disconnectAldoIntegration(integration.provider)
      .catch((cause: unknown) =>
        toastManager.add({
          type: "error",
          title: `Couldn't disconnect ${spec.name}`,
          description: messageOf(cause),
        }),
      )
      .finally(() => {
        setBusy(false);
        setConfirming(false);
        props.onChanged();
      });
  };

  return (
    <SettingsRow
      title={spec.name}
      description={spec.description}
      status={
        !integration.available ? (
          `${spec.name} sign-in isn't set up on this Aldo yet.`
        ) : broken ? (
          <span className="text-destructive-foreground">{integration.error}</span>
        ) : integration.connected ? (
          <span className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1 text-success-foreground">
              <CheckCircle2Icon className="size-3.5" />
              Connected
              {integration.account
                ? ` as ${integration.account.email}${integration.account.type ? ` (${ACCOUNT_TYPE[integration.account.type]})` : ""}`
                : ""}
            </span>
            {canUse ? (
              <span className="text-muted-foreground">Agents can use your {canUse}.</span>
            ) : null}
            {toAdd ? (
              <span className="text-warning-foreground">Connect again to add your {toAdd}.</span>
            ) : null}
          </span>
        ) : (
          "Not connected"
        )
      }
      control={
        <div className="flex flex-wrap gap-2 sm:flex-col sm:items-stretch">
          {!integration.connected
            ? spec.accounts.map((account, index) => (
                <Button
                  key={account.type ?? account.label}
                  size="sm"
                  variant={index === 0 ? "default" : "outline"}
                  disabled={!integration.available || confirming || busy}
                  onClick={() => connect(integration.provider, account.type)}
                >
                  {account.label}
                </Button>
              ))
            : reconnect.map((account, index) => (
                <Button
                  key={account.type ?? account.label}
                  size="sm"
                  variant={index === 0 ? "default" : "outline"}
                  disabled={!integration.available || confirming || busy}
                  onClick={() => connect(integration.provider, account.type)}
                >
                  {reconnect.length === 1 ? "Connect again" : account.label}
                </Button>
              ))}
          {/* A broken sign-in can be connected again or removed. */}
          {integration.connected ? (
            confirming ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Keep
                </Button>
                <Button size="sm" variant="destructive" disabled={busy} onClick={disconnect}>
                  Disconnect
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
                Disconnect
              </Button>
            )
          ) : null}
        </div>
      }
    />
  );
}

/** Aldo's heads-ups, on or off; shown once Aldo has them and an account with mail or a calendar is connected. */
function HeadsUpsRow() {
  const [headsUps, setHeadsUps] = useState<AldoHeadsUps | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Only the latest read's answer shows.
  const latest = useRef(0);
  const load = useCallback(() => {
    const request = ++latest.current;
    fetchAldoHeadsUps()
      .then((next) => {
        if (request !== latest.current) return;
        setHeadsUps(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (request === latest.current) setError(messageOf(cause));
      });
  }, []);
  useEffect(() => {
    load();
    // A read that failed for a moment is tried again when the user comes back to the tab.
    window.addEventListener("focus", load);
    return () => {
      latest.current++;
      window.removeEventListener("focus", load);
    };
  }, [load]);
  if (error && !headsUps) {
    return (
      <SettingsRow
        title="Heads-ups from Aldo"
        description={`Couldn't read whether they're on: ${error}`}
        control={
          <Button size="sm" variant="outline" onClick={load}>
            Try again
          </Button>
        }
      />
    );
  }
  if (!headsUps) return null;
  const change = (on: boolean) => {
    setSaving(true);
    setAldoHeadsUps(on)
      .then(setHeadsUps)
      .catch((cause: unknown) =>
        toastManager.add({
          type: "error",
          title: "Couldn't change that",
          description: messageOf(cause),
        }),
      )
      .finally(() => setSaving(false));
  };
  return (
    <SettingsRow
      title="Heads-ups from Aldo"
      description="Every half hour of your day, Aldo looks at your new mail and coming events and tells you what's worth knowing (here and on your phone), sometimes with a thread to start for it. Most looks say nothing."
      control={
        <Switch
          checked={headsUps.on}
          disabled={saving}
          onCheckedChange={change}
          aria-label="Heads-ups from Aldo"
        />
      }
    />
  );
}

export function AldoIntegrationsPanel() {
  const [integrations, setIntegrations] = useState<ReadonlyArray<AldoIntegration> | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Refreshes overlap (focus, a sign-in's message, a disconnect); only the latest one's answer shows.
  const latest = useRef(0);

  const refresh = useCallback(() => {
    const request = ++latest.current;
    fetchAldoIntegrations()
      .then((next) => {
        if (request !== latest.current) return;
        setIntegrations(next);
        setUnsupported(next === null);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (request === latest.current) setError(messageOf(cause));
      });
  }, []);

  useEffect(() => {
    refresh();
    // Back from a sign-in that ran in this tab (the popup was blocked).
    const result = parseAldoIntegrationRedirect(window.location.search);
    if (!result) return;
    // On a fresh page load the toasts start listening after this panel mounts.
    if (!result.ok) window.setTimeout(() => toastFailure(result), 0);
    const { pathname, search, hash } = window.location;
    window.history.replaceState(
      window.history.state,
      "",
      `${pathname}${withoutAldoIntegrationRedirect(search)}${hash}`,
    );
  }, [refresh]);

  useEffect(() => {
    const isNew = aldoIntegrationResultFilter();
    const settle = (data: unknown) => {
      const result = parseAldoIntegrationMessage(data);
      if (!result || !isNew(result, Date.now())) return;
      if (!result.ok) toastFailure(result);
      refresh();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin) settle(event.data);
    };
    // The popup's opener can be cut off by the provider's pages; the channel still reaches us.
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(ALDO_INTEGRATIONS_CHANNEL);
    channel?.addEventListener("message", (event) => settle(event.data));
    window.addEventListener("message", onMessage);
    // And if neither did, coming back to the tab shows how it went.
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("focus", refresh);
      channel?.close();
    };
  }, [refresh]);

  const shown = (integrations ?? []).filter(
    (integration) => integration.kind !== "key" && integration.provider in INTEGRATIONS,
  );
  const generators = (integrations ?? []).filter((integration) => integration.kind === "key");

  return (
    <>
      <SettingsSection title="Integrations" icon={<BlocksIcon className="size-4" />}>
        <p className="px-3 text-sm text-muted-foreground sm:px-4">
          Accounts you connect for your agents to use. Disconnect one and agents can't use it
          anymore.
        </p>
        {unsupported ? (
          <p className="px-3 text-sm text-muted-foreground sm:px-4">
            This Aldo server doesn't have integrations yet.
          </p>
        ) : null}
        {error ? <p className="px-3 text-sm text-destructive-foreground sm:px-4">{error}</p> : null}
        {integrations === null && !unsupported && !error ? (
          <p className="px-3 text-sm text-muted-foreground sm:px-4">Loading…</p>
        ) : null}
        {integrations && shown.length === 0 ? (
          <p className="px-3 text-sm text-muted-foreground sm:px-4">Nothing to connect yet.</p>
        ) : null}
        {shown.map((integration) => (
          <IntegrationRow
            key={integration.provider}
            integration={integration}
            onChanged={refresh}
          />
        ))}
        {shown.some(
          (i) =>
            i.connected &&
            !i.error &&
            (i.can ?? ["mail"]).some((c) => c === "mail" || c === "calendar"),
        ) ? (
          <HeadsUpsRow />
        ) : null}
      </SettingsSection>
      {generators.length > 0 ? (
        <SettingsSection
          id="aldo-generators"
          title="Image, video and audio"
          icon={<SparklesIcon className="size-4" />}
        >
          <p className="px-3 text-sm text-muted-foreground sm:px-4">
            Generators your agents use with your own API key, for images, video, voices and music.
            What they make is billed to your account with each one.
          </p>
          <AldoGeneratorRows integrations={generators} onChanged={refresh} />
        </SettingsSection>
      ) : null}
    </>
  );
}
