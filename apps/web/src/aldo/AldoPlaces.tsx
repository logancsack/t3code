// Aldo's own pages, linked from the account menu (AldoAccountMenu.tsx):
// the Library, what the user's agents shared, and the routines, what runs on
// its own. Each is a page like Usage, with its title in
// the top bar; Escape goes back.

import { useEffect, useState, type ReactNode } from "react";

import { ScrollArea } from "../components/ui/scroll-area";
import { SidebarInset } from "../components/ui/sidebar";
import { Skeleton } from "../components/ui/skeleton";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../components/WorkspacePageContainer";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { isElectron } from "../env";
import { useEscapeToGoBack } from "../hooks/useNavigateBack";
import { AldoSharedFiles } from "./AldoLibrary";
import { RoutinesSection } from "./AldoRoutines";
import { refreshAldoHome, useAldoHomeRead } from "./homeFeed";

function AldoPlacePage(props: {
  readonly title: string;
  readonly about?: string;
  readonly children: ReactNode;
}) {
  useEscapeToGoBack();
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>
          <WorkspaceBreadcrumb ariaLabel={`${props.title} breadcrumb`}>
            <WorkspaceBreadcrumbItem current>
              <h1>{props.title}</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        </WorkspacePageHeader>
        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer>
            {props.about ? <p className="text-muted-foreground text-sm">{props.about}</p> : null}
            {props.children}
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

/** /library: everything the user's agents shared by link. */
export function AldoLibraryPage() {
  return (
    <AldoPlacePage
      title="Library"
      about="Pages and files your agents shared by link, newest first. A public link opens for anyone who has it; one only you can open asks for your Aldo sign-in. Stop sharing turns its link off at once."
    >
      {/* The list's rows are inset for settings; here they line up with the page. */}
      <div className="-mx-3 flex flex-col gap-2 sm:-mx-4">
        <AldoSharedFiles />
      </div>
    </AldoPlacePage>
  );
}

/** /routines: what runs on its own, each with Run now, Pause and Remove, and a new one. */
export function AldoRoutinesPage() {
  const { home, error, supported } = useAldoHomeRead();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    // The routines section says what they are itself.
    <AldoPlacePage title="Routines">
      {home?.routines ? (
        <RoutinesSection
          routines={home.routines}
          now={now}
          onChanged={() => void refreshAldoHome()}
        />
      ) : home || supported === false ? (
        <p className="text-muted-foreground text-sm">This Aldo doesn't have routines yet.</p>
      ) : error ? (
        <p className="text-destructive-foreground text-sm">{error}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>
      )}
    </AldoPlacePage>
  );
}
