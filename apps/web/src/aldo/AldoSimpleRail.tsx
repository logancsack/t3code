// Simple mode's rail (simpleMode.ts), in place of the sidebar
// (AppSidebarLayout.tsx): Aldo's conversation, what needs the user with how
// many, and the Library, then the way back to the full view and the user's
// account. Each place is a view of the home screen (AldoHome.tsx), so a thread
// opened from one keeps the rail beside it. On a phone, where the sidebar is a
// sheet behind its button, the button opens the same places in a sheet, and
// the home screen has them as tabs along its top.

import { useLocation, useNavigate } from "@tanstack/react-router";
import { InboxIcon, LibraryBigIcon, PanelLeftOpenIcon } from "lucide-react";
import { useCallback, type ReactNode } from "react";

import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
} from "../components/ui/sheet";
import { useSidebar } from "../components/ui/sidebar";
import { toastManager } from "../components/ui/toast";
import { useIsMobile } from "../hooks/useMediaQuery";
import { cn } from "~/lib/utils";
import { AldoProfileButton } from "./AldoAccountMenu";
import { AldoOrb, useAldoAssistantAvailable } from "./AldoAssistant";
import { useAldoAttentionCount } from "./attentionBadge";
import { isAldoCloud } from "./cloud";
import { setAldoSimpleMode, setAldoSimplePlace, useAldoSimple } from "./simpleMode";
import {
  ALDO_SIMPLE_PLACES,
  currentSimplePlace,
  simpleRailShows,
  type AldoSimplePlace,
} from "./simpleMode.logic";

/**
 * Whether simple mode stands in for the sidebar here: as a rail, or on a
 * phone as the sheet the sidebar's button opens. Null shows the sidebar.
 */
export function useAldoSimpleRail(settings: boolean): "rail" | "sheet" | null {
  const on = useAldoSimple((s) => s.on);
  const mobile = useIsMobile();
  // Asked only when it's on: stock T3 has no Aldo to ask.
  const assistant = useAldoAssistantAvailable(isAldoCloud && on);
  if (!simpleRailShows({ cloud: isAldoCloud, on, settings, assistant })) return null;
  return mobile ? "sheet" : "rail";
}

/** Goes to a place: the home screen, showing it. */
function useGoTo(): (place: AldoSimplePlace) => void {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  return useCallback(
    (place) => {
      setAldoSimplePlace(place);
      if (pathname !== "/") void navigate({ to: "/" });
    },
    [navigate, pathname],
  );
}

function useCurrentPlace(): AldoSimplePlace | null {
  const pathname = useLocation({ select: (location) => location.pathname });
  const place = useAldoSimple((s) => s.place);
  return currentSimplePlace(pathname, place);
}

function PlaceIcon(props: { readonly place: AldoSimplePlace }) {
  if (props.place === "aldo") return <AldoOrb size="xs" display />;
  if (props.place === "needs") return <InboxIcon className="size-[18px]" />;
  return <LibraryBigIcon className="size-[18px]" />;
}

/** "Needs you, 2 waiting" for a screen reader, where the number shows on its own. */
function placeLabel(label: string, waiting: number): string {
  return waiting > 0 ? `${label}, ${waiting} waiting` : label;
}

function fullView(): void {
  setAldoSimpleMode(false);
  toastManager.add({
    type: "info",
    title: "Simple mode is off",
    description: "Turn it on again from your account, at the foot of the sidebar.",
  });
}

export function AldoSimpleRail() {
  return useIsMobile() ? <PhoneSheet /> : <Rail />;
}

function Rail() {
  const goTo = useGoTo();
  const current = useCurrentPlace();
  const waiting = useAldoAttentionCount();
  return (
    <nav
      aria-label="Aldo"
      data-aldo-simple-rail=""
      className="flex w-[4.75rem] shrink-0 flex-col items-center gap-1 border-sidebar-border border-r bg-sidebar px-1.5 pt-3 pb-2.5 text-sidebar-foreground surface-grain"
    >
      {ALDO_SIMPLE_PLACES.map(({ place, label }) => {
        const count = place === "needs" ? waiting : 0;
        return (
          <RailButton
            key={place}
            label={label}
            aria-label={placeLabel(label, count)}
            current={current === place}
            badge={count}
            icon={<PlaceIcon place={place} />}
            onClick={() => goTo(place)}
          />
        );
      })}
      <span className="flex-1" />
      <RailButton
        label="Full view"
        icon={<PanelLeftOpenIcon className="size-[18px]" />}
        onClick={fullView}
      />
      <AldoProfileButton compact className="mt-1.5" />
    </nav>
  );
}

function RailButton(props: {
  readonly label: string;
  readonly "aria-label"?: string;
  readonly icon: ReactNode;
  readonly current?: boolean;
  readonly badge?: number;
  readonly onClick: () => void;
}) {
  const badge = props.badge ?? 0;
  return (
    <button
      type="button"
      aria-current={props.current ? "page" : undefined}
      aria-label={props["aria-label"]}
      className={cn(
        "group flex w-full flex-col items-center gap-1 rounded-lg py-1 text-[11px] leading-tight outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        props.current
          ? "text-sidebar-foreground"
          : "text-sidebar-muted-foreground hover:text-sidebar-foreground",
      )}
      onClick={props.onClick}
    >
      <span
        className={cn(
          "relative flex h-8 w-12 items-center justify-center rounded-full transition-colors",
          props.current ? "bg-sidebar-row-active" : "group-hover:bg-sidebar-row-hover",
        )}
      >
        {props.icon}
        {badge > 0 ? (
          <span
            aria-hidden
            className="absolute -top-1 right-0 min-w-4.5 rounded-full bg-warning px-1 text-center font-semibold text-[10px] text-neutral-950 leading-4.5"
          >
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </span>
      <span className="font-medium">{props.label}</span>
    </button>
  );
}

/** On a phone: the places, the full view and the account, from the sidebar's button. */
function PhoneSheet() {
  const { openMobile, setOpenMobile } = useSidebar();
  const goTo = useGoTo();
  const current = useCurrentPlace();
  const waiting = useAldoAttentionCount();
  const row =
    "flex h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left font-medium text-[15px] transition-colors";
  return (
    <Sheet open={openMobile} onOpenChange={setOpenMobile}>
      <SheetPopup
        side="left"
        showCloseButton={false}
        className="w-72 max-w-[85vw] bg-sidebar p-0 text-sidebar-foreground"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Aldo</SheetTitle>
          <SheetDescription>Aldo, what needs you, and your Library.</SheetDescription>
        </SheetHeader>
        <nav
          aria-label="Aldo"
          className="flex h-full flex-col gap-1 px-2 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          {ALDO_SIMPLE_PLACES.map(({ place, label }) => {
            const count = place === "needs" ? waiting : 0;
            return (
              <button
                key={place}
                type="button"
                aria-current={current === place ? "page" : undefined}
                className={cn(
                  row,
                  current === place ? "bg-sidebar-row-active" : "hover:bg-sidebar-row-hover",
                )}
                onClick={() => {
                  setOpenMobile(false);
                  goTo(place);
                }}
              >
                <span className="flex size-6 items-center justify-center">
                  <PlaceIcon place={place} />
                </span>
                <span className="flex-1">{label}</span>
                {count > 0 ? (
                  <span className="rounded-full bg-warning/15 px-2 font-semibold text-warning-foreground text-xs leading-5">
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
          <span className="flex-1" />
          <button
            type="button"
            className={cn(row, "text-sidebar-muted-foreground hover:bg-sidebar-row-hover")}
            onClick={() => {
              setOpenMobile(false);
              fullView();
            }}
          >
            <span className="flex size-6 items-center justify-center">
              <PanelLeftOpenIcon className="size-[18px]" />
            </span>
            Full view
          </button>
          <AldoProfileButton />
        </nav>
      </SheetPopup>
    </Sheet>
  );
}

/** On a phone's home screen: the three places as tabs, with how many wait on the user. */
export function AldoSimpleTabs() {
  const place = useAldoSimple((s) => s.place);
  const waiting = useAldoAttentionCount();
  return (
    // On a narrow phone, three tabs reach the sidebar's button at the top left:
    // they move right of it and tighten.
    <div className="flex w-full justify-center ps-7 min-[375px]:ps-0">
      <div
        className="flex items-center gap-0.5 rounded-full bg-muted p-0.5"
        role="group"
        aria-label="View"
      >
        {ALDO_SIMPLE_PLACES.map((option) => (
          <button
            key={option.place}
            type="button"
            aria-pressed={place === option.place}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-full px-2 font-medium text-[13px] transition-colors min-[360px]:px-3 min-[360px]:text-sm",
              place === option.place
                ? "bg-background text-foreground shadow-xs/5"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setAldoSimplePlace(option.place)}
          >
            {option.place === "aldo" ? (
              <span
                aria-hidden
                className="size-3.5 rounded-full bg-gradient-to-br from-primary/90 to-primary/50"
              />
            ) : null}
            {option.label}
            {option.place === "needs" && waiting > 0 ? (
              <span className="rounded-full bg-warning/15 px-1.5 font-semibold text-[11px] text-warning-foreground">
                {waiting}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
