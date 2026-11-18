import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import ChatView from "./ChatView";
import { resolveDraftPromotionNavigationTarget, threadHasStarted } from "./ChatView.logic";
import { waitForDraftHeroTransition } from "./chat/draftHeroTransition";
import { SidebarInset } from "./ui/sidebar";
import {
  finalizePromotedDraftThreadByRef,
  markPromotedDraftThreadByRef,
  useBackgroundDraftSubmissionPending,
  useComposerDraftStore,
} from "../composerDraftStore";
import { useSidebarPendingFileDropStore } from "../sidebarPendingFileDropStore";
import {
  useRefollowListedThread,
  useThread,
  useThreadDetail,
  useThreadRefs,
  useThreadShell,
  useThreadStatus,
} from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { environmentShell } from "../state/shell";
import {
  buildThreadRouteParams,
  resolveThreadRouteRenderState,
  type ThreadRouteTarget,
} from "../threadRoutes";
import { resolveThreadSyncPhase } from "../threadSync";
import { useAfterPaint } from "../hooks/useAfterPaint";

/**
 * The single chat surface behind both `/draft/$draftId` and
 * `/$environmentId/$threadId`. Each draft gets its own ChatView instance (so
 * a background send's state stays with the draft it came from), and that
 * instance carries the draft through its promotion to a server thread: the
 * thread route keeps keying by the draft id while the draft record exists,
 * so the route swap only changes props and the timeline never paints an
 * empty frame. Plain server threads are unkeyed, so navigating between them
 * reuses one instance as ChatView expects.
 *
 * Rendered by the `_chat` layout rather than by the two leaf routes, since
 * an element only survives a route swap when the same parent renders it.
 */
export function ThreadRouteView({ target }: { target: ThreadRouteTarget }) {
  // Opening a server thread renders it once the click or key that opened it
  // has painted, so the sidebar answers at once: the thread on screen stays,
  // inert, until the next one is ready, and one opened from elsewhere starts
  // from an empty frame. Drafts, and a draft's swap to its thread, render at
  // once, keeping one ChatView across the swap.
  const deferredTarget = useAfterPaint(target, null, sameThreadRouteTarget);
  const shownTarget =
    target.kind === "server" && deferredTarget?.kind !== "draft" ? deferredTarget : target;
  const stale = shownTarget !== null && !sameThreadRouteTarget(shownTarget, target);
  return (
    <SidebarInset
      className="h-svh min-h-0 overflow-hidden overscroll-y-none md:h-dvh"
      inert={stale}
      aria-busy={shownTarget === null || stale ? true : undefined}
    >
      {shownTarget ? <ThreadRouteContent target={shownTarget} /> : null}
    </SidebarInset>
  );
}

function sameThreadRouteTarget(a: ThreadRouteTarget, b: ThreadRouteTarget): boolean {
  if (a.kind === "draft") return b.kind === "draft" && a.draftId === b.draftId;
  return b.kind === "server" && scopedThreadKey(a.threadRef) === scopedThreadKey(b.threadRef);
}

function ThreadRouteContent({ target }: { target: ThreadRouteTarget }) {
  const navigate = useNavigate();
  const router = useRouter();
  const draftId = target.kind === "draft" ? target.draftId : null;
  const draftSession = useComposerDraftStore((store) =>
    draftId === null ? null : store.getDraftSession(draftId),
  );
  const threadRefs = useThreadRefs();
  // The server thread this view is about: the route's own ref, or the draft's
  // reserved ref once the server knows it.
  const inferredThreadRef = draftSession
    ? (threadRefs.find(
        (ref) =>
          ref.environmentId === draftSession.environmentId &&
          ref.threadId === draftSession.threadId,
      ) ?? null)
    : null;
  const serverThreadRef: ScopedThreadRef | null =
    target.kind === "server" ? target.threadRef : (draftSession?.promotedTo ?? inferredThreadRef);
  const serverThread = useThread(serverThreadRef);
  const backgroundSubmissionPending = useBackgroundDraftSubmissionPending(
    target.kind === "draft" ? serverThreadRef : null,
  );
  const canonicalThreadRef =
    target.kind === "draft"
      ? resolveDraftPromotionNavigationTarget({
          serverThreadRef,
          serverThread,
          backgroundSubmissionPending,
        })
      : null;

  const shell = useEnvironmentQuery(
    serverThreadRef === null ? null : environmentShell.stateAtom(serverThreadRef.environmentId),
  );
  const serverThreadShell = useThreadShell(serverThreadRef);
  const serverThreadDetail = useThreadDetail(serverThreadRef);
  // Opened before its first message reached the server (from a notification, a
  // reload, the sidebar), a thread was taken for deleted and showed as the
  // draft it was sent from, or sent the page home; once the server lists it,
  // it's followed again and loads, and a draft moves to it.
  const refollowing = useRefollowListedThread(serverThreadRef);
  const followedStatus = useThreadStatus(serverThreadRef);
  const serverThreadStatus = refollowing ? "synchronizing" : followedStatus;
  const bootstrapComplete = shell.data?.snapshot._tag === "Some";
  const draftThread = useComposerDraftStore((store) =>
    serverThreadRef ? store.getDraftThreadByRef(serverThreadRef) : null,
  );
  const promotedDraftId = useComposerDraftStore((store) =>
    target.kind === "server" ? store.getDraftIdByRef(target.threadRef) : null,
  );
  // The draft record is removed once the promoted thread has started, which
  // is after the route swap. Latch the key so the element that carried the
  // draft keeps its identity for as long as this thread stays on screen.
  const [chatViewKey, setChatViewKey] = useState<{ threadKey: string; key: string } | null>(null);
  const serverThreadKey = target.kind === "server" ? scopedThreadKey(target.threadRef) : null;
  const nextChatViewKey =
    serverThreadKey === null
      ? null
      : chatViewKey?.threadKey === serverThreadKey
        ? chatViewKey
        : promotedDraftId
          ? { threadKey: serverThreadKey, key: promotedDraftId }
          : null;
  if (nextChatViewKey !== chatViewKey) {
    setChatViewKey(nextChatViewKey);
  }
  const renderState = resolveThreadRouteRenderState({
    bootstrapComplete,
    shellStatus: shell.data?.status,
    serverThreadShellExists: serverThreadShell !== null,
    serverThreadDetailExists: serverThreadDetail !== null,
    serverThreadDetailDeleted: serverThreadStatus === "deleted",
    draftThreadExists: draftThread !== null,
  });
  const threadSyncPhase = resolveThreadSyncPhase({
    detailExists: serverThreadDetail !== null,
    shellExists: serverThreadShell !== null,
    status: serverThreadStatus,
  });
  const serverThreadStarted = threadHasStarted(serverThreadDetail);

  useEffect(() => {
    if (!inferredThreadRef || draftSession?.promotedTo) {
      return;
    }
    markPromotedDraftThreadByRef(inferredThreadRef);
  }, [draftSession?.promotedTo, inferredThreadRef]);

  useEffect(() => {
    if (!canonicalThreadRef || draftId === null) {
      return;
    }
    let cancelled = false;
    void waitForDraftHeroTransition().then(() => {
      // Closed meanwhile: in Aldo the thread stays mounted while it slides away.
      if (cancelled || !router.state.location.pathname.endsWith(`/${draftId}`)) {
        return;
      }
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(canonicalThreadRef),
        replace: true,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [canonicalThreadRef, draftId, navigate, router]);

  useEffect(() => {
    if (target.kind !== "draft" || draftSession || canonicalThreadRef) {
      return;
    }
    void navigate({ to: "/", replace: true });
  }, [canonicalThreadRef, draftSession, navigate, target.kind]);

  useEffect(() => {
    if (target.kind !== "server" || !bootstrapComplete) {
      return;
    }
    // Navigation already resolved onto this path, so a drop aimed here
    // passed its landing check; once the thread reads as missing it can
    // never be attached, release it.
    // Redirect every bootstrapped missing state — including empty environments.
    // Gating on "has other threads" left invalid deep links parked on a blank
    // route while their detail subscription kept thrashing.
    if (renderState === "missing") {
      const { clearPendingFileDropsForThread } = useSidebarPendingFileDropStore.getState();
      clearPendingFileDropsForThread(target.threadRef);
      void navigate({ to: "/", replace: true });
    }
  }, [bootstrapComplete, navigate, renderState, target]);

  useEffect(() => {
    if (target.kind !== "server" || !serverThreadStarted || !draftThread) {
      return;
    }
    finalizePromotedDraftThreadByRef(target.threadRef);
  }, [draftThread, serverThreadStarted, target]);

  let view: React.ReactNode = null;
  if (target.kind === "draft") {
    if (draftSession) {
      view = (
        <ChatView
          key={target.draftId}
          draftId={target.draftId}
          environmentId={draftSession.environmentId}
          threadId={draftSession.threadId}
          routeKind="draft"
          forceExpandedMobileComposer
        />
      );
    }
  } else if (renderState === "ready" || renderState === "loading") {
    view = (
      <ChatView
        {...(nextChatViewKey ? { key: nextChatViewKey.key } : {})}
        environmentId={target.threadRef.environmentId}
        threadId={target.threadRef.threadId}
        routeKind="server"
        threadSyncPhase={threadSyncPhase}
      />
    );
  }

  return view;
}
