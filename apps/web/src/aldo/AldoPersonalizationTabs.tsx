// Settings → About you: what agents know about you, in three full-width tabs
// (Memory, Instructions, Skills). The nav lights "About you" on any of them.

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { SettingsPageContainer } from "../components/settings/settingsLayout";

const TABS = [
  { to: "/settings/memory", label: "Memory" },
  { to: "/settings/instructions", label: "Instructions" },
  { to: "/settings/skills", label: "Skills" },
] as const;

export function AldoPersonalizationPage(props: { readonly children: ReactNode }) {
  return (
    <SettingsPageContainer>
      <nav
        aria-label="About you"
        className="grid w-full grid-cols-3 gap-0.5 rounded-lg bg-input/40 p-0.5 sm:inline-flex sm:w-auto sm:self-start"
      >
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            replace
            className="inline-flex h-11 items-center justify-center rounded-md px-3 text-[15px] font-medium text-muted-foreground transition-colors hover:bg-background/55 hover:text-foreground data-[status=active]:bg-background data-[status=active]:text-foreground data-[status=active]:shadow-xs/10 sm:h-7 sm:px-3.5 sm:text-sm dark:hover:bg-input/32 dark:data-[status=active]:bg-input/72"
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {props.children}
    </SettingsPageContainer>
  );
}
