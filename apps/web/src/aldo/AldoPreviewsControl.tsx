import {
  ChevronDownIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  MonitorIcon,
  PanelRightIcon,
  SquareTerminalIcon,
} from "lucide-react";
import type { ThreadId } from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { PullRequestGlyph } from "../components/pullRequest/pullRequestIcons";
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
import { cn } from "../lib/utils";
import { AldoGpuComputerControl, useAldoComputerAsk } from "./AldoComputer";
import { AldoMachineMenuSection, useAldoMachineOffer } from "./AldoMachine";
import { useAldoBrowserRequests } from "./browserStore";
import { aldoCostLine, type AldoCost } from "./costs.logic";
import {
  aldoPreviewUrl,
  fetchAldoCost,
  fetchAldoPreviews,
  fetchAldoPullRequests,
  mergeAldoPullRequest,
  stopAldoFollowThrough,
  type AldoFollowedPullRequest,
  type AldoPreviews,
} from "./workspaceApi";
import { sameTarget } from "./home.logic";
import { useAldoHomeRead } from "./homeFeed";
import {
  aldoPullRequestMergeable,
  aldoPullRequestShortRef,
  aldoPullRequestStatusLabel,
} from "./pullRequests.logic";

function label(command: string, process: string): string {
  const text = command || process;
  return text.length > 48 ? `${text.slice(0, 47)}…` : text;
}

/** A 36px control whose touch target reaches 48px, so a phone's header row stays compact. */
export const aldoHeaderControl =
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground outline-none after:absolute after:-inset-1.5 hover:bg-accent hover:text-foreground active:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent";

/**
 * The thread's dev servers: open one in the shared browser, or in a new tab
 * through its owner-only preview link (works from any device, wakes the thread).
 * The header places what it renders: Preview (null with nothing to preview),
 * the thread's tools menu and a starting or running GPU computer.
 */
export function AldoPreviewsControl(props: {
  environmentId: string;
  /** The thread shown, where the thread's asks appear. */
  threadId: ThreadId;
  onOpenBrowser: () => void;
  /** Phones reach the right panel (files, terminal, changes) from the tools menu. */
  workspace?: { readonly label: string; readonly open: () => void } | undefined;
  /** Preview as an icon, when an urgent control needs the room. */
  compactPreview?: boolean;
  children: (controls: { gpu: ReactNode; preview: ReactNode; tools: ReactNode }) => ReactNode;
}) {
  useAldoMachineOffer(props.environmentId);
  useAldoComputerAsk(props.environmentId, props.threadId);
  const [previews, setPreviews] = useState<AldoPreviews | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { home } = useAldoHomeRead();
  const browsing = home?.conversations.find((c) =>
    sameTarget(c.thread, { environmentId: props.environmentId, threadId: props.threadId }),
  )?.browsing;
  const [pullRequests, setPullRequests] = useState<ReadonlyArray<AldoFollowedPullRequest>>([]);
  const [cost, setCost] = useState<AldoCost | null>(null);
  // The pull request whose Merge was chosen, waiting for the user to confirm.
  const [confirmMerge, setConfirmMerge] = useState<AldoFollowedPullRequest | null>(null);
  // The thread whose answers are wanted: one for a thread left since is dropped.
  const current = useRef(props.environmentId);

  useEffect(() => {
    current.current = props.environmentId;
    setPreviews(null);
    setPullRequests([]);
    setCost(null);
    setError(null);
  }, [props.environmentId]);

  const refresh = useCallback(() => {
    const environmentId = props.environmentId;
    const stillCurrent = () => current.current === environmentId;
    fetchAldoPullRequests(environmentId)
      .then((next) => stillCurrent() && setPullRequests(next))
      .catch(() => undefined);
    void fetchAldoCost(environmentId).then((next) => stillCurrent() && setCost(next));
  }, [props.environmentId]);

  // Only this mounted thread polls, never a hidden tab or an overlapping read.
  // A sleeping computer is read without waking it. Late replies belong to the
  // effect that made them, even if the user leaves and returns to this thread.
  const readPreviews = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true;
    let pending = false;
    const read = async () => {
      if (document.visibilityState === "hidden" || pending) return;
      pending = true;
      try {
        const next = await fetchAldoPreviews(props.environmentId);
        if (active) {
          setPreviews(next);
          setError(null);
        }
      } catch {
        if (active) setError("Couldn't check preview. Try again.");
      } finally {
        pending = false;
      }
    };
    readPreviews.current = () => void read();
    void read();
    const timer = setInterval(() => void read(), 15_000);
    document.addEventListener("visibilitychange", read);
    window.addEventListener("focus", read);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
      window.removeEventListener("focus", read);
    };
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
          description: "CI/deploy results appear here. Failures return to the original thread.",
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

  const preview =
    previews?.running && previews.ports.length > 0 ? (
      <Menu onOpenChange={(open) => open && readPreviews.current()}>
        <MenuTrigger
          aria-label={
            error
              ? "Preview · status unavailable"
              : `Preview · ${ports.length} listening ${ports.length === 1 ? "port" : "ports"}`
          }
          className={cn(
            aldoHeaderControl,
            "h-9 gap-1.5 border border-border text-[13px] font-medium text-foreground md:h-8",
            props.compactPreview ? "w-9 md:w-8" : "px-3",
          )}
        >
          {error ? <span aria-hidden className="size-1.5 rounded-full bg-warning" /> : null}
          {props.compactPreview ? (
            <MonitorIcon aria-hidden className="size-4" />
          ) : (
            <>
              <span>Preview</span>
              <ChevronDownIcon aria-hidden className="-mr-1 size-3.5 opacity-60 max-md:hidden" />
            </>
          )}
        </MenuTrigger>
        <MenuPopup
          align="end"
          className="w-80 max-w-[calc(100vw-1rem)] [&_[data-slot=menu-item]]:min-h-10 max-sm:[&_[data-slot=menu-item]]:min-h-12"
        >
          {error ? (
            <>
              <div role="status" className="px-2 py-2 text-xs text-muted-foreground">
                {error} These are the last known ports.
              </div>
              <MenuItem onClick={() => readPreviews.current()}>Retry</MenuItem>
              <MenuSeparator />
            </>
          ) : null}
          {ports.map((port, index) => (
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
          ))}
          {stopped.length > 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">
              Not running: {stopped.map((s) => s.name).join(", ")}
            </div>
          ) : null}
        </MenuPopup>
      </Menu>
    ) : null;

  const tools = (
    <Menu onOpenChange={(open) => open && refresh()}>
      <MenuTrigger aria-label="Thread tools" className={`${aldoHeaderControl} size-9 md:size-8`}>
        <EllipsisIcon className="size-[18px]" />
      </MenuTrigger>
      <MenuPopup
        align="end"
        className="w-80 max-w-[calc(100vw-1rem)] max-sm:[&_[data-slot=menu-item]]:min-h-12"
      >
        {props.workspace ? (
          <MenuItem onClick={props.workspace.open}>
            <SquareTerminalIcon className="size-3.5" />
            {props.workspace.label}
          </MenuItem>
        ) : null}
        <MenuItem onClick={props.onOpenBrowser}>
          <PanelRightIcon className="size-3.5" />
          {browsing ? `Agent browser · ${browsing.site}` : "Open agent browser"}
        </MenuItem>
        {pullRequests.length > 0 ? (
          <>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Pull requests Aldo follows through</MenuGroupLabel>
              {pullRequests.slice(0, 6).map((pr) => (
                <MenuGroup key={`${pr.repo}#${pr.number}`}>
                  <MenuItem onClick={() => window.open(pr.url, "_blank", "noopener")}>
                    <span className="min-w-0 flex-1 truncate">
                      #{pr.number} {pr.title}
                    </span>
                    <span className="shrink-0 text-muted-foreground text-xs">
                      {aldoPullRequestStatusLabel(pr)}
                    </span>
                  </MenuItem>
                  {pr.mergeChecks?.slice(0, 8).map((check) => (
                    <MenuItem
                      key={check.name}
                      disabled={!check.url || !/^https?:\/\//i.test(check.url)}
                      onClick={() => {
                        if (check.url && /^https?:\/\//i.test(check.url))
                          window.open(check.url, "_blank", "noopener");
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{check.name}</span>
                      <span className="shrink-0 text-muted-foreground text-xs">{check.state}</span>
                    </MenuItem>
                  ))}
                  {pr.deploymentReported === false ? (
                    <MenuGroupLabel>No deployment reported</MenuGroupLabel>
                  ) : null}
                </MenuGroup>
              ))}
              {pullRequests
                .slice(0, 6)
                .filter(aldoPullRequestMergeable)
                .map((pr) => (
                  <MenuItem
                    key={`merge:${pr.repo}#${pr.number}`}
                    onClick={() => setConfirmMerge(pr)}
                  >
                    <PullRequestGlyph.merged className="size-3.5" /> Merge{" "}
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
              Not running: {stopped.map((s) => s.name).join(", ")}
            </div>
          </>
        ) : null}
        <MenuSeparator />
        <AldoMachineMenuSection environmentId={props.environmentId} />
        {aldoCostLine(cost, props.threadId) ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {aldoCostLine(cost, props.threadId)}
          </div>
        ) : null}
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

  return props.children({
    gpu: <AldoGpuComputerControl environmentId={props.environmentId} />,
    preview,
    tools,
  });
}
