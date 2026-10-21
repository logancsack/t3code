// Settings → Connections: the accounts and apps the user connects for their
// agents to use as them. What's connected comes first, one that stopped
// working first among them, saying so on its row; then the agents' own email;
// then what can be added, searchable, in two columns by kind: Google and
// Microsoft (mail, calendar, contacts and files), code hosts, payments (the
// user's Link wallet, which agents pay from with the user's approval each
// time, and Stripe and PayPal), apps with a remote MCP server
// (AldoAppsSection.tsx), and the image, video and audio generators agents use
// with the user's own API keys (AldoGeneratorRows.tsx). An app the catalog
// doesn't have connects by its address. Connecting signs in with the provider
// in a popup; how the sign-in reports back to this tab is in
// integrations.logic.ts.

import { CheckCircle2Icon, MailIcon, SearchIcon } from "lucide-react";
import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";

import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  useSettingsSearchTargetId,
} from "../components/settings/settingsLayout";
import { SettingsGroup } from "../components/settings/SettingsGroup";
import { Button } from "../components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../components/ui/input-group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import { toastManager } from "../components/ui/toast";
import { cn } from "~/lib/utils";
import {
  aldoIntegrationConnectUrl,
  disconnectAldoIntegration,
  type AldoIntegration,
  type AldoIntegrationAccountType,
} from "./accountApi";
import { settingsIntegrations, settingsVault } from "./settingsData";
import { useSettingsResource } from "./settingsResource";
import { AldoAccountButton, AldoAccountRow, useAldoAccounts } from "./AldoAccountsPanel";
import { AldoAgentInboxRows } from "./AldoAgentInbox";
import {
  AldoAppCatalogTile,
  AldoAppRow,
  AldoConnectorAddress,
  useAldoApps,
} from "./AldoAppsSection";
import { AldoBrandTile } from "./AldoBrandTile";
import { AldoBrokenStatus } from "./AldoConnectionStatus";
import { AldoConnectionGrid, AldoConnectionTile } from "./AldoConnectionTile";
import { AldoGeneratorRow, aldoGeneratorWhat } from "./AldoGeneratorRows";
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
    /** Its catalog tile's line. */
    readonly what: string;
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
    what: "Gmail, Calendar, Drive and Contacts",
    accounts: [{ label: "Connect Google account" }],
  },
  microsoft: {
    name: "Microsoft",
    description:
      "Lets your agents read your Outlook mail and draft replies, see and add to your calendar, look up contacts, and open and save your OneDrive and SharePoint files and the Excel workbooks there.",
    what: "Outlook, Calendar, OneDrive and Excel",
    accounts: [
      { type: "work", label: "Connect work or school account" },
      { type: "personal", label: "Connect personal account" },
    ],
  },
  link: {
    name: "Link",
    description:
      "Lets your agents pay from your Link wallet. Each purchase waits for your approval in Link, and the card it gives works once, for that amount, at that store.",
    what: "One-time cards you approve each time",
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

/** One way to connect, in a tile's Connect menu: the kind of account, without "Connect". */
const MENU_LABEL: Record<AldoIntegrationAccountType, string> = {
  work: "Work or school account",
  personal: "Personal account",
};

/** Google, Microsoft or Link, not connected, in the catalog. */
function IntegrationTile(props: { readonly integration: AldoIntegration }) {
  const { integration } = props;
  const spec = INTEGRATIONS[integration.provider];
  if (!spec) return null;
  const disabled = !integration.available;
  const [first] = spec.accounts;
  return (
    <AldoConnectionTile
      id={`aldo-integration-${integration.provider}`}
      brand={integration.provider}
      name={spec.name}
      what={spec.what}
      {...(disabled ? { status: "Sign-in isn’t set up on this Aldo yet." } : {})}
      control={
        spec.accounts.length > 1 ? (
          <Menu>
            <MenuTrigger disabled={disabled} render={<Button size="compact" variant="outline" />}>
              Connect
            </MenuTrigger>
            <MenuPopup align="end">
              {spec.accounts.map((account) => (
                <MenuItem
                  key={account.type ?? account.label}
                  onClick={() => connect(integration.provider, account.type)}
                >
                  {account.type ? MENU_LABEL[account.type] : account.label}
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        ) : (
          <Button
            size="compact"
            variant="outline"
            disabled={disabled}
            onClick={() => connect(integration.provider, first?.type)}
          >
            Connect
          </Button>
        )
      }
    />
  );
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
      leading={<AldoBrandTile id={integration.provider} name={spec.name} />}
      title={spec.name}
      description={spec.description}
      status={
        !integration.available ? (
          `${spec.name} sign-in isn't set up on this Aldo yet.`
        ) : broken ? (
          <AldoBrokenStatus>{integration.error}</AldoBrokenStatus>
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
                  {reconnect.length > 1 ? account.label : broken ? "Reconnect" : "Connect again"}
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
  const { data, error } = useSettingsResource(settingsIntegrations, true, false);
  const integrations = data ?? null;
  const unsupported = data === null;
  const refresh = useCallback(() => {
    void settingsIntegrations.refresh().catch(() => undefined);
    void settingsVault.refresh().catch(() => undefined);
  }, []);

  useEffect(() => {
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
  }, []);

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

type ConnectionKind = "mail" | "code" | "payments" | "apps" | "media";

/** The catalog's groups, in order, with a line on what agents do with each. */
const KINDS: ReadonlyArray<{
  readonly value: ConnectionKind;
  readonly label: string;
  readonly about: string;
}> = [
  {
    value: "mail",
    label: "Mail and calendar",
    about: "Agents draft rather than send unless you say so.",
  },
  {
    value: "code",
    label: "Code",
    about: "Agents clone your repositories and follow pull requests through.",
  },
  {
    value: "payments",
    label: "Payments",
    about: "Agents pay from Link with your approval each time.",
  },
  {
    value: "apps",
    label: "Work apps",
    about: "Aldo keeps each sign-in, and no agent ever sees it.",
  },
  {
    value: "media",
    label: "Images, video and audio",
    about: "With your own API key: what agents make is billed to you there.",
  },
];

/** The groups a search result leads to, by their anchor. */
const GROUP_ANCHORS: ReadonlyArray<readonly [ConnectionKind, string]> = [
  ["apps", "aldo-apps"],
  ["media", "aldo-generators"],
];

/** Where a search result on this page leads: its group, with the catalog unfiltered. */
const SEARCH_TARGET_KINDS: Readonly<Record<string, ConnectionKind | "all">> = {
  "aldo-apps": "apps",
  "aldo-generators": "media",
  "aldo-connections": "all",
  "aldo-another-app": "all",
};

const INTEGRATION_KINDS: Readonly<Record<string, ConnectionKind>> = {
  google: "mail",
  microsoft: "mail",
  link: "payments",
};

/** Apps in the catalog that are payments, with Link. */
const PAYMENT_APPS: ReadonlySet<string> = new Set(["stripe", "paypal"]);

interface Connection {
  readonly key: string;
  readonly kind: ConnectionKind;
  readonly connected: boolean;
  /** Its name, when it stopped working. */
  readonly broken?: string;
  /** What a search matches. */
  readonly name: string;
  readonly what: string;
  /** Its row, connected; its tile in the catalog, not. */
  readonly view: ReactNode;
}

function KindFilter(props: {
  readonly value: ConnectionKind | "all";
  readonly kinds: ReadonlyArray<(typeof KINDS)[number]>;
  readonly onChange: (value: ConnectionKind | "all") => void;
}) {
  const options = [{ value: "all" as const, label: "All" }, ...props.kinds];
  return (
    <div role="radiogroup" aria-label="Kind of connection" className="flex flex-wrap gap-1.5">
      {options.map((kind) => (
        <button
          key={kind.value}
          type="button"
          role="radio"
          aria-checked={props.value === kind.value}
          className={cn(
            "h-7 rounded-full border px-3 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
            props.value === kind.value
              ? "border-primary/40 bg-primary/8 text-foreground"
              : "border-border bg-background text-muted-foreground hover:text-foreground",
          )}
          onClick={() => props.onChange(kind.value)}
        >
          {kind.label}
        </button>
      ))}
    </div>
  );
}

const folded = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** Whether a connection is one a search is for: every word in its name, line or group. */
function matches(connection: Connection, query: string): boolean {
  const words = folded(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const kind = KINDS.find((entry) => entry.value === connection.kind)?.label ?? "";
  const text = folded(`${connection.name} ${connection.what} ${kind}`);
  return words.every((word) => text.includes(word));
}

export function AldoConnectionsPage() {
  const accounts = useAldoAccounts();
  const integrations = useAldoIntegrations();
  const apps = useAldoApps();
  const [kind, setKind] = useState<ConnectionKind | "all">("all");
  const [query, setQuery] = useState("");
  const [byAddress, setByAddress] = useState(false);

  // A search for apps or generators shows their group, where its row is.
  const targetId = useSettingsSearchTargetId();
  useEffect(() => {
    const target = targetId ? SEARCH_TARGET_KINDS[targetId] : undefined;
    if (!target && !targetId?.startsWith("aldo-integration-")) return;
    setQuery("");
    setKind(target ?? "all");
    if (targetId === "aldo-another-app") setByAddress(true);
  }, [targetId]);

  const connections: Connection[] = [];
  const github = accounts.accounts?.github;
  if (accounts.accounts) {
    const connected = github?.connected === true;
    connections.push({
      key: "github",
      kind: "code",
      connected,
      name: "GitHub",
      what: "Clone, push and open pull requests",
      view: connected ? (
        <AldoAccountRow kind="github" account={github} onChanged={accounts.refresh} />
      ) : (
        <AldoConnectionTile
          brand="github"
          name="GitHub"
          what="Clone, push and open pull requests"
          control={
            <AldoAccountButton
              kind="github"
              account={github}
              onConnected={accounts.refresh}
              triggerLabel="Connect"
            />
          }
        />
      ),
    });
    for (const host of ALDO_GIT_HOST_KINDS) {
      const account = accounts.accounts[host];
      if (!account) continue;
      connections.push({
        key: host,
        kind: "code",
        connected: account.connected,
        name: host === "azure" ? "Azure DevOps" : host === "gitlab" ? "GitLab" : "Bitbucket",
        what: "",
        view: (
          <AldoGitHostRow
            kind={host}
            account={account}
            onChanged={accounts.refresh}
            tile={!account.connected}
          />
        ),
      });
    }
  }
  for (const integration of integrations.integrations ?? []) {
    if (integration.kind === "key") {
      connections.push({
        key: integration.provider,
        kind: "media",
        connected: integration.connected,
        ...(integration.connected && integration.error ? { broken: integration.name } : {}),
        name: integration.name,
        what: aldoGeneratorWhat(integration),
        view: (
          <AldoGeneratorRow
            integration={integration}
            onChanged={integrations.refresh}
            tile={!integration.connected}
          />
        ),
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
      name: spec.name,
      what: spec.what,
      view: integration.connected ? (
        <IntegrationRow integration={integration} onChanged={integrations.refresh} />
      ) : (
        <IntegrationTile integration={integration} />
      ),
    });
  }
  for (const app of apps.data?.apps ?? []) {
    connections.push({
      key: `app:${app.id}`,
      kind: PAYMENT_APPS.has(app.name) ? "payments" : "apps",
      connected: true,
      ...(app.status === "failed" ? { broken: app.title } : {}),
      name: app.title,
      what: "",
      view: <AldoAppRow app={app} onChanged={apps.refresh} />,
    });
  }
  for (const entry of apps.data?.catalog ?? []) {
    if (entry.connected) continue;
    connections.push({
      key: `catalog:${entry.name}`,
      kind: PAYMENT_APPS.has(entry.name) ? "payments" : "apps",
      connected: false,
      name: entry.title,
      what: entry.about,
      view: <AldoAppCatalogTile entry={entry} />,
    });
  }

  const loading =
    !accounts.accounts &&
    !accounts.error &&
    integrations.integrations === null &&
    !integrations.unsupported;
  // One that stopped working comes first, and says so on its row.
  const connected = connections
    .filter((connection) => connection.connected)
    .toSorted((a, b) => Number(Boolean(b.broken)) - Number(Boolean(a.broken)));
  const catalog = connections.filter((connection) => !connection.connected);
  const searching = query.trim() !== "";
  // Only the kinds left to connect get a filter; one whose last was just connected shows all.
  const kinds = KINDS.filter((group) =>
    catalog.some((connection) => connection.kind === group.value),
  );
  const shownKind = kinds.some((group) => group.value === kind) ? kind : "all";
  const offered = catalog.filter(
    (connection) =>
      (searching || shownKind === "all" || connection.kind === shownKind) &&
      matches(connection, query),
  );
  const groups = KINDS.flatMap((group) => {
    const tiles = offered.filter((connection) => connection.kind === group.value);
    return tiles.length > 0 ? [{ ...group, tiles }] : [];
  });
  const errors = [accounts.error, integrations.error, apps.error].filter(Boolean);
  const takesAddresses = Boolean(apps.data);

  return (
    <SettingsPageContainer>
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
            Nothing yet. Connect an account below, and your agents can use it as you.
          </p>
        ) : (
          connected.map((connection) => <Fragment key={connection.key}>{connection.view}</Fragment>)
        )}
      </SettingsSection>
      <SettingsSection title="Your agents’ email" icon={<MailIcon className="size-4" />}>
        <AldoAgentInboxRows />
      </SettingsSection>
      <section id="aldo-add-connection" className="relative space-y-3">
        {/* A search for a group that's all connected still lands here, by its anchor. */}
        {GROUP_ANCHORS.filter(([value]) => !groups.some((group) => group.value === value)).map(
          ([, anchor]) => (
            <span key={anchor} id={anchor} aria-hidden="true" className="absolute top-0" />
          ),
        )}
        <div className="flex flex-col gap-3 px-3 sm:px-4">
          <h2 className="flex min-h-7 items-center font-medium text-foreground text-sm">
            Add a connection
          </h2>
          {catalog.length > 0 ? (
            <>
              <InputGroup>
                <InputGroupAddon>
                  <SearchIcon aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  type="search"
                  aria-label="Search connections"
                  placeholder={`Search ${catalog.length} apps and accounts`}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </InputGroup>
              {searching ? null : <KindFilter value={shownKind} kinds={kinds} onChange={setKind} />}
            </>
          ) : null}
        </div>
        {groups.map((group) => (
          <div
            key={group.value}
            id={GROUP_ANCHORS.find(([value]) => value === group.value)?.[1]}
            className="space-y-1.5"
          >
            <p className="px-3 text-xs sm:px-4">
              <span className="font-medium text-foreground">{group.label}</span>{" "}
              <span className="text-muted-foreground">{group.about}</span>
            </p>
            <AldoConnectionGrid>
              {group.tiles.map((connection) => (
                <Fragment key={connection.key}>{connection.view}</Fragment>
              ))}
            </AldoConnectionGrid>
          </div>
        ))}
        {searching && groups.length === 0 ? (
          takesAddresses ? (
            <SettingsGroup>
              <AldoConnectorAddress searched={query} />
            </SettingsGroup>
          ) : (
            <p className="px-3 text-muted-foreground text-sm sm:px-4">
              Nothing here is called “{query.trim()}”.
            </p>
          )
        ) : null}
        {!loading && !searching && catalog.length === 0 ? (
          <p className="px-3 text-muted-foreground text-sm sm:px-4">
            Everything here is connected.
          </p>
        ) : null}
        {!loading && !searching && kind === "media" && integrations.unsupported ? (
          <p className="px-3 text-muted-foreground text-sm sm:px-4">
            Media generators aren’t available on this Aldo server.
          </p>
        ) : null}
        {takesAddresses && !searching ? (
          byAddress ? (
            <SettingsGroup>
              <AldoConnectorAddress />
            </SettingsGroup>
          ) : (
            <p className="px-3 text-muted-foreground text-xs sm:px-4">
              Don’t see your app? Search for it, or{" "}
              <button
                type="button"
                className="rounded-sm text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setByAddress(true)}
              >
                add it by its address
              </button>
              .
            </p>
          )
        ) : null}
      </section>
    </SettingsPageContainer>
  );
}
