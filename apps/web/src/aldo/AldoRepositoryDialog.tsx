import type { SourceControlRepositorySummary } from "@t3tools/contracts";
import { LoaderCircleIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { GitHubRepositoryBrowser } from "../components/GitHubRepositoryBrowser";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { AldoAccountButton, useAldoAccounts } from "./AldoAccountsPanel";
import { isAldoCloud, listAldoRepositories } from "./cloud";
import { startAldoSandbox } from "./threads";

const OPEN_EVENT = "aldo:open-repository-picker";

/** Opens the "start a thread in a repository" picker. */
export function openAldoRepositoryPicker(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function AldoRepositoryDialog() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!isAldoCloud) return;
    const handleOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_EVENT, handleOpen);
  }, []);
  if (!isAldoCloud) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {open ? <RepositoryPicker onDone={() => setOpen(false)} /> : null}
    </Dialog>
  );
}

function RepositoryPicker(props: { readonly onDone: () => void }) {
  const { accounts, refresh: refreshAccounts } = useAldoAccounts();
  const githubConnected = accounts?.github.connected === true;
  const handleNewThread = useNewThreadHandler();
  const [repositories, setRepositories] = useState<ReadonlyArray<SourceControlRepositorySummary>>(
    [],
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [starting, setStarting] = useState<string | null>(null);

  const load = useCallback(() => {
    setIsLoading(true);
    setError(null);
    listAldoRepositories()
      .then(setRepositories)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (githubConnected) load();
  }, [githubConnected, load]);

  const start = async (nameWithOwner: string) => {
    setStarting(nameWithOwner);
    setError(null);
    try {
      const projectRef = await startAldoSandbox({ repo: nameWithOwner }, nameWithOwner);
      props.onDone();
      await handleNewThread(projectRef);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStarting(null);
    }
  };

  return (
    <DialogPopup className="flex max-h-[min(720px,calc(100dvh-2rem))] w-[min(640px,calc(100vw-2rem))] flex-col">
      <DialogHeader>
        <DialogTitle>Start a thread</DialogTitle>
        <DialogDescription>
          Pick a repository. The thread gets its own sandbox with a fresh clone on a new branch.
        </DialogDescription>
      </DialogHeader>
      {accounts === null ? (
        <DialogPanel>
          <LoaderCircleIcon className="mx-auto size-5 animate-spin text-muted-foreground" />
        </DialogPanel>
      ) : !githubConnected ? (
        <DialogPanel className="flex flex-col items-start gap-3">
          <p className="text-muted-foreground text-sm">
            Connect GitHub so threads can clone your repositories and open pull requests.
          </p>
          <AldoAccountButton
            kind="github"
            account={accounts.github}
            onConnected={refreshAccounts}
            triggerLabel="Connect GitHub"
          />
        </DialogPanel>
      ) : (
        <>
          <div className="px-4 pb-2 sm:px-6">
            <Input
              id="aldo-repository-search"
              autoFocus
              placeholder="Search your repositories, or type owner/name"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={starting !== null}
            />
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <GitHubRepositoryBrowser
              repositories={repositories}
              query={query}
              isLoading={isLoading}
              error={error}
              activeRepository={starting}
              projectForRepository={() => null}
              onClone={(repository) => void start(repository.nameWithOwner)}
              onSync={() => undefined}
              onRefresh={load}
              onManualLookup={() => void start(query.trim())}
            />
          </div>
          {starting ? (
            <div className="flex items-center gap-2 border-t px-6 py-3 text-muted-foreground text-sm">
              <LoaderCircleIcon className="size-4 animate-spin" />
              Starting a sandbox for {starting}…
              <Button className="ml-auto" size="sm" variant="ghost" onClick={props.onDone}>
                Hide
              </Button>
            </div>
          ) : null}
        </>
      )}
    </DialogPopup>
  );
}
