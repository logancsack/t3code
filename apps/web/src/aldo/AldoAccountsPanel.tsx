import { CheckCircle2Icon } from "lucide-react";
import { useCallback, type ReactNode } from "react";

import { AuthConnectorDialog } from "../components/settings/AuthConnectorDialog";
import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import { disconnectAldoAccount, type AldoAccount, type AldoAccountKind } from "./cloud";
import { settingsAccounts, settingsRepositories } from "./settingsData";
import { useSettingsResource } from "./settingsResource";
import { ALDO_ACCOUNT_SPECS } from "./accountSpecs";

export { ALDO_ACCOUNT_SPECS };

export function useAldoAccounts() {
  const { data, error } = useSettingsResource(settingsAccounts);
  const refresh = useCallback(() => {
    void settingsAccounts.refresh().catch(() => undefined);
    void settingsRepositories.refresh().catch(() => undefined);
  }, []);
  return { accounts: data ?? null, error, refresh };
}

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
  if (!account.connected) return "Not connected";
  return (
    <span className="inline-flex items-center gap-1 text-success-foreground">
      <CheckCircle2Icon className="size-3.5" />
      Connected{account.account ? ` as ${account.account}` : ""}
      {account.plan ? ` · ${account.plan}` : ""}
    </span>
  );
}

/** One account the user signs in to with its wizard: its status, Disconnect and Connect. */
export function AldoAccountRow(props: {
  readonly kind: AldoAccountKind;
  readonly account: AldoAccount | undefined;
  readonly onChanged: () => void;
}) {
  const spec = ALDO_ACCOUNT_SPECS[props.kind];
  const { account } = props;
  return (
    <SettingsRow
      id={`aldo-account-${props.kind}`}
      title={spec.title}
      description={spec.description}
      status={accountStatus(account)}
      control={
        <>
          {account?.connected ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void disconnectAldoAccount(props.kind).then(props.onChanged)}
            >
              Disconnect
            </Button>
          ) : null}
          <AldoAccountButton kind={props.kind} account={account} onConnected={props.onChanged} />
        </>
      }
    />
  );
}

/** Account connections shared by every thread's sandbox. */
export function AldoAccountsPanel(props: {
  readonly kinds: ReadonlyArray<AldoAccountKind>;
  readonly title: string;
  readonly id?: string;
  readonly icon?: ReactNode;
}) {
  const { accounts, error, refresh } = useAldoAccounts();
  return (
    <SettingsSection
      title={props.title}
      {...(props.id ? { id: props.id } : {})}
      {...(props.icon ? { icon: props.icon } : {})}
    >
      {/* Only what Aldo connects: an older Aldo doesn't list Muse Code, so it waits for the list. */}
      {props.kinds
        .filter((kind) => (accounts ? kind in accounts : kind !== "muse"))
        .map((kind) => (
          <AldoAccountRow key={kind} kind={kind} account={accounts?.[kind]} onChanged={refresh} />
        ))}
      {error ? <p className="px-4 text-destructive-foreground text-sm">{error}</p> : null}
    </SettingsSection>
  );
}
