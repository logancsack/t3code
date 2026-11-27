import { useState } from "react";

import { AuthConnectorDialog } from "../components/settings/AuthConnectorDialog";
import { AGENT_AUTH_METHODS } from "../components/settings/authConnectorMethods";
import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import { AldoBrandTile } from "./AldoBrandTile";
import { AldoPolicyRuleRow, useAldoPolicy } from "./AldoPolicy";
import { disconnectAldoAccount } from "./accountApi";
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

export function AldoAgentConnections() {
  const { accounts, refresh } = useAldoAccounts();
  const policy = useAldoPolicy();
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const disconnect = async (kind: "antigravity" | `opencode:${string}`) => {
    setDisconnecting(kind);
    setError(null);
    try {
      await disconnectAldoAccount(kind);
      refresh();
    } catch {
      setError("Couldn't disconnect this account. Try again.");
    } finally {
      setDisconnecting(null);
    }
  };
  if (!accounts?.opencode && !accounts?.antigravity) return null;
  const methods = accounts.opencode?.methods ?? [];
  const offered = [GO, ...(AGENT_AUTH_METHODS.opencode?.methods ?? [])].filter((option) =>
    methods.some((method) => method.method === option.method),
  );
  return (
    <SettingsSection title="Provider accounts">
      {accounts.opencode ? (
        <SettingsRow
          id="aldo-account-opencode"
          leading={<AldoBrandTile id="opencode" name="OpenCode" />}
          title="OpenCode"
          description="Use OpenCode models with your own key. Your provider may bill you for usage."
          status={accounts.opencode.connected ? "Connected" : undefined}
          inline
          control={
            <AuthConnectorDialog
              connector="opencode"
              serviceName="OpenCode"
              methods={offered}
              isAuthenticated={accounts.opencode.connected}
              accountScoped
              triggerLabel={accounts.opencode.connected ? "Manage keys" : "Connect OpenCode"}
              onConnected={refresh}
            />
          }
        />
      ) : null}
      {methods
        .filter((method) => method.connected)
        .map(({ method, kind }) => (
          <SettingsRow
            key={kind}
            title={offered.find((option) => option.method === method)?.label ?? "OpenCode key"}
            status="Connected"
            inline
            control={
              kind.startsWith("opencode:") ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disconnecting !== null}
                  onClick={() => void disconnect(kind as `opencode:${string}`)}
                >
                  {disconnecting === kind ? "Disconnecting…" : "Disconnect"}
                </Button>
              ) : null
            }
          />
        ))}
      {accounts.antigravity ? (
        <SettingsRow
          id="aldo-account-antigravity"
          leading={<AldoBrandTile id="antigravity" name="Google Antigravity" />}
          title="Google Antigravity"
          description="Use the models and limits available on your Google account."
          status={accounts.antigravity.connected ? "Connected" : undefined}
          inline
          control={
            <>
              {accounts.antigravity.connected ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disconnecting !== null}
                  onClick={() => void disconnect("antigravity")}
                >
                  {disconnecting === "antigravity" ? "Disconnecting…" : "Disconnect"}
                </Button>
              ) : null}
              <AuthConnectorDialog
                connector="antigravity"
                serviceName="Google Antigravity"
                methods={[GOOGLE]}
                isAuthenticated={accounts.antigravity.connected}
                accountScoped
                triggerLabel={accounts.antigravity.connected ? "Reconnect" : "Sign in with Google"}
                onConnected={refresh}
              />
            </>
          }
        />
      ) : null}
      {accounts.opencode?.connected ? (
        <AldoPolicyRuleRow
          rule="paidConnectedModels"
          setting="aldo-paid-connected-models"
          policy={policy}
          description="Let Automatic choose models that can charge your OpenCode or API account, including when a model fails."
        />
      ) : null}
      {error ? (
        <p role="alert" className="px-4 py-2 text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </SettingsSection>
  );
}
