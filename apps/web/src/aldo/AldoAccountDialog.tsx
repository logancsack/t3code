// The user's account, from the foot of Aldo's sidebar (AldoSidebar.tsx): who's
// signed in (their name and picture from their sign-in), their plan and
// credits, where everything about their account lives (the agents and
// accounts they connected, what Aldo remembers, their vault, how the app
// looks), managing their sign-in itself, and signing out. An Aldo that can't
// say who's signed in still shows the rest.

import { useNavigate } from "@tanstack/react-router";
import {
  ArrowUpRightIcon,
  BotIcon,
  BrainIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  FolderGit2Icon,
  KeyRoundIcon,
  LogOutIcon,
  PaletteIcon,
  PlugIcon,
  ScrollTextIcon,
  SettingsIcon,
} from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";
import { create } from "zustand";

import { Button } from "../components/ui/button";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "../components/ui/dialog";
import { Switch } from "../components/ui/switch";
import { cn } from "~/lib/utils";
import { fetchAldoProfile, type AldoHomeUsage, type AldoProfile } from "./cloud";
import { useAldoHomeFeed } from "./homeFeed";

// ---------------------------------------------------------------------------
// Who's signed in, asked once per page.

let profileRequest: Promise<AldoProfile | null> | null = null;

/** The signed-in user; undefined until it's known, null where this Aldo can't say. */
export function useAldoProfile(): AldoProfile | null | undefined {
  const [profile, setProfile] = useState<AldoProfile | null | undefined>(undefined);
  useEffect(() => {
    let current = true;
    profileRequest ??= fetchAldoProfile().catch(() => null);
    void profileRequest.then((next) => {
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
// Which sidebar: Aldo's (the default), or T3's own, kept per device.

const CLASSIC_KEY = "aldo:sidebar:classic";

function storedClassic(): boolean {
  try {
    return window.localStorage.getItem(CLASSIC_KEY) === "1";
  } catch {
    return false;
  }
}

export const useAldoClassicSidebar = create<{ readonly classic: boolean }>(() => ({
  classic: typeof window === "undefined" ? false : storedClassic(),
}));

export function setAldoClassicSidebar(classic: boolean): void {
  useAldoClassicSidebar.setState({ classic });
  try {
    window.localStorage.setItem(CLASSIC_KEY, classic ? "1" : "0");
  } catch {
    // Private mode: the choice lasts this page.
  }
}

// ---------------------------------------------------------------------------

const PLACES: ReadonlyArray<{
  readonly to: string;
  readonly label: string;
  readonly detail: string;
  readonly icon: ComponentType<{ className?: string }>;
}> = [
  {
    to: "/settings/providers",
    label: "Agents",
    detail: "Claude, Codex and the subscriptions they run on",
    icon: BotIcon,
  },
  {
    to: "/settings/source-control",
    label: "Git hosts",
    detail: "GitHub and the others your threads push to",
    icon: FolderGit2Icon,
  },
  {
    to: "/settings/integrations",
    label: "Connected accounts",
    detail: "Mail, calendar, phone and heads-ups",
    icon: PlugIcon,
  },
  { to: "/settings/memory", label: "Memory", detail: "What Aldo knows about you", icon: BrainIcon },
  {
    to: "/settings/instructions",
    label: "Instructions",
    detail: "How you like your agents to work",
    icon: ScrollTextIcon,
  },
  { to: "/settings/vault", label: "Vault", detail: "Secrets and saved logins", icon: KeyRoundIcon },
  { to: "/settings/appearance", label: "Appearance", detail: "Theme and fonts", icon: PaletteIcon },
];

function creditsLine(usage: AldoHomeUsage | null): string | null {
  const credits = usage?.credits;
  if (!credits) return null;
  return `${credits.used.toLocaleString()} of ${credits.included.toLocaleString()} credits used`;
}

export function AldoAccountDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly profile: AldoProfile | null | undefined;
  readonly usage: AldoHomeUsage | null;
}) {
  const navigate = useNavigate();
  const classic = useAldoClassicSidebar((s) => s.classic);
  const { profile, usage } = props;
  const go = (to: string) => {
    props.onOpenChange(false);
    void navigate({ to });
  };
  const credits = usage?.credits ?? null;
  const share = credits && credits.included > 0 ? Math.min(1, credits.used / credits.included) : 0;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-md" data-aldo-account="">
        <div className="flex items-center gap-3 px-6 pt-6 pb-4">
          <AldoAvatar profile={profile} className="size-12 text-sm" />
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-base">{profileName(profile)}</DialogTitle>
            <DialogDescription className="truncate">
              {profile?.name ? profile.email : "Signed in to Aldo"}
            </DialogDescription>
          </div>
          {profile ? (
            <Button
              size="sm"
              variant="outline"
              className="me-8 shrink-0"
              onClick={() => window.location.assign(profile.manageUrl)}
            >
              Manage
              <ArrowUpRightIcon />
            </Button>
          ) : null}
        </div>
        <div className="flex flex-col gap-4 px-6 pb-2">
          <button
            type="button"
            className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card/40 p-3 text-left transition-colors hover:bg-accent/50"
            onClick={() => go("/usage")}
          >
            <span className="flex items-center gap-2 text-sm">
              <span className="font-medium">{usage?.plan?.name ?? "Plan"}</span>
              <span className="ms-auto inline-flex items-center gap-0.5 text-muted-foreground text-xs">
                Plans & usage
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
              <span className="text-muted-foreground text-xs">
                Choose a plan, and see what your agents used
              </span>
            )}
          </button>
          <nav className="-mx-2 flex flex-col" aria-label="Account">
            {PLACES.map((place) => (
              <button
                key={place.to}
                type="button"
                className="flex items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent/60"
                onClick={() => go(place.to)}
              >
                <place.icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-sm">{place.label}</span>
                  <span className="block truncate text-muted-foreground text-xs">
                    {place.detail}
                  </span>
                </span>
                <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60" />
              </button>
            ))}
          </nav>
          <label className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-sm">Classic sidebar</span>
              <span className="block text-muted-foreground text-xs">
                Threads by project, as before
              </span>
            </span>
            <Switch checked={classic} onCheckedChange={(on) => setAldoClassicSidebar(on)} />
          </label>
        </div>
        <div className="flex items-center gap-2 border-border/60 border-t px-6 py-3">
          <Button size="sm" variant="ghost" onClick={() => go("/settings/general")}>
            <SettingsIcon />
            All settings
          </Button>
          {profile ? (
            <Button
              size="sm"
              variant="ghost"
              className="ms-auto text-destructive-foreground"
              onClick={() => window.location.assign(profile.signOutUrl)}
            >
              <LogOutIcon />
              Sign out
            </Button>
          ) : null}
        </div>
      </DialogPopup>
    </Dialog>
  );
}

/** Who's signed in, at the foot of the sidebar: their picture and name, opening their account. */
export function AldoProfileButton(props: { readonly className?: string }) {
  const profile = useAldoProfile();
  const usage = useAldoHomeFeed((s) => s.home?.usage ?? null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-sidebar-row-hover",
          props.className,
        )}
        aria-label="Your account"
        data-aldo-profile=""
        onClick={() => setOpen(true)}
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
      <AldoAccountDialog open={open} onOpenChange={setOpen} profile={profile} usage={usage} />
    </>
  );
}
