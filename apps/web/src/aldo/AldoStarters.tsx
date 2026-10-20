// Starters under the first-run conversation: real requests, four at a time,
// each a card with about how long it takes, picked by what the user told the
// welcome they'd hand Aldo first (starters.logic.ts). A card fills the
// composer with the request to finish and send (it never sends it); "More
// ideas" shows the next four. One that needs more than words says so once
// picked: one that reads mail offers to connect Gmail, one on code the user's
// repositories once a git host is connected. They fold away once the user has
// a few threads (AldoConversationPage).

import {
  BookOpenIcon,
  Building2Icon,
  BugIcon,
  ChartLineIcon,
  ChartPieIcon,
  CodeIcon,
  EraserIcon,
  FileTextIcon,
  FileUserIcon,
  FilmIcon,
  ImageIcon,
  LandmarkIcon,
  ListChecksIcon,
  MailIcon,
  PenToolIcon,
  PresentationIcon,
  ReceiptIcon,
  ScaleIcon,
  ScissorsIcon,
  SearchIcon,
  SheetIcon,
  SignatureIcon,
  StoreIcon,
  TagIcon,
  TerminalIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "~/lib/utils";
import { openAldoRepositoryPicker } from "./AldoRepositoryPicker";
import { seedAldoComposer } from "./assistantSession";
import {
  aldoIntegrationConnectUrl,
  fetchAldoIntegrations,
  type AldoIntegration,
} from "./accountApi";
import { useAldoOnboardingState } from "./onboarding";
import {
  aldoStarterPage,
  aldoStartersFor,
  aldoStarterTime,
  STARTERS_AT_A_TIME,
  type AldoStarter,
  type AldoStarterIcon,
} from "./starters.logic";
import { FOCUS } from "./surface";

/** Threads the user has had before the starters fold away. */
export const STARTERS_UNTIL_THREADS = 3;

const ICONS: Record<AldoStarterIcon, LucideIcon> = {
  store: StoreIcon,
  tag: TagIcon,
  users: UsersIcon,
  "file-text": FileTextIcon,
  mail: MailIcon,
  sheet: SheetIcon,
  receipt: ReceiptIcon,
  eraser: EraserIcon,
  chart: ChartLineIcon,
  landmark: LandmarkIcon,
  presentation: PresentationIcon,
  signature: SignatureIcon,
  "file-user": FileUserIcon,
  book: BookOpenIcon,
  film: FilmIcon,
  "pen-tool": PenToolIcon,
  image: ImageIcon,
  scissors: ScissorsIcon,
  search: SearchIcon,
  scale: ScaleIcon,
  "pie-chart": ChartPieIcon,
  building: Building2Icon,
  code: CodeIcon,
  bug: BugIcon,
  terminal: TerminalIcon,
  "list-checks": ListChecksIcon,
};

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
    // One that's connected but failing needs connecting again (AldoConnectionsPage), so it's not mail yet.
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

function StarterCard(props: { readonly starter: AldoStarter; readonly onPick: () => void }) {
  const { starter } = props;
  const Icon = ICONS[starter.icon];
  return (
    <button
      type="button"
      className={cn(
        "flex h-full w-full items-start gap-3 rounded-2xl border border-foreground/[0.08] bg-card px-3.5 pt-3 pb-2.5 text-left transition-[border-color,box-shadow] duration-150 hover:border-foreground/[0.16] hover:shadow-[0_2px_8px_-4px_rgb(0_0_0/0.1)] dark:border-white/[0.08] dark:bg-white/[0.035] dark:hover:border-white/[0.16]",
        FOCUS,
      )}
      onClick={props.onPick}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-foreground/[0.05] text-foreground dark:bg-white/[0.07]">
        <Icon aria-hidden className="size-4" strokeWidth={1.75} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="font-medium text-[14px] text-foreground leading-5">{starter.title}</span>
        <span className="mt-0.5 text-[13px] text-muted-foreground leading-[18px]">
          {starter.detail}
        </span>
        <span className="mt-1.5 text-muted-foreground/75 text-xs">{aldoStarterTime(starter)}</span>
      </span>
    </button>
  );
}

export function AldoStarters(props: {
  /** Whether a git host is connected, for "or one of your repositories". */
  readonly sourceReady: boolean;
}) {
  const onboarding = useAldoOnboardingState();
  const interests = onboarding?.interests ?? null;
  const starters = useMemo(() => aldoStartersFor(interests), [interests]);
  const { mail, google } = useMailConnected();
  const [picked, setPicked] = useState<AldoStarter | null>(null);
  const [page, setPage] = useState(0);
  const link = `rounded-sm font-medium text-foreground underline decoration-foreground/25 underline-offset-4 hover:decoration-foreground ${FOCUS}`;
  const more =
    picked?.needs === "mail" && mail === false && google ? (
      <>
        This needs your mail.{" "}
        <button type="button" className={link} onClick={connectGmail}>
          Connect Gmail
        </button>
      </>
    ) : picked?.needs === "repository" && props.sourceReady ? (
      <>
        Or start from{" "}
        <button type="button" className={link} onClick={() => openAldoRepositoryPicker("existing")}>
          one of your repositories
        </button>
      </>
    ) : null;
  // Until the welcome's answer is known, so they don't change under the user.
  if (onboarding === undefined) return null;
  return (
    <div className="flex flex-col items-center gap-3">
      <ul className="grid w-full gap-2.5 sm:grid-cols-2">
        {aldoStarterPage(starters, page).map((starter) => (
          <li key={starter.id}>
            <StarterCard
              starter={starter}
              onPick={() => {
                seedAldoComposer(starter.words);
                setPicked(starter);
              }}
            />
          </li>
        ))}
      </ul>
      {more ? (
        <p data-aldo-arrive="" className="text-[13px] text-muted-foreground leading-5">
          {more}
        </p>
      ) : null}
      {starters.length > STARTERS_AT_A_TIME ? (
        <button
          type="button"
          className={cn(
            "rounded-full px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground",
            FOCUS,
          )}
          onClick={() => setPage((current) => current + 1)}
        >
          More ideas
        </button>
      ) : null}
    </div>
  );
}
