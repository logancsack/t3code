// The account menu, from who's signed in at the foot of the sidebar
// (AppSidebarLayout.tsx) and simple mode's rail: their name and picture from
// their sign-in, their plan and credits (opening Settings → Account), the way
// to Settings, the agents' mail and the keyboard shortcuts, the two things
// people change most (theme, simple mode), and signing out. An Aldo that
// can't say who's signed in still shows the rest.

import { useNavigate } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  ChevronsUpDownIcon,
  InboxIcon,
  KeyboardIcon,
  LogOutIcon,
  SettingsIcon,
} from "lucide-react";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";

import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { Switch } from "../components/ui/switch";
import { cn } from "~/lib/utils";
import { AldoThemeToggle } from "./AldoGeneralSettings";
import { fetchAldoProfile, type AldoHomeUsage, type AldoProfile } from "./cloud";
import { useAldoFirstViewHold } from "./firstView";
import { useAldoHomeFeed } from "./homeFeed";
import { setAldoSimpleMode, useAldoSimpleMode } from "./simpleMode";

// ---------------------------------------------------------------------------
// Who's signed in, asked once per page.

let profileRequest: Promise<AldoProfile | null> | null = null;
let knownProfile: AldoProfile | null | undefined = undefined;

/** The signed-in user; undefined until it's known, null where this Aldo can't say. */
export function useAldoProfile(): AldoProfile | null | undefined {
  const [profile, setProfile] = useState<AldoProfile | null | undefined>(knownProfile);
  useEffect(() => {
    let current = true;
    profileRequest ??= fetchAldoProfile().catch(() => null);
    void profileRequest.then((next) => {
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
  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent/60";

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
  readonly onClose: () => void;
}) {
  const navigate = useNavigate();
  const simple = useAldoSimpleMode();
  const { profile, usage } = props;
  const go = (to: string) => {
    props.onClose();
    void navigate({ to });
  };
  const credits = usage?.credits ?? null;
  const share = credits && credits.included > 0 ? Math.min(1, credits.used / credits.included) : 0;
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
          <span className="font-medium">{usage?.plan?.name ?? "Plan"}</span>
          <span className="ms-auto inline-flex items-center gap-0.5 text-muted-foreground text-xs">
            Plan and billing
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
            <span className="text-muted-foreground text-xs">{creditsLine(usage)}</span>
          </>
        ) : (
          <span className="text-muted-foreground text-xs">Choose a plan, and see what's used</span>
        )}
      </button>
      <MenuGroup>
        <MenuItem icon={SettingsIcon} label="Settings" onClick={() => go("/settings/agents")} />
        <MenuItem icon={InboxIcon} label="Your agents' mail" onClick={() => go("/mail")} />
        <MenuItem
          icon={KeyboardIcon}
          label="Keyboard shortcuts"
          onClick={() => go("/settings/keybindings")}
        />
      </MenuGroup>
      <MenuGroup>
        <div className="flex items-center justify-between gap-3 px-2 py-1">
          <span className="text-sm">Theme</span>
          <AldoThemeToggle />
        </div>
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/60">
          <span className="min-w-0">
            <span className="block text-sm">Simple mode</span>
            <span className="block text-muted-foreground text-xs">
              Just Aldo, what needs you, and your Library
            </span>
          </span>
          <Switch
            checked={simple}
            onCheckedChange={(checked) => {
              // The sidebar or the rail this opened from goes with the change.
              props.onClose();
              setAldoSimpleMode(checked);
            }}
            aria-label="Simple mode"
          />
        </label>
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

/** Who's signed in, at the foot of the sidebar: their picture and name, opening the account menu. */
export function AldoProfileButton(props: {
  readonly className?: string;
  /** Their picture alone, for simple mode's rail. */
  readonly compact?: boolean;
}) {
  const profile = useAldoProfile();
  useAldoFirstViewHold(profile === undefined);
  const usage = useAldoHomeFeed((s) => s.home?.usage ?? null);
  const [open, setOpen] = useState(false);
  const trigger = props.compact ? (
    <button
      type="button"
      className={cn(
        "rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
        props.className,
      )}
      aria-label="Your account"
      data-aldo-profile=""
    >
      <AldoAvatar profile={profile} />
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
          {usage?.plan?.name ?? (profile?.name ? profile.email : "Account and settings")}
        </span>
      </span>
      <ChevronsUpDownIcon className="size-3.5 shrink-0 text-sidebar-muted-foreground/70" />
    </button>
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverPopup
        width="md"
        padding="compact"
        side={props.compact ? "right" : "top"}
        align={props.compact ? "end" : "start"}
        aria-label="Your account"
      >
        <AccountMenu profile={profile} usage={usage} onClose={() => setOpen(false)} />
      </PopoverPopup>
    </Popover>
  );
}
