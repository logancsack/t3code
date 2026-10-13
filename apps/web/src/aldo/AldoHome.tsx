// The home screen under Aldo: the user's agents' work, with Aldo as the way to
// act on it, in two views (kept per device, homeFeed.ts). Aldo's view, the
// default, is a conversation (AldoConversationPage.tsx): what's waiting and
// what's running pinned on top, what Aldo did shown live, a thread peeked at
// beside it. The board answers four questions in order: what needs me (what
// waits on a tap first), what's happening, what got done, what's coming; with
// Aldo beside it (right, or under it on a phone) as a pane. Both come from
// Aldo's one read of the account (homeFeed.ts), which never wakes a machine.
// Until agents can run (on Aldo's models or a subscription of the user's) it
// asks for setup first; after, one line offers what's missing (AldoSetup.tsx),
// and the first few threads start from tappable starters (AldoStarters.tsx).
// An Aldo without the home read shows what Aldo's overview says instead; one
// without the assistant shows the board alone. On a phone the two are Aldo's
// conversation and the Threads tab (AldoAgentsTab.tsx): every thread by what
// it needs, made for a thumb.

import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  ChevronDownIcon,
  CompassIcon,
  FolderGit2Icon,
  LayoutGridIcon,
  PlusIcon,
  SparklesIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { Button } from "../components/ui/button";
import { Group, GroupSeparator } from "../components/ui/group";
import { Kbd } from "../components/ui/kbd";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import { Skeleton } from "../components/ui/skeleton";
import { SidebarInset } from "../components/ui/sidebar";
import { cn } from "~/lib/utils";
import { useAldoAccounts } from "./AldoAccountsPanel";
import { AldoAgentsTab } from "./AldoAgentsTab";
import { AldoAtAGlance, AldoPane, useAldoAssistantAvailable } from "./AldoAssistant";
import { AldoConversationPage } from "./AldoConversationPage";
import {
  CapacitySection,
  ConversationRow,
  HealthStrip,
  LogSection,
  PolicySection,
  Section,
  ShipLaneSection,
  UpcomingSection,
} from "./AldoHomeBoard";
import { ApprovalsSection } from "./AldoApprovals";
import { NeedsYouCard } from "./AldoHomeInbox";
import { RoutinesSection } from "./AldoRoutines";
import { AGENT_KINDS, AldoSetupCard, AldoSetupLine } from "./AldoSetup";
import { AldoStarters, STARTERS_UNTIL_THREADS } from "./AldoStarters";
import { seedAldoComposer, sendText, useAldoAssistant } from "./assistantSession";
import {
  aldoOffersItsModels,
  aldoSupportsGeneralThreads,
  aldoSupportsProjects,
  subscribeAldoEnvironments,
  type AldoHomeConversation,
} from "./cloud";
import {
  refreshAldoHome,
  setAldoHomeView,
  useAldoHomeRead,
  useAldoHomeView,
  type AldoHomeView,
} from "./homeFeed";
import { HOST_KINDS, openAldoRepositoryPicker } from "./AldoRepositoryPicker";
import { useStartAldoThread } from "./newThread";
import {
  boardFor,
  chipPrompt,
  composerChips,
  filterHome,
  healthIssues,
  isNewSince,
  moveSelection,
  planRunning,
  repoChips,
  repoName,
} from "./home.logic";
import { loadAldoBrief } from "./briefFeed";
import { aldoWaitingCount } from "./decisions.logic";
import { useIsMobile } from "../hooks/useMediaQuery";

const LAST_SEEN_KEY = "aldo:home:seen";
/** Shows "now" moving: elapsed times tick without a fetch. */
const TICK_MS = 30_000;

/** When the user last looked at the home screen, for what's new since; recorded as they leave. */
function useLastSeen(): string | null {
  const [lastSeen] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(LAST_SEEN_KEY);
    } catch {
      return null;
    }
  });
  useEffect(() => {
    const record = () => {
      try {
        window.localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
      } catch {
        // Private mode: nothing is new next time.
      }
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") record();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", record);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", record);
      record();
    };
  }, []);
  return lastSeen;
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function inField(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return (
    element.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(element.tagName) ||
    element.closest("[role=dialog]") !== null
  );
}

export function AldoHome() {
  const { accounts, refresh: refreshAccounts } = useAldoAccounts();
  const assistant = useAldoAssistantAvailable();
  const { home, supported, error } = useAldoHomeRead();
  const refresh = refreshAldoHome;
  const view = useAldoHomeView((s) => s.view);
  const mobile = useIsMobile();
  // Aldo's view needs Aldo; without it there's only the board.
  const aldoView = assistant === true && view === "aldo";
  const lastSeen = useLastSeen();
  const now = useNow();
  const navigate = useNavigate();

  // The day's first look at the home screen makes Aldo's brief, whichever view it opens on;
  // a page left open overnight has the new day's when it's looked at again.
  useEffect(() => {
    if (assistant !== true) return;
    void loadAldoBrief();
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadAldoBrief();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [assistant]);
  const [repo, setRepo] = useState<string | null>(null);
  /** The selected conversation, by ref: it stays selected as the board refreshes around it. */
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const conversationEmpty = useAldoAssistant((s) => s.historyLoaded && s.entries.length === 0);

  const sourceHost = HOST_KINDS.find((kind) => accounts?.[kind]?.connected === true);
  const sourceReady = sourceHost !== undefined;
  const agentReady = AGENT_KINDS.some((kind) => accounts?.[kind]?.connected === true);
  // Threads that aren't in a repository need no git host; an older Aldo's do (the directory says, once listed).
  const general = useSyncExternalStore(
    subscribeAldoEnvironments,
    aldoSupportsGeneralThreads,
    () => false,
  );
  // Aldo's own projects need no git host either.
  const projects = useSyncExternalStore(
    subscribeAldoEnvironments,
    aldoSupportsProjects,
    () => false,
  );
  // Agents run on Aldo's models once the plan is active: a subscription of the user's is an upgrade.
  const aldoModels = useSyncExternalStore(
    subscribeAldoEnvironments,
    aldoOffersItsModels,
    () => false,
  );
  const canRun = agentReady || (aldoModels && home !== null && planRunning(home.usage));
  // Somewhere to work: a git host, General, or an Aldo project (which needs no git host).
  const setupDone = canRun && (sourceReady || general || projects);
  /** The first few threads: starters show, and the setup line until both are connected. */
  const firstRun = home !== null && home.conversations.length < STARTERS_UNTIL_THREADS;

  const repos = useMemo(() => (home ? repoChips(home) : []), [home]);
  // A repository whose chip has gone (its last conversation left) no longer narrows anything.
  const activeRepo = repo !== null && repos.includes(repo) ? repo : null;
  const shown = useMemo(() => (home ? filterHome(home, activeRepo) : null), [home, activeRepo]);
  const board = useMemo(() => (shown ? boardFor(shown.conversations, now) : null), [shown, now]);
  const issues = useMemo(() => (home ? healthIssues(home) : []), [home]);
  const chips = useMemo(
    () => composerChips(home, { conversationEmpty, lastSeen }),
    [home, conversationEmpty, lastSeen],
  );
  /** Everything j and k move over, in the order it's on the board. */
  const selectable: ReadonlyArray<AldoHomeConversation> = useMemo(
    () => (board ? [...board.needsYou, ...board.working, ...board.done] : []),
    [board],
  );
  const selectedIndex = selectable.findIndex((c) => c.ref === selectedRef);
  const selected = selectedIndex === -1 ? null : selectedIndex;

  const open = useCallback(
    (c: AldoHomeConversation) =>
      void navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId: c.thread.environmentId as EnvironmentId,
          threadId: c.thread.threadId as ThreadId,
        },
      }),
    [navigate],
  );

  useEffect(() => {
    // Aldo's view has keys of its own (AldoConversationPage).
    if (aldoView) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || inField(event.target)) return;
      if (event.key === "/") {
        event.preventDefault();
        seedAldoComposer("");
        return;
      }
      if (
        (event.key === "Enter" || event.key === "o") &&
        selected !== null &&
        selectable[selected]
      ) {
        event.preventDefault();
        open(selectable[selected]!);
        return;
      }
      const next = moveSelection(selected, selectable.length, event.key);
      if (next === selected) return;
      event.preventDefault();
      setSelectedRef(next === null ? null : selectable[next]!.ref);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aldoView, open, selectable, selected]);

  useEffect(() => {
    if (selected === null) return;
    boardRef.current
      ?.querySelector<HTMLElement>(`[data-selected]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const onChip = useCallback(
    (chip: string) => {
      const words = chipPrompt(chip, lastSeen, Date.now());
      if (words.endsWith(": ")) seedAldoComposer(words);
      else sendText(words);
    },
    [lastSeen],
  );

  if (assistant === null) return <SidebarInset className="h-dvh bg-background" />;

  // Nothing can run yet: the card asks for a subscription (or, on an older Aldo
  // without General threads, a repository too). Once agents can run, one line
  // offers what's missing, for the first few threads.
  const setupLine =
    accounts && setupDone && (!agentReady || !sourceReady) && firstRun ? (
      <AldoSetupLine accounts={accounts} sourceReady={sourceReady} onConnected={refreshAccounts} />
    ) : null;
  const setupCard =
    accounts && !setupDone ? (
      <AldoSetupCard
        accounts={accounts}
        sourceHost={sourceHost}
        general={general}
        assistant={assistant === true}
        onConnected={refreshAccounts}
      />
    ) : null;
  const setup = setupCard ?? setupLine;
  // In Aldo's empty conversation, the starters, with the line under them.
  const welcome =
    firstRun && setupCard === null ? (
      <>
        <AldoStarters sourceReady={sourceReady} />
        {setupLine}
      </>
    ) : null;
  const conversationSetup = welcome && conversationEmpty ? setupCard : setup;
  const newMenu = (
    <NewMenu general={general} projects={projects || sourceReady} repositories={sourceReady} />
  );

  if (mobile && assistant === true) {
    const tabs = (
      <PhoneTabs
        view={aldoView ? "aldo" : "agents"}
        waiting={home ? aldoWaitingCount(home, now) : 0}
      />
    );
    if (!aldoView) {
      return <AldoAgentsTab header={tabs} home={home} now={now} setup={setup} issues={issues} />;
    }
    return (
      <AldoConversationPage
        home={home}
        supported={supported}
        now={now}
        viewSwitch={tabs}
        setup={conversationSetup}
        welcome={welcome}
        issues={issues}
        chips={chips}
        onChip={onChip}
      />
    );
  }

  const viewSwitch = assistant ? <ViewSwitch view={aldoView ? "aldo" : "board"} /> : null;
  if (aldoView) {
    return (
      <AldoConversationPage
        home={home}
        supported={supported}
        now={now}
        viewSwitch={viewSwitch}
        setup={conversationSetup}
        welcome={welcome}
        issues={issues}
        chips={chips}
        onChip={onChip}
      />
    );
  }

  const rowProps = (c: AldoHomeConversation) => ({
    conversation: c,
    repos,
    now,
    isNew: isNewSince(c.at, lastSeen),
    selected: c.ref === selectedRef,
    assistant: assistant === true,
    onSelect: () => setSelectedRef(c.ref),
    onActed: () => void refresh(),
  });

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex h-full min-h-0 min-w-0 flex-col lg:flex-row">
        <div ref={boardRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pt-14 pb-8 sm:px-5 sm:pt-6">
            <header className="flex flex-wrap items-center gap-2">
              {viewSwitch}
              <h1 className={cn("mr-auto font-semibold text-lg", viewSwitch && "sr-only")}>
                Your threads
              </h1>
              {viewSwitch ? <span className="mr-auto" /> : null}
              {newMenu}
            </header>
            {setup}
            {repos.length > 1 ? (
              <div className="flex flex-wrap gap-1.5">
                <RepoChip
                  label="Everything"
                  on={activeRepo === null}
                  onClick={() => setRepo(null)}
                />
                {repos.map((r) => (
                  <RepoChip
                    key={r}
                    label={repoName(r, repos)}
                    on={activeRepo === r}
                    onClick={() => setRepo(r)}
                  />
                ))}
              </div>
            ) : null}
            <HealthStrip issues={issues} />
            {error && !home ? <p className="text-destructive-foreground text-sm">{error}</p> : null}
            {supported === false ? <AldoAtAGlance /> : null}
            {supported === null && !home ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-10 w-full rounded-xl" />
                <Skeleton className="h-10 w-3/4 rounded-xl" />
              </div>
            ) : null}
            {board && shown ? (
              <>
                {/* Not narrowed by repository: what waits on a tap is the user's, wherever it came from. */}
                {home?.approvals ? (
                  <ApprovalsSection
                    approvals={home.approvals}
                    now={now}
                    onActed={() => void refresh()}
                  />
                ) : null}
                {board.needsYou.length > 0 ? (
                  <Section title="Needs you" count={board.needsYou.length}>
                    <ul className="flex flex-col gap-2">
                      {board.needsYou.map((c) => (
                        <NeedsYouCard key={c.ref} {...rowProps(c)} />
                      ))}
                    </ul>
                  </Section>
                ) : null}
                {board.working.length > 0 ? (
                  <Section title="Working now" count={board.working.length}>
                    <ul className="rounded-xl border border-border/60 bg-card/30 p-1.5">
                      {board.working.map((c) => (
                        <ConversationRow key={c.ref} {...rowProps(c)} />
                      ))}
                    </ul>
                  </Section>
                ) : null}
                {board.needsYou.length === 0 &&
                board.working.length === 0 &&
                board.done.length === 0 ? (
                  <div className="rounded-xl border border-border/60 border-dashed px-5 py-8 text-center">
                    <p className="font-medium text-sm">Nothing yet</p>
                    <p className="mt-1 text-muted-foreground text-xs">
                      {assistant
                        ? "What you start shows here: what needs you first, then what's working and what's done. Tell Aldo what to get done, or start a thread with New."
                        : "What you start shows here: what needs you first, then what's working and what's done. Start a thread with New: each gets an agent with its own computer."}
                    </p>
                  </div>
                ) : null}
                <ShipLaneSection
                  pullRequests={shown.pullRequests}
                  repos={repos}
                  now={now}
                  lastSeen={lastSeen}
                  onActed={() => void refresh()}
                />
                <UpcomingSection
                  deliveries={shown.upcoming}
                  now={now}
                  onActed={() => void refresh()}
                />
                {/* An older Aldo has no routines to show. */}
                {shown.routines ? (
                  <RoutinesSection
                    routines={shown.routines}
                    now={now}
                    onChanged={() => void refresh()}
                  />
                ) : null}
                {board.done.length > 0 ? (
                  <Section
                    title="Done"
                    count={board.done.length}
                    {...(lastSeen ? { hint: "new since you were last here is marked" } : {})}
                    action={
                      assistant ? (
                        <button
                          type="button"
                          className="text-muted-foreground text-xs hover:text-foreground"
                          onClick={() => onChip("Catch me up")}
                        >
                          Catch me up
                        </button>
                      ) : null
                    }
                  >
                    <ul className="rounded-xl border border-border/60 bg-card/30 p-1.5">
                      {board.done.map((c) => (
                        <ConversationRow key={c.ref} {...rowProps(c)} />
                      ))}
                    </ul>
                  </Section>
                ) : null}
                <LogSection actions={shown.actions} now={now} />
                <CapacitySection usage={shown.usage} spends={shown.spends} />
                <PolicySection policy={shown.policy} />
                {selectable.length > 0 ? (
                  <p className="hidden items-center gap-1.5 px-0.5 text-muted-foreground text-xs lg:flex">
                    <Kbd>j</Kbd>
                    <Kbd>k</Kbd> move <Kbd>↵</Kbd> open
                    {assistant ? (
                      <>
                        <Kbd>/</Kbd> ask Aldo
                      </>
                    ) : null}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
        {assistant ? (
          <AldoPane
            chips={chips}
            onChip={onChip}
            className="max-h-[60dvh] shrink-0 border-border/60 border-t lg:max-h-none lg:w-[26rem] lg:border-t-0 lg:border-l"
          />
        ) : null}
      </div>
    </SidebarInset>
  );
}

/** Aldo's view or the board, remembered on this device. */
function ViewSwitch(props: { readonly view: AldoHomeView }) {
  const option = (view: AldoHomeView, label: string, icon: ReactNode) => (
    <button
      type="button"
      aria-pressed={props.view === view}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-md px-2.5 font-medium text-sm transition-colors",
        props.view === view
          ? "bg-background text-foreground shadow-xs/5"
          : "text-muted-foreground hover:text-foreground",
      )}
      onClick={() => setAldoHomeView(view)}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div
      className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
      role="group"
      aria-label="View"
    >
      {option(
        "aldo",
        "Aldo",
        <span
          aria-hidden
          className="size-3.5 rounded-full bg-gradient-to-br from-primary/90 to-primary/50"
        />,
      )}
      {option("board", "Board", <LayoutGridIcon className="size-3.5" />)}
    </div>
  );
}

/** On a phone: Aldo's conversation, or the Threads tab with how many things wait on the user. */
function PhoneTabs(props: { readonly view: "aldo" | "agents"; readonly waiting: number }) {
  const option = (view: "aldo" | "agents", children: ReactNode) => (
    <button
      type="button"
      aria-pressed={props.view === view}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-full px-3.5 font-medium text-sm transition-colors",
        props.view === view
          ? "bg-background text-foreground shadow-xs/5"
          : "text-muted-foreground hover:text-foreground",
      )}
      onClick={() => setAldoHomeView(view)}
    >
      {children}
    </button>
  );
  return (
    <div
      className="flex items-center gap-0.5 rounded-full bg-muted p-0.5"
      role="group"
      aria-label="View"
    >
      {option(
        "aldo",
        <>
          <span
            aria-hidden
            className="size-3.5 rounded-full bg-gradient-to-br from-primary/90 to-primary/50"
          />
          Aldo
        </>,
      )}
      {option(
        "agents",
        <>
          Threads
          {props.waiting > 0 ? (
            <span className="rounded-full bg-warning/15 px-1.5 font-semibold text-[11px] text-warning-foreground">
              {props.waiting}
            </span>
          ) : null}
        </>,
      )}
    </div>
  );
}

function RepoChip(props: {
  readonly label: string;
  readonly on: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.on}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs transition-colors",
        props.on
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border/70 bg-card/40 text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

/**
 * One "New": a thread, the default when it's clicked, and in its menu a
 * project (an Aldo one needs no git host) or a thread in repositories, once
 * a git host is connected.
 */
function NewMenu(props: {
  readonly general: boolean;
  readonly projects: boolean;
  readonly repositories: boolean;
}) {
  // A General draft at once; an older Aldo can't start a thread outside a repository.
  const { start, starting } = useStartAldoThread();
  const thread = () => (props.general ? void start([]) : openAldoRepositoryPicker("existing"));
  return (
    <Group aria-label="New">
      <Button
        size="sm"
        onClick={thread}
        disabled={starting || (!props.general && !props.repositories)}
      >
        <PlusIcon className="size-4" />
        New
      </Button>
      <GroupSeparator />
      <Menu>
        <MenuTrigger render={<Button aria-label="More to start" size="icon-sm" />}>
          <ChevronDownIcon aria-hidden className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end" className="min-w-52">
          {props.general ? (
            <MenuItem onClick={thread}>
              <CompassIcon className="size-4" /> Thread
            </MenuItem>
          ) : null}
          <MenuItem disabled={!props.projects} onClick={() => openAldoRepositoryPicker("new")}>
            <SparklesIcon className="size-4" /> Project
          </MenuItem>
          {props.repositories ? (
            <MenuItem onClick={() => openAldoRepositoryPicker("existing")}>
              <FolderGit2Icon className="size-4" /> Thread in a repository
            </MenuItem>
          ) : null}
        </MenuPopup>
      </Menu>
    </Group>
  );
}
