import { useEffect } from "react";
import { useNavigate, useRouter, type AnyRoute } from "@tanstack/react-router";
import { prefetchSettingsData } from "./settingsData";
// Aldo's settings nav (SettingsSidebarNav.tsx, in Aldo): Account & billing at its
// head, then its organization for someone in one, then its pages in two groups
// (settings.logic.ts ALDO_SETTINGS_NAV). Projects appears when the user has at
// least one project; Code appears only when Developer tools is on.

import {
  ArchiveIcon,
  BellIcon,
  Building2Icon,
  CodeXmlIcon,
  CpuIcon,
  FolderKanbanIcon,
  HistoryIcon,
  KeyRoundIcon,
  PlugIcon,
  RepeatIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  UserRoundIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import { useOptionalSettingsScope } from "../components/settings/SettingsScopeContext";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../components/ui/sidebar";
import type { SettingsPath } from "../components/settings/settingsSearch";
import { cn } from "~/lib/utils";
import { AldoAvatar, profileName, useAldoProfile } from "./AldoAccountMenu";
import { useAldoDeveloperTools } from "./developerTools";
import { useAldoHomeFeed } from "./homeFeed";
import { ALDO_SETTINGS_NAV, aldoSettingsNav, aldoSettingsNavActive } from "./settings.logic";
import { settingsAccounts, settingsApps, settingsIntegrations, settingsOrg } from "./settingsData";
import { aldoAccountSummary, aldoConnectionsSummary } from "./settingsHome.logic";
import { useSettingsResource } from "./settingsResource";

export const ALDO_SETTINGS_ICONS: Partial<Record<SettingsPath, LucideIcon>> = {
  "/settings/organization": Building2Icon,
  "/settings/members": UsersIcon,
  "/settings/activity": HistoryIcon,
  "/settings/agents": CpuIcon,
  "/settings/permissions": ShieldCheckIcon,
  "/settings/instructions": UserRoundIcon,
  "/settings/memory": UserRoundIcon,
  "/settings/skills": UserRoundIcon,
  "/settings/notifications": BellIcon,
  "/settings/phone": BellIcon,
  "/settings/connections": PlugIcon,
  "/settings/vault": KeyRoundIcon,
  "/settings/general": SlidersHorizontalIcon,
  "/settings/appearance": SlidersHorizontalIcon,
  "/settings/projects": FolderKanbanIcon,
  "/settings/code": CodeXmlIcon,
  "/settings/scheduled-tasks": RepeatIcon,
  "/settings/archived": ArchiveIcon,
};

/** The nav's groups for this account, with its organization and Projects when present. */
export function useAldoSettingsNav() {
  const developer = useAldoDeveloperTools();
  const organization = useSettingsResource(settingsOrg).data?.name ?? null;
  const hasProjects = (useOptionalSettingsScope()?.groups.length ?? 0) > 0;
  return aldoSettingsNav({ developer, organization, hasProjects });
}

/** How the connections stand, for the nav's and the phone list's line on them. */
export function useAldoConnectionsSummary() {
  const accounts = useSettingsResource(settingsAccounts).data;
  const integrations = useSettingsResource(settingsIntegrations).data;
  const apps = useSettingsResource(settingsApps).data;
  return aldoConnectionsSummary({ accounts, integrations, apps });
}

/** Who's signed in, at the head of the nav: their account page, with its plan and credits. */
export function AldoSettingsAccountCard(props: {
  readonly active: boolean;
  readonly onOpen: () => void;
}) {
  const profile = useAldoProfile();
  const summary = useAldoHomeFeed((s) => aldoAccountSummary(s.home?.usage));
  return (
    <button
      type="button"
      aria-current={props.active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        props.active ? "bg-sidebar-row-active" : "hover:bg-sidebar-row-hover",
      )}
      onClick={props.onOpen}
    >
      <AldoAvatar profile={profile} />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate font-medium text-sidebar-foreground text-sm">
          {profileName(profile)}
        </span>
        <span className="truncate text-[11px] text-sidebar-muted-foreground">
          {summary ?? "Account & billing"}
        </span>
      </span>
    </button>
  );
}

export function AldoSettingsNav(props: {
  readonly pathname: string;
  readonly onNavigate: (to: SettingsPath) => void;
}) {
  const router = useRouter();
  const navigate = useNavigate();
  const nav = useAldoSettingsNav();
  const connections = useAldoConnectionsSummary();
  // Settings pages sit under the chat layout: their route ids carry its prefix.
  const warmRoute = (path: SettingsPath) => {
    const route: AnyRoute | undefined =
      router.routesById[`/_chat${path}` as keyof typeof router.routesById];
    if (route) void Promise.resolve(router.loadRouteChunk(route)).catch(() => undefined);
  };
  useEffect(() => {
    const warm = () => {
      prefetchSettingsData();
      const paths: ReadonlyArray<SettingsPath> = [
        ...ALDO_SETTINGS_NAV.flatMap((group) =>
          group.items.flatMap((item) => [item.to, ...(item.also ?? [])] as SettingsPath[]),
        ),
        "/settings/account",
        "/settings/projects",
      ];
      for (const path of paths) warmRoute(path);
    };
    const timer = window.setTimeout(warm, 0);
    return () => window.clearTimeout(timer);
  }, [router]);
  return (
    <div className="flex flex-col gap-3">
      {nav.map((group) => (
        <div key={group.group} className="flex flex-col gap-0.5">
          <p className="px-2 pb-0.5 text-sidebar-muted-foreground/70 text-xs">{group.group}</p>
          <SidebarMenu>
            {group.items.map((item) => {
              const Icon = ALDO_SETTINGS_ICONS[item.to] ?? SlidersHorizontalIcon;
              const attention =
                item.to === "/settings/connections" && connections?.broken
                  ? connections.text
                  : null;
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    onMouseEnter={() => warmRoute(item.to)}
                    onFocus={() => warmRoute(item.to)}
                    isActive={aldoSettingsNavActive(item, props.pathname)}
                    onClick={() => props.onNavigate(item.to)}
                  >
                    <Icon />
                    <span className="flex-1 truncate">{item.label}</span>
                    {attention ? (
                      <span
                        role="img"
                        aria-label={attention}
                        className="size-1.5 shrink-0 rounded-full bg-warning"
                      />
                    ) : null}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </div>
      ))}
      <div className="border-sidebar-border/60 border-t pt-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => void navigate({ to: "/routines" })}>
              <RepeatIcon />
              <span className="flex-1 truncate">Routines</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </div>
    </div>
  );
}
