import { settingsApps } from "./settingsData";
import { useSettingsResource } from "./settingsResource";
// Settings → Connections' apps: any app with a remote MCP server, connected
// for every agent (Notion, Linear, Zapier and through it thousands more, or
// one by its URL). Connecting signs in with the app in a popup, through Aldo,
// which keeps the sign-in; its last page reports back here (apps.logic.ts),
// over the integrations' channel too. A server without apps shows nothing.

import { CheckCircle2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { SettingsRow } from "../components/settings/settingsLayout";
import { AldoBrandTile } from "./AldoBrandTile";
import { AldoBrokenStatus } from "./AldoConnectionStatus";
import { AldoConnectionTile } from "./AldoConnectionTile";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toastManager } from "../components/ui/toast";
import {
  aldoAppConnectUrl,
  disconnectAldoApp,
  type AldoApp,
  type AldoAppCatalogEntry,
} from "./accountApi";
import {
  aldoAppResultFilter,
  normalizeAldoAppUrl,
  parseAldoAppMessage,
  parseAldoAppRedirect,
  withoutAldoAppRedirect,
  type AldoAppResult,
} from "./apps.logic";
import { ALDO_INTEGRATIONS_CHANNEL } from "./integrations.logic";

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

function toastFailure(result: AldoAppResult) {
  toastManager.add({
    type: "error",
    title: "Couldn't connect the app",
    description: result.message ?? "The sign-in didn't finish. Try again.",
  });
}

function signIn(url: string) {
  // With the popup blocked, sign in in this tab: Aldo's last page goes back to Settings.
  if (!window.open(url, "aldo-app", "popup,width=520,height=760")) window.location.assign(url);
}

export function AldoAppRow(props: { readonly app: AldoApp; readonly onChanged: () => void }) {
  const { app } = props;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const disconnect = () => {
    setBusy(true);
    disconnectAldoApp(app.id)
      .catch((cause: unknown) =>
        toastManager.add({
          type: "error",
          title: `Couldn't disconnect ${app.title}`,
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
      id={`aldo-app-${app.id}`}
      leading={<AldoBrandTile id={app.name} name={app.title} />}
      title={app.title}
      description={new URL(app.url).host}
      status={
        app.status === "failed" ? (
          <AldoBrokenStatus since={app.changedAt}>{app.error}</AldoBrokenStatus>
        ) : app.status === "connected" ? (
          <span className="inline-flex items-center gap-1 text-success-foreground">
            <CheckCircle2Icon className="size-3.5" />
            Connected: every agent can use it
          </span>
        ) : (
          "Sign-in not finished"
        )
      }
      control={
        <div className="flex flex-wrap gap-2 sm:flex-col sm:items-stretch">
          {app.status !== "connected" ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => signIn(aldoAppConnectUrl({ url: app.url }))}
            >
              {app.status === "failed" ? "Reconnect" : "Connect again"}
            </Button>
          ) : null}
          {confirming ? (
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
          )}
        </div>
      }
    />
  );
}

/** An app in the catalog, as a tile, with its Connect. */
export function AldoAppCatalogTile(props: { readonly entry: AldoAppCatalogEntry }) {
  const { entry } = props;
  return (
    <AldoConnectionTile
      brand={entry.name}
      name={entry.title}
      what={entry.about}
      control={
        <Button
          size="compact"
          variant="outline"
          onClick={() => signIn(aldoAppConnectUrl({ app: entry.name }))}
        >
          Connect
        </Button>
      }
    />
  );
}

/**
 * The user's apps and the catalog: undefined while they're read, null on an
 * Aldo without apps. Read again when a sign-in reports back (in a popup, or
 * in this tab when the popup was blocked) and when the user comes back.
 */
export function useAldoApps() {
  const { data, error } = useSettingsResource(settingsApps, true, false);
  const refresh = useCallback(() => {
    void settingsApps.refresh().catch(() => undefined);
  }, []);

  useEffect(() => {
    // Back from a sign-in that ran in this tab (the popup was blocked).
    const redirected = parseAldoAppRedirect(window.location.search);
    if (redirected) {
      // On a fresh page load the toasts start listening after this section mounts.
      if (!redirected.ok) window.setTimeout(() => toastFailure(redirected), 0);
      const { pathname, search, hash } = window.location;
      window.history.replaceState(
        window.history.state,
        "",
        `${pathname}${withoutAldoAppRedirect(search)}${hash}`,
      );
    }
  }, []);

  useEffect(() => {
    // The popup's page posts to its opener and on the channel: each result is told once.
    const isNew = aldoAppResultFilter();
    const settle = (payload: unknown) => {
      const result = parseAldoAppMessage(payload);
      if (!result || !isNew(result, Date.now())) return;
      if (!result.ok) toastFailure(result);
      refresh();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin) settle(event.data);
    };
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(ALDO_INTEGRATIONS_CHANNEL);
    channel?.addEventListener("message", (event) => settle(event.data));
    window.addEventListener("message", onMessage);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("focus", refresh);
      channel?.close();
    };
  }, [refresh]);

  return { data, error, refresh };
}

/**
 * Any app with a remote MCP server, by its address: offered where the catalog
 * has no app by the name searched for (`searched`), or asked for under it.
 */
export function AldoConnectorAddress(props: { readonly searched?: string }) {
  const [typed, setTyped] = useState("");
  const url = normalizeAldoAppUrl(typed);
  const searched = props.searched?.trim();
  return (
    <div id="aldo-another-app" className="space-y-3 px-3 py-4 sm:px-4">
      <div className="space-y-1">
        <p className="text-foreground text-sm">
          {searched ? `No app called “${searched}” here yet.` : "Add an app by its address"}
        </p>
        <p className="text-muted-foreground text-xs">
          {searched
            ? "If it gives you a connector address (an MCP server’s, often ending in /mcp), paste it here and your agents can use it."
            : "Any app with a connector address (an MCP server’s, often ending in /mcp)."}
        </p>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (url) signIn(aldoAppConnectUrl({ url }));
        }}
      >
        <Input
          aria-label="Connector address"
          placeholder="https://mcp.example.com/mcp"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
        <Button size="sm" type="submit" disabled={!url}>
          Connect
        </Button>
      </form>
    </div>
  );
}
