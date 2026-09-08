import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MicIcon, Minimize2Icon, XIcon } from "lucide-react";

import { useSidebar } from "./ui/sidebar";
import { isManagedDevPc } from "../managedDevPc";
import { isLandingDemo } from "../landingDemo/mode";

const AgentContext = createContext<(() => void) | null>(null);

export function ManagedDevPcAgent() {
  const openAgent = useContext(AgentContext);
  const { isMobile, setOpenMobile } = useSidebar();
  if (!openAgent || !isManagedDevPc || isLandingDemo()) return null;
  return (
    <button
      type="button"
      onClick={() => {
        if (isMobile) setOpenMobile(false);
        openAgent();
      }}
      className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-sm text-sidebar-muted-foreground/80 outline-hidden hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      data-devpc-agent-button
    >
      <MicIcon className="size-5 shrink-0" aria-hidden />
      <span className="font-medium">Aldo Agent</span>
    </button>
  );
}

/** Lives above the responsive sidebar so navigation, minimization and mobile dismissal
 * do not unmount an explicitly opened voice session. */
export function ManagedDevPcAgentProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const openAgent = useMemo(
    () => () => {
      setOpen(true);
      setMinimized(false);
    },
    [],
  );
  if (!isManagedDevPc || isLandingDemo()) return children;
  return (
    <AgentContext value={openAgent}>
      {children}
      {open
        ? createPortal(
            <section
              aria-label="Aldo Agent"
              className="fixed right-3 bottom-3 z-50 flex w-[min(420px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border bg-background text-foreground shadow-2xl"
              style={{ height: minimized ? "auto" : "min(720px, calc(100dvh - 1.5rem))" }}
            >
              <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
                <MicIcon className="size-4" aria-hidden />
                <button
                  type="button"
                  className="flex-1 text-left text-sm font-medium"
                  onClick={() => setMinimized(false)}
                >
                  Aldo Agent
                </button>
                <button
                  type="button"
                  aria-label={minimized ? "Expand Aldo Agent" : "Minimize Aldo Agent"}
                  className="rounded p-2 hover:bg-muted"
                  onClick={() => setMinimized(!minimized)}
                >
                  <Minimize2Icon className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Close Aldo Agent and disconnect voice"
                  className="rounded p-2 hover:bg-muted"
                  onClick={() => setOpen(false)}
                >
                  <XIcon className="size-4" />
                </button>
              </div>
              {/* eslint-disable-next-line react/iframe-missing-sandbox -- trusted same-origin Aldo application with microphone access */}
              <iframe
                src="/_aldo/agent"
                title="Aldo Agent conversation"
                allow="microphone; autoplay"
                className="min-h-0 flex-1 border-0"
                style={{ display: minimized ? "none" : "block" }}
              />
            </section>,
            document.body,
          )
        : null}
    </AgentContext>
  );
}
