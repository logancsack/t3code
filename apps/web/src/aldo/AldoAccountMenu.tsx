// The account menu, from who's signed in at the foot of the sidebar
// (AppSidebarLayout.tsx), simple mode's rail, and Phone Home's top-right
// avatar button: their name and picture, their plan and credits (opening
// Settings → Account & billing), navigation to Library, Routines, Settings and
// agents' mail (plus Goals when present and Admin for owners), Theme and View
// toggles, and signing out.

import { useNavigate } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  ChevronsUpDownIcon,
  InboxIcon,
  LayoutDashboardIcon,
  LibraryBigIcon,
  LogOutIcon,
  RepeatIcon,
  SettingsIcon,
  TargetIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from "react";

import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
} from "../components/ui/sheet";
import { useSidebar } from "../components/ui/sidebar";
import { Toggle, ToggleGroup } from "../components/ui/toggle-group";
import { cn } from "~/lib/utils";
import { AldoThemeToggle } from "./AldoThemeToggle";
import { requestAldoProfile, type AldoProfile } from "./assistantApi";
import { type AldoHomeUsage } from "./homeApi";
import { useAldoFirstViewHold } from "./firstView";
import { useAldoHomeFeed } from "./homeFeed";
import { aldoPlanLabel } from "./settingsHome.logic";
import { setAldoSimpleMode, useAldoSimpleMode } from "./simpleMode";

// Loaded after the first screen: most accounts have no goal (AldoGoalsProbe.tsx).
const AldoGoalsProbe = lazy(() => import("./AldoGoalsProbe"));

// ---------------------------------------------------------------------------
// Who's signed in, asked once per page.

let knownProfile: AldoProfile | null | undefined = undefined;

/** The signed-in user; undefined until it's known, null where this Aldo can't say. */
export function useAldoProfile(): AldoProfile | null | undefined {
  const [profile, setProfile] = useState<AldoProfile | null | undefined>(knownProfile);
  useEffect(() => {
    let current = true;
    void requestAldoProfile().then((next) => {
      knownProfile = next;
      if (current) setProfile(next);
    });
    return () => {
      current = false;
    };
  }, []);
  return profile;
}

/** What to call them: their name, else their email. */
export function profileName(profile: AldoProfile | null | undefined): string {
  return profile?.name ?? profile?.email ?? "Your account";
}

function initials(profile: AldoProfile | null | undefined): string {
  const source = profile?.name ?? profile?.email ?? "";
  const words = source.split(/[\s@._-]+/).filter(Boolean);
  return (
    ((words[0]?.[0] ?? "") + (profile?.name ? (words[1]?.[0] ?? "") : "")).toUpperCase() || "?"
  );
}

export function AldoAvatar(props: {
  readonly profile: AldoProfile | null | undefined;
  readonly className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const image = props.profile?.imageUrl;
  return image && !broken ? (
    <img
      src={image}
      alt=""
      referrerPolicy="no-referrer"
      className={cn("size-8 shrink-0 rounded-full object-cover", props.className)}
      onError={() => setBroken(true)}
    />
  ) : (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground text-xs",
        props.className,
      )}
    >
      {initials(props.profile)}
    </span>
  );
}

// ---------------------------------------------------------------------------

function creditsLine(usage: AldoHomeUsage | null): string | null {
  const credits = usage?.credits;
  if (!credits) return null;
  return `${credits.used.toLocaleString()} of ${credits.included.toLocaleString()} credits used`;
}

const ITEM =
  "flex min-h-9 w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 max-md:min-h-11 max-md:text-[15px]";

function MenuItem(props: {
  readonly icon: ComponentType<{ className?: string }>;
  readonly label: string;
  readonly onClick: () => void;
  readonly className?: string;
}) {
  return (
    <button type="button" className={cn(ITEM, props.className)} onClick={props.onClick}>
      <props.icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
    </button>
  );
}

function MenuGroup(props: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-border/60 border-t py-1.5 first:border-t-0">
      {props.children}
    </div>
  );
}

function AccountMenu(props: {
  readonly profile: AldoProfile | null | undefined;
  readonly usage: AldoHomeUsage | null;
  /** The account has a goal, so the menu lists Goals. */
  readonly hasGoals: boolean;
  readonly onClose: () => void;
}) {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const simple = useAldoSimpleMode();
  const { profile, usage } = props;
  const go = (to: string) => {
    props.onClose();
    if (isMobile) setOpenMobile(false);
    void navigate({ to });
  };
  // An ended plan's credits are spent history: the card offers a plan instead.
  const credits = usage?.period?.status === "canceled" ? null : (usage?.credits ?? null);
  const share = credits && credits.included > 0 ? Math.min(1, credits.used / credits.included) : 0;
  const adminUrl = profile?.adminUrl ?? null;
  return (
    <div className="flex flex-col" data-aldo-account="">
      <div className="flex items-center gap-2.5 px-2 pt-1 pb-2.5">
        <AldoAvatar profile={profile} className="size-9" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-medium text-sm">{profileName(profile)}</p>
          <p className="truncate text-muted-foreground text-xs">
            {profile?.name ? profile.email : "Signed in to Aldo"}
          </p>
        </div>
      </div>
      <button
        type="button"
        className="mb-1.5 flex flex-col gap-1.5 rounded-lg border border-border/70 bg-card/40 p-2.5 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => go("/settings/account")}
      >
        <span className="flex items-center gap-2 text-sm">
          <span className="font-medium">{aldoPlanLabel(usage) ?? "Plan"}</span>
          <span className="ms-auto inline-flex items-center gap-0.5 text-muted-foreground text-xs">
            Account & billing
            <ChevronRightIcon className="size-3.5" />
          </span>
        </span>
        {credits ? (
          <>
            <span className="h-1.5 overflow-hidden rounded-full bg-muted">
              <span
                className={cn(
                  "block h-full rounded-full",
                  share >= 0.9 ? "bg-warning" : "bg-primary",
                )}
                style={{ width: `${Math.round(share * 100)}%` }}
              />
            </span>
            <span className="tabular-nums text-muted-foreground text-xs">{creditsLine(usage)}</span>
          </>
        ) : (
          <span className="text-muted-foreground text-xs">Choose a plan and see what’s used</span>
        )}
      </button>
      <MenuGroup>
        <MenuItem icon={SettingsIcon} label="Settings" onClick={() => go("/settings")} />
        <MenuItem icon={RepeatIcon} label="Routines" onClick={() => go("/routines")} />
        {!simple ? (
          <MenuItem icon={LibraryBigIcon} label="Library" onClick={() => go("/library")} />
        ) : null}
        <MenuItem icon={InboxIcon} label="Your agents’ mail" onClick={() => go("/mail")} />
        {props.hasGoals ? (
          <MenuItem icon={TargetIcon} label="Goals" onClick={() => go("/goals")} />
        ) : null}
        {adminUrl ? (
          <MenuItem
            icon={LayoutDashboardIcon}
            label="Admin"
            onClick={() => window.location.assign(adminUrl)}
          />
        ) : null}
      </MenuGroup>
      <MenuGroup>
        <div className="flex min-h-9 items-center justify-between gap-3 px-2 py-1 max-md:min-h-11">
          <span className="text-sm">Theme</span>
          <AldoThemeToggle />
        </div>
        <div className="flex min-h-9 items-center justify-between gap-3 px-2 py-1 max-md:min-h-11">
          <span className="text-sm">View</span>
          <ToggleGroup
            aria-label="View"
            variant="segmented"
            value={[simple ? "simple" : "full"]}
            onValueChange={(next) => {
              const mode = next[0];
              if (mode !== "simple" && mode !== "full") return;
              props.onClose();
              setAldoSimpleMode(mode === "simple");
            }}
          >
            <Toggle value="simple">Simple</Toggle>
            <Toggle value="full">Full</Toggle>
          </ToggleGroup>
        </div>
      </MenuGroup>
      {profile ? (
        <MenuGroup>
          <MenuItem
            icon={LogOutIcon}
            label="Sign out"
            onClick={() => window.location.assign(profile.signOutUrl)}
          />
        </MenuGroup>
      ) : null}
    </div>
  );
}

/**
 * On a phone's Home screen: a 44×44px top-right avatar button that opens the
 * Account & Settings sheet in one tap (making Settings 2 taps from Home).
 */
export function AldoMobileAccountButton(props: { readonly className?: string }) {
  const profile = useAldoProfile();
  const usage = useAldoHomeFeed((s) => s.home?.usage ?? null);
  const [hasGoals, setHasGoals] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Suspense fallback={null}>
        <AldoGoalsProbe menuOpen={open} onHasGoals={setHasGoals} />
      </Suspense>
      <button
        type="button"
        aria-label="Account and settings"
        data-aldo-mobile-account=""
        className={cn(
          "inline-flex size-11 shrink-0 items-center justify-center rounded-full outline-none transition-colors hover:bg-accent active:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
          props.className,
        )}
        onClick={() => setOpen(true)}
      >
        <AldoAvatar profile={profile} className="size-8 ring-1 ring-border/70" />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetPopup
          side="bottom"
          showCloseButton={false}
          className="rounded-t-2xl border-t bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] text-foreground"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Account and settings</SheetTitle>
            <SheetDescription>Your plan, Settings, Routines, theme and view.</SheetDescription>
          </SheetHeader>
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" aria-hidden />
          <AccountMenu
            profile={profile}
            usage={usage}
            hasGoals={hasGoals}
            onClose={() => setOpen(false)}
          />
        </SheetPopup>
      </Sheet>
    </>
  );
}

/** Who's signed in, at the foot of the sidebar: their picture and name, opening the account menu. */
export function AldoProfileButton(props: {
  readonly className?: string;
  /** Their picture alone, for simple mode's rail. */
  readonly compact?: boolean;
}) {
  const profile = useAldoProfile();
  useAldoFirstViewHold(profile === undefined);
  const usage = useAldoHomeFeed((s) => s.home?.usage ?? null);
  // Read as the app loads (AldoGoalsProbe), so the menu opens with Goals already in it (or not): for
  // an account without a goal the menu is as it was.
  const [hasGoals, setHasGoals] = useState(false);
  const [open, setOpen] = useState(false);
  const trigger = props.compact ? (
    <button
      type="button"
      className={cn(
        "flex size-10 items-center justify-center rounded-full outline-none transition-colors hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-sidebar-row-hover",
        props.className,
      )}
      aria-label="Your account"
      data-aldo-profile=""
    >
      <AldoAvatar profile={profile} className="size-8 ring-1 ring-sidebar-border/80" />
    </button>
  ) : (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left outline-none transition-colors hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-sidebar-row-hover",
        props.className,
      )}
      aria-label="Your account"
      data-aldo-profile=""
    >
      <AldoAvatar profile={profile} />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate font-medium text-sidebar-foreground text-sm">
          {profileName(profile)}
        </span>
        <span className="truncate text-[11px] text-sidebar-muted-foreground">
          {aldoPlanLabel(usage) ?? (profile?.name ? profile.email : "Account and settings")}
        </span>
      </span>
      <ChevronsUpDownIcon className="size-3.5 shrink-0 text-sidebar-muted-foreground/70" />
    </button>
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Suspense fallback={null}>
        <AldoGoalsProbe menuOpen={open} onHasGoals={setHasGoals} />
      </Suspense>
      <PopoverTrigger render={trigger} />
      <PopoverPopup
        width="md"
        padding="compact"
        side={props.compact ? "right" : "top"}
        align={props.compact ? "end" : "start"}
        aria-label="Your account"
      >
        <AccountMenu
          profile={profile}
          usage={usage}
          hasGoals={hasGoals}
          onClose={() => setOpen(false)}
        />
      </PopoverPopup>
    </Popover>
  );
}
