// Aldo's settings frame: each page's name and what it's for at its top, and on
// a phone a bar with "Settings" back to the list and Done back to the threads
// (AldoSettingsHome is the list).
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../components/ui/button";
import { useNavigateToMainApp } from "../components/sidebar/mainAppLocation";
import { aldoSettingsPage, aldoSettingsParent } from "./settings.logic";
import "./settingsTouch.css";

declare module "@tanstack/react-router" {
  interface HistoryState {
    /** Opened from the phone's list of settings, which is the entry before it. */
    aldoFromSettingsList?: boolean;
  }
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
  // A page under another (a member's, under Members) goes back to it.
  const parent = aldoSettingsParent(props.pathname);
  return (
    <header className="grid h-[var(--workspace-topbar-height)] min-w-0 shrink-0 grid-cols-[6rem_minmax(0,1fr)_6rem] items-center gap-2 border-border/60 border-b pl-(--workspace-gutter-start) pr-(--workspace-gutter-end)">
      <div className="flex min-w-0">
        {root ? null : (
          <Button
            variant="ghost"
            size="sm"
            className="h-12 min-w-12 gap-0.5 px-2 text-sm sm:h-12"
            onClick={() => {
              if (parent) void navigate({ to: parent.to, hash: "" });
              // Back to the list underneath, so the browser's Back doesn't reopen this page.
              else if (fromList === true) window.history.back();
              else void navigate({ to: "/settings", search: { project: undefined }, hash: "" });
            }}
          >
            <ChevronLeftIcon className="size-4" />
            {parent?.label ?? "Settings"}
          </Button>
        )}
      </div>
      <h1 className="min-w-0 truncate text-center font-semibold text-foreground text-sm">
        {title}
      </h1>
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="h-12 min-w-12 px-2 text-sm sm:h-12"
          onClick={() => void navigateToMainApp()}
        >
          Done
        </Button>
      </div>
    </header>
  );
}

/** A page's name and one line on what it's for, before anything else on it. */
export function AldoSettingsPageHeader(props: {
  readonly pathname: string;
  readonly action?: ReactNode;
}) {
  const navigate = useNavigate();
  const page = aldoSettingsPage(props.pathname);
  const parent = aldoSettingsParent(props.pathname);
  if (!page) return null;
  return (
    <header className="flex items-start justify-between gap-6 px-1">
      <div className="min-w-0 space-y-1.5">
        {/* On a phone its bar has the way back. */}
        {parent ? (
          <button
            type="button"
            className="-ms-1 flex items-center gap-0.5 rounded-md px-1 text-muted-foreground text-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:hidden"
            onClick={() => void navigate({ to: parent.to, hash: "" })}
          >
            <ChevronLeftIcon aria-hidden="true" className="size-4" />
            {parent.label}
          </button>
        ) : null}
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
