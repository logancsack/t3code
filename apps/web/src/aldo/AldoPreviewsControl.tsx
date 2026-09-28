import {
  AppWindowIcon,
  ExternalLinkIcon,
  GitMergeIcon,
  LoaderIcon,
  PanelRightIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../components/ui/menu";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Button } from "../components/ui/button";
import { toastManager } from "../components/ui/toast";
import { AldoMachineMenuSection, useAldoMachineOffer } from "./AldoMachine";
import { useAldoBrowserRequests } from "./browserStore";
import {
  aldoPreviewUrl,
  fetchAldoPreviews,
  fetchAldoPullRequests,
  mergeAldoPullRequest,
  stopAldoFollowThrough,
  type AldoFollowedPullRequest,
  type AldoPreviews,
  aldoMachineIsNew,
  aldoOfflineMessage,
} from "./cloud";
import {
  aldoPullRequestMergeable,
  aldoPullRequestShortRef,
  aldoPullRequestStatusLabel,
} from "./pullRequests.logic";

function label(command: string, process: string): string {
  const text = command || process;
  return text.length > 48 ? `${text.slice(0, 47)}…` : text;
}

/**
 * The thread's dev servers: open one in the shared browser, or in a new tab
 * through its owner-only preview link (works from any device, wakes the thread).
 */
export function AldoPreviewsControl(props: { environmentId: string; onOpenBrowser: () => void }) {
  useAldoMachineOffer(props.environmentId);
  const [previews, setPreviews] = useState<AldoPreviews | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pullRequests, setPullRequests] = useState<ReadonlyArray<AldoFollowedPullRequest>>([]);
  // The pull request whose Merge was chosen, waiting for the user to confirm.
  const [confirmMerge, setConfirmMerge] = useState<AldoFollowedPullRequest | null>(null);
  // The thread whose answers are wanted: one for a thread left since is dropped.
  const current = useRef(props.environmentId);

  useEffect(() => {
    current.current = props.environmentId;
    setPreviews(null);
    setPullRequests([]);
    setError(null);
    setLoading(false);
  }, [props.environmentId]);

  const refresh = useCallback(() => {
    const environmentId = props.environmentId;
    const stillCurrent = () => current.current === environmentId;
    setLoading(true);
    fetchAldoPullRequests(environmentId)
      .then((next) => stillCurrent() && setPullRequests(next))
      .catch(() => undefined);
    fetchAldoPreviews(environmentId)
      .then((next) => {
        if (!stillCurrent()) return;
        setPreviews(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (stillCurrent()) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (stillCurrent()) setLoading(false);
      });
  }, [props.environmentId]);

  const openInBrowser = (port: number) => {
    useAldoBrowserRequests.getState().openUrl(props.environmentId, `http://localhost:${port}`);
    props.onOpenBrowser();
  };

  const merge = (pr: AldoFollowedPullRequest) =>
    void mergeAldoPullRequest(props.environmentId, pr)
      .then(() =>
        toastManager.add({
          type: "success",
          title: `Merged ${aldoPullRequestShortRef(pr, pullRequests)}`,
          description: "Aldo follows its deploy and tells the agent how it went.",
        }),
      )
      .catch((cause: unknown) =>
        toastManager.add({
          type: "error",
          title: `Couldn't merge ${aldoPullRequestShortRef(pr, pullRequests)}`,
          description: cause instanceof Error ? cause.message : String(cause),
        }),
      )
      .finally(refresh);

  const ports = previews?.ports ?? [];
  const stopped = (previews?.services ?? []).filter((s) => !s.running);

  return (
    <Menu onOpenChange={(open) => open && refresh()}>
      <MenuTrigger
        aria-label="Previews"
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <AppWindowIcon className="size-3.5" />
        <span className="hidden @3xl/header-actions:inline">Preview</span>
      </MenuTrigger>
      <MenuPopup align="end" className="w-80">
        {loading && !previews ? (
          <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
            <LoaderIcon className="size-3.5 animate-spin" /> Looking for dev servers…
          </div>
        ) : error ? (
          <div className="px-2 py-3 text-xs text-destructive-foreground">{error}</div>
        ) : previews && !previews.running ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">
            {aldoMachineIsNew(props.environmentId)
              ? aldoOfflineMessage(props.environmentId)
              : "This cloud agent is asleep. Opening a preview's link reconnects it."}
          </div>
        ) : ports.length === 0 ? (
          <div className="space-y-1 px-2 py-3 text-xs text-muted-foreground">
            <p>No dev servers are running.</p>
            <p>
              Ask the agent to start one. It keeps it running across sleeps and shares a preview
              link.
            </p>
          </div>
        ) : (
          ports.map((port, index) => (
            <MenuGroup key={port.port}>
              {index > 0 ? <MenuSeparator /> : null}
              <MenuGroupLabel className="flex items-baseline gap-2">
                <span className="font-medium text-foreground">localhost:{port.port}</span>
                <span className="min-w-0 truncate font-normal">
                  {label(port.command, port.process)}
                </span>
              </MenuGroupLabel>
              <MenuItem onClick={() => openInBrowser(port.port)}>
                <PanelRightIcon className="size-3.5" /> Open in the Browser panel
              </MenuItem>
              <MenuItem
                onClick={() =>
                  window.open(aldoPreviewUrl(props.environmentId, port.port), "_blank", "noopener")
                }
              >
                <ExternalLinkIcon className="size-3.5" /> Open in a new tab
              </MenuItem>
            </MenuGroup>
          ))
        )}
        {pullRequests.length > 0 ? (
          <>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Pull requests Aldo follows through</MenuGroupLabel>
              {pullRequests.slice(0, 6).map((pr) => (
                <MenuItem
                  key={`${pr.repo}#${pr.number}`}
                  onClick={() => window.open(pr.url, "_blank", "noopener")}
                >
                  <span className="min-w-0 flex-1 truncate">
                    #{pr.number} {pr.title}
                  </span>
                  <span className="shrink-0 text-muted-foreground text-xs">
                    {aldoPullRequestStatusLabel(pr)}
                  </span>
                </MenuItem>
              ))}
              {pullRequests
                .slice(0, 6)
                .filter(aldoPullRequestMergeable)
                .map((pr) => (
                  <MenuItem
                    key={`merge:${pr.repo}#${pr.number}`}
                    onClick={() => setConfirmMerge(pr)}
                  >
                    <GitMergeIcon className="size-3.5" /> Merge{" "}
                    {aldoPullRequestShortRef(pr, pullRequests)}
                  </MenuItem>
                ))}
              {pullRequests.some((pr) => pr.status === "watching") ? (
                <MenuItem
                  onClick={() => void stopAldoFollowThrough(props.environmentId).then(refresh)}
                  className="text-muted-foreground"
                >
                  Stop following through
                </MenuItem>
              ) : null}
            </MenuGroup>
          </>
        ) : null}
        {stopped.length > 0 ? (
          <>
            <MenuSeparator />
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              Restarting: {stopped.map((s) => s.name).join(", ")}
            </div>
          </>
        ) : null}
        <MenuSeparator />
        <AldoMachineMenuSection environmentId={props.environmentId} />
      </MenuPopup>
      <AlertDialog
        open={confirmMerge !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmMerge(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge pull request?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmMerge
                ? `This merges ${confirmMerge.repo}#${confirmMerge.number}, "${confirmMerge.title}", at the commit whose checks passed. Aldo checks it again first, then follows its deploy and tells the agent how it went.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              Cancel
            </AlertDialogClose>
            <Button
              size="sm"
              onClick={() => {
                const pr = confirmMerge;
                setConfirmMerge(null);
                if (pr) merge(pr);
              }}
            >
              Merge
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </Menu>
  );
}
