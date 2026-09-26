import { CheckCircle2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AuthConnectorDialog } from "../components/settings/AuthConnectorDialog";
import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import {
  disconnectAldoAccount,
  fetchAldoAccounts,
  type AldoAccount,
  type AldoAccountKind,
} from "./cloud";
import { ALDO_ACCOUNT_SPECS } from "./accountSpecs";

export { ALDO_ACCOUNT_SPECS };

export function useAldoAccounts() {
  const [accounts, setAccounts] = useState<Record<AldoAccountKind, AldoAccount> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    fetchAldoAccounts()
      .then((next) => {
        setAccounts(next);
        setError(null);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { accounts, error, refresh };
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

/** Account connections shared by every thread's sandbox. */
export function AldoAccountsPanel(props: {
  readonly kinds: ReadonlyArray<AldoAccountKind>;
  readonly title: string;
}) {
  const { accounts, error, refresh } = useAldoAccounts();
  return (
    <SettingsSection title={props.title}>
      {props.kinds.map((kind) => {
        const spec = ALDO_ACCOUNT_SPECS[kind];
        const account = accounts?.[kind];
        return (
          <SettingsRow
            key={kind}
            title={spec.title}
            description={spec.description}
            status={accountStatus(account)}
            control={
              <>
                {account?.connected ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void disconnectAldoAccount(kind).then(refresh)}
                  >
                    Disconnect
                  </Button>
                ) : null}
                <AldoAccountButton kind={kind} account={account} onConnected={refresh} />
              </>
            }
          />
        );
      })}
      {error ? <p className="px-4 text-destructive-foreground text-sm">{error}</p> : null}
    </SettingsSection>
  );
}
