// Settings → Personalization: what the user's agents know of them, in three
// tabs, one page each (Instructions, Memory, Skills). The nav lights
// Personalization on any of them (ALDO_SETTINGS_NAV).

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { SettingsPageContainer } from "../components/settings/settingsLayout";

const TABS = [
  { to: "/settings/instructions", label: "Instructions" },
  { to: "/settings/memory", label: "Memory" },
  { to: "/settings/skills", label: "Skills" },
] as const;

export function AldoPersonalizationPage(props: { readonly children: ReactNode }) {
  return (
    <SettingsPageContainer>
      <nav
        aria-label="Personalization"
        className="flex gap-0.5 self-start rounded-lg bg-input/40 p-0.5"
      >
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            replace
            className="inline-flex h-7 items-center rounded-md px-3 text-muted-foreground text-sm transition-colors hover:bg-background/55 hover:text-foreground data-[status=active]:bg-background data-[status=active]:text-foreground data-[status=active]:shadow-xs/10 dark:hover:bg-input/32 dark:data-[status=active]:bg-input/72"
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {props.children}
    </SettingsPageContainer>
  );
}
