import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MicIcon } from "lucide-react";

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

/** Lives above the responsive sidebar so navigation does not unmount an explicitly opened
 * voice session. The view is deliberately chromeless: the embedded page ends the conversation
 * and asks to be closed, and Escape does the same. */
export function ManagedDevPcAgentProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openAgent = useMemo(() => () => setOpen(true), []);
  useEffect(() => {
    if (!open) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data: unknown = event.data;
      if (
        typeof data === "object" &&
        data !== null &&
        (data as { type?: unknown }).type === "aldo-agent:close"
      )
        setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (!isManagedDevPc || isLandingDemo()) return children;
  return (
    <AgentContext value={openAgent}>
      {children}
      {open
        ? createPortal(
            <section
              aria-label="Aldo Agent"
              className="fixed inset-0 z-50 bg-black"
              data-devpc-agent-view
            >
              {/* eslint-disable-next-line react/iframe-missing-sandbox -- trusted same-origin Aldo application with microphone access */}
              <iframe
                src="/_aldo/agent"
                title="Aldo Agent conversation"
                allow="microphone; autoplay"
                className="h-full w-full border-0"
              />
            </section>,
            document.body,
          )
        : null}
    </AgentContext>
  );
}
