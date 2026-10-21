// Aldo's settings frame: the way back to threads at the head of the nav (with
// the Esc that already leaves), each page's name and what it's for at its top,
// and on a phone a bar with "Settings" back to the list and Done back to the
// threads (AldoSettingsHome is the list).
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useSettingsSearchTargetId } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../components/ui/collapsible";
import { Kbd } from "../components/ui/kbd";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../components/ui/sidebar";
import { useNavigateToMainApp } from "../components/sidebar/mainAppLocation";
import { isElectron } from "../env";
import { cn } from "../lib/utils";
import { isAldoCloud } from "./api";
import { aldoSettingsPage } from "./settings.logic";

declare module "@tanstack/react-router" {
  interface HistoryState {
    /** Opened from the phone's list of settings, which is the entry before it. */
    aldoFromSettingsList?: boolean;
  }
}

/** Aldo on a phone opens Settings on its list of pages, as a phone's own settings do. */
export function aldoSettingsOpensOnList(): boolean {
  return isAldoCloud && window.matchMedia("(max-width: 767px)").matches;
}

/**
 * The nav's first row: back to the thread you came from. In the desktop app
 * it's the titlebar too, so it drags the window and clears macOS's controls.
 */
export function AldoSettingsBackBar() {
  const navigateToMainApp = useNavigateToMainApp();
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <div
      className={cn(
        "flex h-[var(--workspace-topbar-height)] shrink-0 items-center px-2",
        isElectron && "drag-region md:ps-[var(--workspace-controls-left)]",
      )}
    >
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            className="font-medium text-sidebar-foreground"
            onClick={() => {
              if (isMobile) setOpenMobile(false);
              void navigateToMainApp();
            }}
          >
            <ArrowLeftIcon />
            <span className="flex-1 truncate">Back to threads</span>
            <Kbd aria-hidden="true" className="max-md:hidden">
              Esc
            </Kbd>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </div>
  );
}

/**
 * A phone's bar over a settings page: back to the list of pages, the page's
 * name, and Done back to the threads. The list itself has Done alone.
 */
export function AldoSettingsPhoneBar(props: { readonly pathname: string }) {
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const fromList = useLocation({ select: (location) => location.state.aldoFromSettingsList });
  const root = props.pathname.replace(/\/+$/, "") === "/settings";
  const title = root ? null : (aldoSettingsPage(props.pathname)?.title ?? "Settings");
  return (
    <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2">
      <div className="flex min-w-0">
        {root ? null : (
          <Button
            variant="ghost"
            size="sm"
            className="-ms-2 gap-0.5 px-1.5 text-primary"
            onClick={() => {
              // Back to the list underneath, so the browser's Back doesn't reopen this page.
              if (fromList === true) window.history.back();
              else void navigate({ to: "/settings", search: { project: undefined }, hash: "" });
            }}
          >
            <ChevronLeftIcon className="size-5 text-primary" />
            Settings
          </Button>
        )}
      </div>
      <h1 className="truncate text-center font-medium text-foreground text-sm">{title}</h1>
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="-me-2 px-3 font-semibold text-primary"
          onClick={() => void navigateToMainApp()}
        >
          Done
        </Button>
      </div>
    </div>
  );
}

/** A page's name and one line on what it's for, before anything else on it. */
export function AldoSettingsPageHeader(props: {
  readonly pathname: string;
  readonly action?: ReactNode;
}) {
  const page = aldoSettingsPage(props.pathname);
  if (!page) return null;
  return (
    <header className="flex items-start justify-between gap-6 px-1">
      <div className="min-w-0 space-y-1.5">
        {/* A phone's bar names the page already, as its heading. */}
        <h1 className="font-semibold text-foreground text-xl tracking-tight max-md:hidden">
          {page.title}
        </h1>
        <p className="max-w-2xl text-muted-foreground text-sm leading-relaxed">{page.intro}</p>
      </div>
      {props.action ? <div className="shrink-0 pt-0.5">{props.action}</div> : null}
    </header>
  );
}

/**
 * Settings folded away behind a heading that names what's there, which a
 * search for one of them (`opensFor`) unfolds.
 */
export function AldoSettingsFold(props: {
  readonly title: string;
  readonly hint: string;
  readonly opensFor: (targetId: string) => boolean;
  readonly children: ReactNode;
}) {
  const { opensFor } = props;
  const [open, setOpen] = useState(false);
  const targetId = useSettingsSearchTargetId();
  // Unfold once per search jump, so the user can fold it again while the target is still set.
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (targetId === null) {
      openedFor.current = null;
      return;
    }
    if (!opensFor(targetId) || openedFor.current === targetId) return;
    openedFor.current = targetId;
    setOpen(true);
  }, [opensFor, targetId]);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex w-full items-start gap-2 rounded-lg px-3 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4">
        <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-panel-open:rotate-90" />
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-foreground text-sm">{props.title}</span>
          <span className="text-muted-foreground text-xs">{props.hint}</span>
        </span>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="flex flex-col gap-8 pt-3">{props.children}</div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
