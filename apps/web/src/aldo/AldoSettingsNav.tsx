import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { prefetchSettingsData } from "./settingsData";
// Aldo's settings nav (SettingsSidebarNav.tsx, in Aldo): the account at its
// head, then its pages in groups (settings.logic.ts ALDO_SETTINGS_NAV), Code
// only with the developer tools (developerTools.ts). A connection that stopped
// working puts a dot on Connections.

import {
  ArchiveIcon,
  BellIcon,
  BotIcon,
  CodeXmlIcon,
  KeyRoundIcon,
  PaletteIcon,
  PlugIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SmartphoneIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";

import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../components/ui/sidebar";
import type { SettingsPath } from "../components/settings/settingsSearch";
import { cn } from "~/lib/utils";
import { AldoAvatar, profileName, useAldoProfile } from "./AldoAccountMenu";
import { useAldoDeveloperTools } from "./developerTools";
import { useAldoHomeFeed } from "./homeFeed";
import { ALDO_SETTINGS_NAV, aldoSettingsNav, aldoSettingsNavActive } from "./settings.logic";
import { settingsAccounts, settingsApps, settingsIntegrations } from "./settingsData";
import { aldoAccountSummary, aldoConnectionsSummary } from "./settingsHome.logic";
import { useSettingsResource } from "./settingsResource";

export const ALDO_SETTINGS_ICONS: Partial<Record<SettingsPath, LucideIcon>> = {
  "/settings/agents": BotIcon,
  "/settings/permissions": ShieldCheckIcon,
  "/settings/instructions": SparklesIcon,
  "/settings/connections": PlugIcon,
  "/settings/vault": KeyRoundIcon,
  "/settings/appearance": PaletteIcon,
  "/settings/general": SlidersHorizontalIcon,
  "/settings/notifications": BellIcon,
  "/settings/phone": SmartphoneIcon,
  "/settings/code": CodeXmlIcon,
  "/settings/archived": ArchiveIcon,
};

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
          {summary ?? "Account and plan"}
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
  const nav = aldoSettingsNav({ developer: useAldoDeveloperTools() });
  const connections = useAldoConnectionsSummary();
  useEffect(() => {
    const warm = () => {
      prefetchSettingsData();
      const paths: ReadonlyArray<SettingsPath> = [
        ...ALDO_SETTINGS_NAV.flatMap((group) =>
          group.items.flatMap((item) => [item.to, ...(item.also ?? [])] as SettingsPath[]),
        ),
        "/settings/account",
      ];
      for (const path of paths) {
        const route = router.routesById[path];
        if (route) void Promise.resolve(router.loadRouteChunk(route)).catch(() => undefined);
      }
    };
    const timer = window.setTimeout(warm, 0);
    return () => window.clearTimeout(timer);
  }, [router]);
  return (
    <nav aria-label="Settings sections" className="flex flex-col gap-3">
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
                    onMouseEnter={() => {
                      void Promise.resolve(router.loadRouteChunk(router.routesById[item.to])).catch(
                        () => undefined,
                      );
                    }}
                    onFocus={() => {
                      void Promise.resolve(router.loadRouteChunk(router.routesById[item.to])).catch(
                        () => undefined,
                      );
                    }}
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
    </nav>
  );
}
