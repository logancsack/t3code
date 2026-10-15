// Starters under the first-run conversation: six kinds of work, three at first
// and the rest a tap away, each a quiet pill under the composer that fills it
// with a sentence to finish (never sends it). One that needs more than words says so once picked: "Sort my inbox"
// offers to connect Gmail, "Build something" the user's repositories once a
// git host is connected. They fold away once the user has a few threads
// (AldoConversationPage).

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
import { CHIP, FOCUS } from "./surface";

/** Threads the user has had before the starters fold away. */
export const STARTERS_UNTIL_THREADS = 3;

/** Starters shown before "More ideas". */
const FIRST = 3;

interface Starter {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly icon: LucideIcon;
  /** What it puts in the composer, to finish and send. */
  readonly words: string;
}

const STARTERS: ReadonlyArray<Starter> = [
  {
    id: "research",
    title: "Research something",
    detail: "A sourced brief as a Google Doc or PDF",
    icon: FileTextIcon,
    words: "Research this and write it up as a short brief with sources, as a Google Doc: ",
  },
  {
    id: "trip",
    title: "Plan a trip",
    detail: "Options checked on real sites, as a page to share",
    icon: PlaneIcon,
    words:
      "Plan a trip, with options checked on real sites, and give me a page I can share. Where, when and budget: ",
  },
  {
    id: "build",
    title: "Build something",
    detail: "A site or an app, from a sentence",
    icon: CodeIcon,
    words: "Build a small web app that: ",
  },
  {
    id: "deck",
    title: "Make a deck",
    detail: "Slides from your notes, a link or a topic",
    icon: PresentationIcon,
    words: "Make a slide deck from this: ",
  },
  {
    id: "inbox",
    title: "Sort my inbox",
    detail: "What needs you, with replies drafted",
    icon: MailIcon,
    words:
      "Go through my inbox from the last week: tell me what needs me, and draft replies for me to approve.",
  },
  {
    id: "project",
    title: "Run a project",
    detail: "A business or process, with files every thread shares",
    icon: BriefcaseIcon,
    words: "Set up a project, with notes and files every thread in it shares, for: ",
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
  const [picked, setPicked] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const link = `rounded-sm font-medium text-foreground underline decoration-foreground/25 underline-offset-4 hover:decoration-foreground ${FOCUS}`;
  const more =
    picked === "inbox" && mail === false && google ? (
      <>
        This needs your mail.{" "}
        <button type="button" className={link} onClick={connectGmail}>
          Connect Gmail
        </button>
      </>
    ) : picked === "build" && props.sourceReady ? (
      <>
        Or start from{" "}
        <button type="button" className={link} onClick={() => openAldoRepositoryPicker("existing")}>
          one of your repositories
        </button>
      </>
    ) : null;
  return (
    <div className="flex flex-col items-center gap-3">
      <ul className="flex flex-wrap justify-center gap-2">
        {(all ? STARTERS : STARTERS.slice(0, FIRST)).map((starter) => {
          const Icon = starter.icon;
          return (
            <li key={starter.id}>
              <button
                type="button"
                className={CHIP}
                aria-description={starter.detail}
                onClick={() => {
                  seedAldoComposer(starter.words);
                  setPicked(starter.id);
                }}
              >
                <Icon aria-hidden className="size-4 text-muted-foreground" strokeWidth={1.75} />
                {starter.title}
              </button>
            </li>
          );
        })}
        {all ? null : (
          <li>
            <button
              type="button"
              className={cn(CHIP, "bg-transparent dark:bg-transparent")}
              onClick={() => setAll(true)}
            >
              More ideas
            </button>
          </li>
        )}
      </ul>
      {more ? (
        <p data-aldo-arrive="" className="text-[13px] text-muted-foreground leading-5">
          {more}
        </p>
      ) : null}
    </div>
  );
}
