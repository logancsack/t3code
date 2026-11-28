import { CheckCircle2Icon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { AuthConnectorDialog } from "../components/settings/AuthConnectorDialog";
import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import { toastManager } from "../components/ui/toast";
import { disconnectAldoAccount, type AldoAccount, type AldoAccountKind } from "./accountApi";
import { AldoBrandTile } from "./AldoBrandTile";
import { useAldoAccounts } from "./useAldoAccounts";
import { ALDO_ACCOUNT_SPECS } from "./accountSpecs";

export function AldoAccountButton(props: {
  readonly kind: AldoAccountKind;
  readonly account: AldoAccount | undefined;
  readonly onConnected: () => void;
  readonly triggerLabel?: string;
}) {
  const spec = ALDO_ACCOUNT_SPECS[props.kind];
  return (
    <AuthConnectorDialog
      connector={spec.kind}
      serviceName={spec.serviceName}
      methods={[spec.method]}
      isAuthenticated={props.account?.connected === true}
      onConnected={props.onConnected}
      {...(props.triggerLabel ? { triggerLabel: props.triggerLabel } : {})}
    />
  );
}

function accountStatus(account: AldoAccount | undefined) {
  if (!account) return "Checking…";
  // Its Connect button says it.
  if (!account.connected) return null;
  return (
    <span className="inline-flex items-center gap-1 text-success-foreground">
      <CheckCircle2Icon className="size-3.5" />
      Connected{account.account ? ` as ${account.account}` : ""}
      {account.plan ? ` · ${account.plan}` : ""}
    </span>
  );
}

/** One account the user signs in to with its wizard: its status, confirmed Disconnect and Connect. */
export function AldoAccountRow(props: {
  readonly kind: AldoAccountKind;
  readonly account: AldoAccount | undefined;
  readonly onChanged: () => void;
}) {
  const spec = ALDO_ACCOUNT_SPECS[props.kind];
  const { account } = props;
  const [confirming, setConfirming] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnectAldoAccount(props.kind);
      setConfirming(false);
      props.onChanged();
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: `Couldn’t disconnect ${spec.title}`,
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <SettingsRow
      id={`aldo-account-${props.kind}`}
      leading={<AldoBrandTile id={props.kind} name={spec.title} />}
      title={spec.title}
      description={spec.description}
      status={accountStatus(account)}
      inline
      control={
        confirming && account?.connected ? (
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
            {account?.connected ? (
              <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
                Disconnect
              </Button>
            ) : null}
            <AldoAccountButton kind={props.kind} account={account} onConnected={props.onChanged} />
          </>
        )
      }
    />
  );
}

/** Account connections shared by every thread's computer. */
export function AldoAccountsPanel(props: {
  readonly kinds: ReadonlyArray<AldoAccountKind>;
  readonly title: string;
  readonly id?: string;
  readonly icon?: ReactNode;
  /** A line above the rows: what they're for. */
  readonly about?: string | null;
  /** Rows before the accounts' (Aldo's own models). */
  readonly before?: ReactNode;
  /** Rows after the accounts' (e.g. Google Antigravity). */
  readonly after?: ReactNode;
}) {
  const { accounts, error, refresh } = useAldoAccounts();
  return (
    <SettingsSection
      title={props.title}
      {...(props.id ? { id: props.id } : {})}
      {...(props.icon ? { icon: props.icon } : {})}
    >
      {props.about ? (
        <p className="px-3 pt-3 pb-1 text-muted-foreground text-xs sm:px-4">{props.about}</p>
      ) : null}
      {props.before}
      {/* Only what Aldo connects: an older Aldo doesn't list Muse Code, so it waits for the list. */}
      {props.kinds
        .filter((kind) => (accounts ? kind in accounts : kind !== "muse"))
        .map((kind) => (
          <AldoAccountRow key={kind} kind={kind} account={accounts?.[kind]} onChanged={refresh} />
        ))}
      {props.after}
      {error ? <p className="px-4 text-destructive-foreground text-sm">{error}</p> : null}
    </SettingsSection>
  );
}
