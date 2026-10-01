import { KeyRoundIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { toastManager } from "../components/ui/toast";
import { aldoVault } from "./cloud";
import { aldoLoginSite, aldoLoginToSave, type AldoLoginOffer } from "./loginOffers.logic";

const EVERY_THREAD = "*";

/**
 * Offers to save a login the user just signed in with in the shared browser,
 * so agents in other threads can sign in with it (fill_login) and nobody signs
 * in again. A strip above the page (and the desktop) that doesn't block it;
 * saving takes the password from the machine and saves it as the user.
 */
export function AldoLoginOfferCard(props: {
  offer: AldoLoginOffer;
  /** The thread's repositories, for saving a login for one of them only. */
  repos: ReadonlyArray<string>;
  /** The offer's password, from the machine: asked for only once the user chose Save. */
  password: () => Promise<string>;
  onDone: (saved: boolean) => void;
  onNever: () => void;
}) {
  const { offer } = props;
  const [scope, setScope] = useState(EVERY_THREAD);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = offer.saved;
  const site = aldoLoginSite(offer.origin);
  const threads =
    (update?.scope ?? scope) === EVERY_THREAD ? "every thread" : "this repository's threads";

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await aldoVault.saveLogin(aldoLoginToSave(offer, await props.password(), scope));
      toastManager.add({
        type: "success",
        title: update ? `Updated the password for ${update.label}` : `Saved your ${site} login`,
        description: `Agents in ${threads} sign in with it from now on; it's in Settings → Vault.`,
        timeout: 6000,
      });
      props.onDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="region"
      aria-label={update ? "Update saved login" : "Save login"}
      className="shrink-0 space-y-2 border-b border-border bg-primary/8 px-3 py-2 text-sm"
    >
      <div className="flex items-start gap-2">
        <KeyRoundIcon className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {update
              ? `Update the saved password for ${update.label}?`
              : "Save this login to your vault?"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {site}
            {offer.username ? ` · ${offer.username}` : ""}
          </p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Agents in {threads} can then sign in with it without anyone typing it again. They never see
        the password.
      </p>
      {!update && props.repos.length > 0 ? (
        <Select value={scope} onValueChange={(value) => setScope(String(value))}>
          <SelectTrigger className="h-8 w-full max-w-72 text-xs" aria-label="Which threads get it">
            <SelectValue>{scope === EVERY_THREAD ? "All threads" : `Only ${scope}`}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="start" alignItemWithTrigger={false}>
            <SelectItem value={EVERY_THREAD}>All threads</SelectItem>
            {props.repos.map((repo) => (
              <SelectItem key={repo} value={repo}>
                Only {repo}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      ) : null}
      {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-1">
        {!update ? (
          <Button
            type="button"
            size="compact"
            variant="ghost"
            disabled={busy}
            onClick={props.onNever}
          >
            Never for this site
          </Button>
        ) : null}
        <Button
          type="button"
          size="compact"
          variant="ghost"
          disabled={busy}
          onClick={() => props.onDone(false)}
        >
          Not now
        </Button>
        <Button type="button" size="compact" disabled={busy} onClick={() => void save()}>
          {update ? "Update" : "Save"}
        </Button>
      </div>
    </div>
  );
}
