import { Outlet, createFileRoute, redirect, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AldoLayers } from "../aldo/AldoLayers";
import { aldoLayersActive } from "../aldo/layers";
import { GlobalVoiceInputIndicator } from "../components/chat/GlobalVoiceInputIndicator";
import { isAppModalPage } from "../components/sidebar/mainAppLocation";
import { SidebarInset } from "../components/ui/sidebar";
import {
  loadThreadRouteView,
  loadedThreadRouteView,
  resolveThreadRouteTarget,
  type ThreadRouteTarget,
} from "../threadRoutes";
import { retainThreadFindForRoute } from "../components/chat/threadFindStore";
import { ThreadLinkPrompt } from "../components/promptLinks/ThreadLinkPrompt";
import { useShownThreadRouteTarget } from "../hooks/useShownThreadRouteTarget";

/**
 * The thread view's code loads with the thread routes, not this layout, so the home screen
 * doesn't download it. Their loaders wait for it; if it isn't here yet, it renders once it is.
 */
function ThreadRoute({ target, background }: { target: ThreadRouteTarget; background?: boolean }) {
  const [ThreadRouteView, setThreadRouteView] = useState(loadedThreadRouteView);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- awaits the lazily loaded thread view chunk
  useEffect(() => {
    if (ThreadRouteView) return;
    let current = true;
    loadThreadRouteView().then(
      (view) => current && setThreadRouteView(() => view),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [ThreadRouteView]);
  return ThreadRouteView ? (
    <ThreadRouteView target={target} background={background ?? false} />
  ) : null;
}

function ChatRouteLayout() {
  // Render both routes here so draft promotion keeps the same ChatView mounted.
  const { shownTarget, modalOpen } = useShownThreadRouteTarget();
  const onHome = useLocation({ select: (location) => location.pathname === "/" });
  return (
    <>
      {shownTarget?.kind === "server" && !modalOpen ? (
        <ThreadLinkPrompt threadRef={shownTarget.threadRef} />
      ) : null}
      {aldoLayersActive() && (shownTarget || onHome || modalOpen) ? (
        <AldoLayers
          target={shownTarget}
          renderThread={(target) => <ThreadRoute target={target} background={modalOpen} />}
        />
      ) : shownTarget ? (
        <ThreadRoute target={shownTarget} background={modalOpen} />
      ) : modalOpen ? (
        <SidebarInset className="h-dvh" />
      ) : (
        <Outlet />
      )}
      {modalOpen ? <Outlet /> : null}
      <GlobalVoiceInputIndicator hidden={modalOpen} />
    </>
  );
}

export const Route = createFileRoute("/_chat")({
  beforeLoad: async ({ context, location }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
    return { appModalPage: isAppModalPage(location.pathname) };
  },
  component: ChatRouteLayout,
  // Every match carries the whole location's params, so this layout sees the thread route's too.
  onEnter: ({ context, params }) => retainThreadFindForRouteMatch(context.appModalPage, params),
  onStay: ({ context, params }) => retainThreadFindForRouteMatch(context.appModalPage, params),
  onLeave: () => retainThreadFindForRoute({ modalPage: false, threadRef: null }),
});

function retainThreadFindForRouteMatch(
  modalPage: boolean,
  params: Partial<Record<"environmentId" | "threadId", string>>,
) {
  const target = resolveThreadRouteTarget(params);
  retainThreadFindForRoute({
    modalPage,
    threadRef: target?.kind === "server" ? target.threadRef : null,
  });
}
