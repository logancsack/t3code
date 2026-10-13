// Starters under the first-run conversation: six kinds of work, each a card
// that fills the composer with a sentence to finish (never sends it). One that
// needs an account ("Sort my inbox") offers to connect it first; "Build
// something" offers the user's repositories once a git host is connected.
// They fold away once the user has a few threads (AldoConversationPage).

import {
  BriefcaseIcon,
  CodeIcon,
  FileTextIcon,
  MailIcon,
  PlaneIcon,
  PresentationIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "~/lib/utils";
import { openAldoRepositoryPicker } from "./AldoRepositoryPicker";
import { seedAldoComposer } from "./assistantSession";
import { aldoIntegrationConnectUrl, fetchAldoIntegrations, type AldoIntegration } from "./cloud";

/** Threads the user has had before the starters fold away. */
export const STARTERS_UNTIL_THREADS = 3;

interface Starter {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly icon: LucideIcon;
  readonly tint: string;
  /** What it puts in the composer, to finish and send. */
  readonly words: string;
}

const STARTERS: ReadonlyArray<Starter> = [
  {
    id: "research",
    title: "Research and write it up",
    detail: "A sourced brief as a Google Doc or PDF",
    icon: FileTextIcon,
    tint: "bg-sky-500/15 text-sky-500",
    words: "Research this and write it up as a short brief with sources, as a Google Doc: ",
  },
  {
    id: "deck",
    title: "Make a deck",
    detail: "Slides from your notes, a link or a topic",
    icon: PresentationIcon,
    tint: "bg-rose-500/15 text-rose-500",
    words: "Make a slide deck from this: ",
  },
  {
    id: "trip",
    title: "Plan a trip",
    detail: "Options checked on real sites, as a page to share",
    icon: PlaneIcon,
    tint: "bg-emerald-500/15 text-emerald-500",
    words:
      "Plan a trip, with options checked on real sites, and give me a page I can share. Where, when and budget: ",
  },
  {
    id: "inbox",
    title: "Sort my inbox",
    detail: "What needs you, with replies drafted",
    icon: MailIcon,
    tint: "bg-amber-500/15 text-amber-500",
    words:
      "Go through my inbox from the last week: tell me what needs me, and draft replies for me to approve.",
  },
  {
    id: "project",
    title: "Run a project",
    detail: "A business or process, with files every thread shares",
    icon: BriefcaseIcon,
    tint: "bg-violet-500/15 text-violet-500",
    words: "Set up a project, with notes and files every thread in it shares, for: ",
  },
  {
    id: "build",
    title: "Build something",
    detail: "A site or an app, from a sentence",
    icon: CodeIcon,
    tint: "bg-zinc-500/15 text-zinc-400",
    words: "Build a small web app that: ",
  },
];

/** Whether an account agents can read mail with is connected; null while that's unknown or this Aldo can't say. */
function useMailConnected(): { readonly mail: boolean | null; readonly google: boolean } {
  const [integrations, setIntegrations] = useState<ReadonlyArray<AldoIntegration> | null>(null);
  useEffect(() => {
    let current = true;
    const load = () =>
      void fetchAldoIntegrations()
        .then((next) => {
          if (current) setIntegrations(next);
        })
        .catch(() => undefined);
    load();
    // Back from connecting in a popup.
    window.addEventListener("focus", load);
    return () => {
      current = false;
      window.removeEventListener("focus", load);
    };
  }, []);
  if (!integrations) return { mail: null, google: false };
  const mail = integrations.some(
    // One that's connected but failing needs connecting again (AldoIntegrationsPanel), so it's not mail yet.
    (i) =>
      i.connected && i.error === null && (i.can ? i.can.includes("mail") : i.provider !== "link"),
  );
  const google = integrations.some((i) => i.provider === "google" && i.available);
  return { mail, google };
}

function connectGmail() {
  const url = aldoIntegrationConnectUrl("google");
  // With the popup blocked, sign in in this tab: Aldo sends it back to Settings after.
  if (!window.open(url, "aldo-integration", "popup,width=520,height=720")) {
    window.location.assign(url);
  }
}

export function AldoStarters(props: {
  /** Whether a git host is connected, for "or your repo". */
  readonly sourceReady: boolean;
}) {
  const { mail, google } = useMailConnected();
  return (
    <ul className="grid grid-cols-2 gap-2 text-left sm:grid-cols-3">
      {STARTERS.map((starter) => {
        const Icon = starter.icon;
        const extra =
          starter.id === "inbox" && mail === false && google ? (
            <button type="button" className="text-primary hover:underline" onClick={connectGmail}>
              connect Gmail
            </button>
          ) : starter.id === "build" && props.sourceReady ? (
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => openAldoRepositoryPicker("existing")}
            >
              or your repo
            </button>
          ) : null;
        return (
          <li
            key={starter.id}
            className="relative flex flex-col rounded-xl border border-border/60 bg-card/30 transition-colors hover:border-border hover:bg-accent/40"
          >
            <button
              type="button"
              className={cn(
                "flex w-full flex-1 flex-col items-start gap-1.5 p-3 text-left after:absolute after:inset-0 after:rounded-xl",
                extra && "pb-1",
              )}
              onClick={() => seedAldoComposer(starter.words)}
            >
              <span className={cn("rounded-md p-1.5", starter.tint)}>
                <Icon className="size-3.5" />
              </span>
              <span className="font-medium text-sm">{starter.title}</span>
              <span className="text-muted-foreground text-xs leading-snug">{starter.detail}</span>
            </button>
            {extra ? (
              // Above the card's own button, so it can be tapped on its own.
              <span className="relative z-10 block px-3 pb-3 text-xs">{extra}</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
