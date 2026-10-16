// Above the account at the foot of Aldo's sidebar (SidebarChrome.tsx): the
// user's other places, by name. Settings and usage are in the account menu
// (AldoAccountMenu.tsx).

import { useLocation, useNavigate } from "@tanstack/react-router";
import { ArchiveIcon, LibraryBigIcon, RepeatIcon } from "lucide-react";
import type { ReactNode } from "react";

import { PullRequestGlyph } from "../components/pullRequest/pullRequestIcons";
import { readPullRequestListPreferences } from "../components/pullRequest/pullRequestListPreferences";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../components/ui/sidebar";

function Place(props: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={props.active} onClick={props.onClick}>
        {props.icon}
        <span className="truncate">{props.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AldoSidebarLinks(props: {
  readonly pullRequests: boolean;
  /** Closes the sidebar on a phone. */
  readonly onNavigate: () => void;
}) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const go = (to: "/library" | "/routines" | "/settings/archived") => {
    props.onNavigate();
    void navigate({ to });
  };
  return (
    <SidebarMenu aria-label="Places">
      <Place
        icon={<LibraryBigIcon />}
        label="Library"
        active={pathname === "/library"}
        onClick={() => go("/library")}
      />
      <Place
        icon={<RepeatIcon />}
        label="Routines"
        active={pathname === "/routines"}
        onClick={() => go("/routines")}
      />
      {props.pullRequests ? (
        <Place
          icon={<PullRequestGlyph.pullRequest />}
          label="Pull requests"
          active={pathname === "/pull-requests"}
          onClick={() => {
            props.onNavigate();
            void navigate({ to: "/pull-requests", search: readPullRequestListPreferences() });
          }}
        />
      ) : null}
      <Place
        icon={<ArchiveIcon />}
        label="Archive"
        active={pathname === "/settings/archived"}
        onClick={() => go("/settings/archived")}
      />
    </SidebarMenu>
  );
}
