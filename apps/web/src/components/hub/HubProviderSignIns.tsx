import type {
  AuthConnectorKind,
  EnvironmentId,
  ProviderSignIn,
  ProviderSignInList,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { LogOutIcon } from "lucide-react";
import { useState } from "react";

import { readLocalApi } from "../../localApi";
import { useEnvironmentQuery } from "../../state/query";
import { sourceControlEnvironment } from "../../state/sourceControl";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Hub mode: the provider sign-ins stored for thread machines. Pass `null` off
 * a hub; standalone servers do not answer the call.
 */
export function useHubProviderSignIns(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(
    environmentId ? sourceControlEnvironment.providerSignIns({ environmentId, input: {} }) : null,
  );
}

export function providerSignInFor(
  list: ProviderSignInList | null,
  connector: AuthConnectorKind,
): ProviderSignIn | null {
  return list?.signIns.find((signIn) => signIn.connector === connector) ?? null;
}

/** Tooltip for a stored sign-in. Stored is not proof of a valid login; the provider's status is. */
export function describeProviderSignIn(serviceName: string, signIn: ProviderSignIn): string {
  const saved = signIn.updatedAt ? formatRelativeTimeLabel(signIn.updatedAt) : "";
  return [
    `Your ${serviceName} sign-in is saved${saved ? ` (${saved})` : ""}.`,
    "Every thread machine starts signed in.",
  ].join(" ");
}

/**
 * Shows that a provider is signed in on thread machines, with a confirmed
 * sign-out. Renders nothing when no sign-in is stored.
 */
export function HubProviderSignInStatus(props: {
  readonly environmentId: EnvironmentId;
  readonly connector: AuthConnectorKind;
  readonly serviceName: string;
  readonly signIn: ProviderSignIn | null;
  readonly onSignedOut: () => void;
}) {
  const { environmentId, connector, serviceName, signIn, onSignedOut } = props;
  const signOut = useAtomCommand(sourceControlEnvironment.signOutProvider, {
    reportFailure: false,
  });
  const [signingOut, setSigningOut] = useState(false);
  if (signIn === null) return null;

  const confirmAndSignOut = async () => {
    const api = readLocalApi();
    const message = [
      `Sign out of ${serviceName} on thread machines?`,
      "Running machines drop the sign-in within seconds; sign in again to use it.",
    ].join("\n");
    const confirmed = api
      ? await api.dialogs.confirm(message, { variant: "destructive" }).catch(() => false)
      : window.confirm(message);
    if (!confirmed) return;
    setSigningOut(true);
    const result = await signOut({ environmentId, input: { connector } });
    setSigningOut(false);
    if (result._tag === "Success") {
      toastManager.add({ type: "success", title: `Signed out of ${serviceName}` });
      onSignedOut();
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: `Could not sign out of ${serviceName}`,
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
  };

  return (
    <span className="inline-flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger render={<Badge variant="success" size="sm" />}>
          Signed in on machines
        </TooltipTrigger>
        <TooltipPopup side="top" className="max-w-64 whitespace-normal">
          {describeProviderSignIn(serviceName, signIn)}
        </TooltipPopup>
      </Tooltip>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 gap-1.5 px-2.5 text-xs"
        disabled={signingOut}
        onClick={() => void confirmAndSignOut()}
      >
        <LogOutIcon className="size-3.5" />
        {signingOut ? "Signing out…" : "Sign out"}
      </Button>
    </span>
  );
}
