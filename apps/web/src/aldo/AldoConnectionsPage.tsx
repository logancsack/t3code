// Settings → Connections: the accounts and apps the user connects for their
// agents to use as them. What's connected comes first, with whatever needs
// connecting again called out at the top; below it, what can be added, by
// kind: code hosts, Google and Microsoft (mail, calendar, contacts and files),
// the user's Link wallet (agents pay from it with the user's approval each
// time), apps with a remote MCP server (AldoAppsSection.tsx), and the image,
// video and audio generators agents use with the user's own API keys
// (AldoGeneratorRows.tsx). Connecting signs in with the provider in a popup;
// how the sign-in reports back to this tab is in integrations.logic.ts.

import { CheckCircle2Icon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  useSettingsSearchTargetId,
} from "../components/settings/settingsLayout";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { toastManager } from "../components/ui/toast";
import { cn } from "~/lib/utils";
import {
  aldoIntegrationConnectUrl,
  disconnectAldoIntegration,
  fetchAldoIntegrations,
  type AldoIntegration,
  type AldoIntegrationAccountType,
} from "./cloud";
import { AldoAccountRow, useAldoAccounts } from "./AldoAccountsPanel";
import { AldoAnotherAppRow, AldoAppCatalogRow, AldoAppRow, useAldoApps } from "./AldoAppsSection";
import { AldoGeneratorRow } from "./AldoGeneratorRows";
import { ALDO_GIT_HOST_KINDS, AldoGitHostRow } from "./AldoGitHostsPanel";
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
  link: {
    name: "Link",
    description:
      "Lets your agents pay from your Link wallet. Each purchase waits for your approval in Link, and the card it gives works once, for that amount, at that store.",
    accounts: [{ label: "Connect Link" }],
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
      id={`aldo-integration-${integration.provider}`}
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

/**
 * The integrations this Aldo offers, connected or not: null on an Aldo
 * without them. Read again when a sign-in reports back (in a popup, or in
 * this tab when the popup was blocked) and when the user comes back.
 */
function useAldoIntegrations() {
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

  return { integrations, unsupported, error, refresh };
}

type ConnectionKind = "code" | "mail" | "payments" | "apps" | "media";

const KINDS: ReadonlyArray<{
  readonly value: ConnectionKind | "all";
  readonly label: string;
  readonly about?: string;
}> = [
  { value: "all", label: "All" },
  {
    value: "code",
    label: "Code",
    about:
      "Where your repositories are: agents clone them, open pull requests and follow them through.",
  },
  {
    value: "mail",
    label: "Mail & calendar",
    about:
      "Your mail, calendar, contacts and files. Agents draft rather than send unless you say so.",
  },
  {
    value: "payments",
    label: "Payments",
    about: "A wallet agents pay from, with your approval each time.",
  },
  {
    value: "apps",
    label: "Apps",
    about:
      "Apps every agent can use as you. You sign in to each one; Aldo keeps the sign-in, and no agent ever sees it. Zapier reaches thousands more.",
  },
  {
    value: "media",
    label: "Image, video & audio",
    about:
      "Generators your agents use with your own API key, for images, video, voices and music. What they make is billed to your account with each one.",
  },
];

/** Where a search result on this page leads: its kind's list. */
const SEARCH_TARGET_KINDS: Readonly<Record<string, ConnectionKind | "all">> = {
  "aldo-apps": "apps",
  "aldo-generators": "media",
  "aldo-connections": "all",
};

const INTEGRATION_KINDS: Readonly<Record<string, ConnectionKind>> = {
  google: "mail",
  microsoft: "mail",
  link: "payments",
};

interface Connection {
  readonly key: string;
  readonly kind: ConnectionKind;
  readonly connected: boolean;
  /** Its name, when it needs connecting again. */
  readonly broken?: string;
  readonly row: ReactNode;
}

function KindFilter(props: {
  readonly value: ConnectionKind | "all";
  readonly onChange: (value: ConnectionKind | "all") => void;
}) {
  return (
    <div role="radiogroup" aria-label="Kind of connection" className="flex flex-wrap gap-1.5">
      {KINDS.map((kind) => (
        <button
          key={kind.value}
          type="button"
          role="radio"
          aria-checked={props.value === kind.value}
          className={cn(
            "h-7 rounded-full border px-3 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
            props.value === kind.value
              ? "border-foreground/20 bg-foreground text-background"
              : "border-border/70 text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
          onClick={() => props.onChange(kind.value)}
        >
          {kind.label}
        </button>
      ))}
    </div>
  );
}

const joinNames = (names: ReadonlyArray<string>) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

export function AldoConnectionsPage() {
  const accounts = useAldoAccounts();
  const integrations = useAldoIntegrations();
  const apps = useAldoApps();
  const [kind, setKind] = useState<ConnectionKind | "all">("all");

  // A search for apps or generators opens their list, where its row is.
  const targetId = useSettingsSearchTargetId();
  useEffect(() => {
    const target = targetId ? SEARCH_TARGET_KINDS[targetId] : undefined;
    if (target) setKind(target);
    else if (targetId?.startsWith("aldo-integration-")) setKind("all");
  }, [targetId]);

  const connections: Connection[] = [];
  const github = accounts.accounts?.github;
  if (accounts.accounts) {
    connections.push({
      key: "github",
      kind: "code",
      connected: github?.connected === true,
      row: <AldoAccountRow kind="github" account={github} onChanged={accounts.refresh} />,
    });
    for (const host of ALDO_GIT_HOST_KINDS) {
      const account = accounts.accounts[host];
      if (!account) continue;
      connections.push({
        key: host,
        kind: "code",
        connected: account.connected,
        row: <AldoGitHostRow kind={host} account={account} onChanged={accounts.refresh} />,
      });
    }
  }
  for (const integration of integrations.integrations ?? []) {
    if (integration.kind === "key") {
      connections.push({
        key: integration.provider,
        kind: "media",
        connected: integration.connected,
        row: <AldoGeneratorRow integration={integration} onChanged={integrations.refresh} />,
      });
      continue;
    }
    const spec = INTEGRATIONS[integration.provider];
    const integrationKind = INTEGRATION_KINDS[integration.provider];
    if (!spec || !integrationKind) continue;
    connections.push({
      key: integration.provider,
      kind: integrationKind,
      connected: integration.connected,
      ...(integration.connected && integration.error !== null ? { broken: spec.name } : {}),
      row: <IntegrationRow integration={integration} onChanged={integrations.refresh} />,
    });
  }
  for (const app of apps.data?.apps ?? []) {
    connections.push({
      key: `app:${app.id}`,
      kind: "apps",
      connected: true,
      ...(app.status === "failed" ? { broken: app.title } : {}),
      row: <AldoAppRow app={app} onChanged={apps.refresh} />,
    });
  }
  for (const entry of apps.data?.catalog ?? []) {
    if (entry.connected) continue;
    connections.push({
      key: `catalog:${entry.name}`,
      kind: "apps",
      connected: false,
      row: <AldoAppCatalogRow entry={entry} />,
    });
  }

  const loading =
    !accounts.accounts &&
    !accounts.error &&
    integrations.integrations === null &&
    !integrations.unsupported;
  const connected = connections
    .filter((connection) => connection.connected)
    .toSorted((a, b) => Number(Boolean(b.broken)) - Number(Boolean(a.broken)));
  const broken = connected.flatMap((connection) => (connection.broken ? [connection.broken] : []));
  const offered = connections.filter(
    (connection) => !connection.connected && (kind === "all" || connection.kind === kind),
  );
  const about = KINDS.find((entry) => entry.value === kind)?.about;
  const errors = [accounts.error, integrations.error, apps.error].filter(Boolean);

  return (
    <SettingsPageContainer>
      {broken.length > 0 ? (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertTitle>
            {joinNames(broken)} {broken.length === 1 ? "needs" : "need"} connecting again
          </AlertTitle>
          <AlertDescription>
            Your agents can't use {broken.length === 1 ? "it" : "them"} until you do: Connect again,
            below.
          </AlertDescription>
        </Alert>
      ) : null}
      <SettingsSection
        id="aldo-connections"
        title="Connected"
        icon={<CheckCircle2Icon className="size-4" />}
      >
        {errors.map((error) => (
          <p key={error} className="px-3 py-2 text-destructive-foreground text-sm sm:px-4">
            {error}
          </p>
        ))}
        {loading ? (
          <p className="px-3 py-3 text-muted-foreground text-sm sm:px-4">Loading…</p>
        ) : connected.length === 0 ? (
          <p className="px-3 py-3 text-muted-foreground text-sm sm:px-4">
            Nothing yet. Connect an account below, and your agents can use it as you. Disconnect one
            and they can't anymore.
          </p>
        ) : (
          connected.map((connection) => <Fragment key={connection.key}>{connection.row}</Fragment>)
        )}
      </SettingsSection>
      <SettingsSection
        id="aldo-add-connection"
        title="Add a connection"
        icon={<PlusIcon className="size-4" />}
      >
        <div className="flex flex-col gap-2 px-3 py-3 sm:px-4">
          <KindFilter value={kind} onChange={setKind} />
          {about ? (
            <p
              id={kind === "apps" ? "aldo-apps" : kind === "media" ? "aldo-generators" : undefined}
              className="text-muted-foreground text-xs"
            >
              {about}
            </p>
          ) : null}
        </div>
        {offered.map((connection) => (
          <Fragment key={connection.key}>{connection.row}</Fragment>
        ))}
        {apps.data && (kind === "all" || kind === "apps") ? <AldoAnotherAppRow /> : null}
        {!loading && offered.length === 0 && !(apps.data && kind === "apps") ? (
          <p className="px-3 py-3 text-muted-foreground text-sm sm:px-4">
            {kind === "media" && integrations.unsupported
              ? "Media generators aren't available on this Aldo server."
              : "Everything here is connected."}
          </p>
        ) : null}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
