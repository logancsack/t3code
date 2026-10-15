// The home screen under Aldo: a conversation with Aldo (AldoConversationPage.tsx),
// where the user's agents' work shows as it happens, the way a teammate
// messages: what finished and shipped where it happened, what Aldo did as
// lines across the middle, what waits on the user as cards at the
// conversation's end (AldoUpNext.tsx), what's running and coming in Aldo's
// status at the top (AldoPresence.tsx). There's no second view to switch to:
// what matters is in the conversation, and a thread tapped in it opens; what
// runs under it (routines, what's due, pull requests, usage, rules) is a page
// that status opens (AldoUnderTheHood.tsx). It comes from Aldo's one read of the account
// (homeFeed.ts), which never wakes a machine. Until agents can run (on Aldo's
// models or a subscription of the user's) it asks for setup first; after, one
// line offers what's missing (AldoSetup.tsx), and the first few threads start
// from tappable starters (AldoStarters.tsx). An Aldo without the home read
// shows what Aldo's overview says instead; one without the assistant shows the
// board, which answers four questions in order: what needs me, what's
// happening, what got done, what's coming. In simple mode (simpleMode.ts) it
// shows the rail's place: Aldo's conversation, Needs you or the Library
// (AldoSimplePlaces.tsx).

import { useNavigate, useRouter } from "@tanstack/react-router";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  ChevronDownIcon,
  FolderGit2Icon,
  PlusIcon,
  SparklesIcon,
  SquarePenIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "../components/ui/button";
import { Group, GroupSeparator } from "../components/ui/group";
import { Kbd } from "../components/ui/kbd";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import { Skeleton } from "../components/ui/skeleton";
import { SidebarInset } from "../components/ui/sidebar";
import { cn } from "~/lib/utils";
import { useAldoAccounts } from "./AldoAccountsPanel";
import { AldoAtAGlance, useAldoAssistantAvailable } from "./AldoAssistant";
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
import { AldoSimpleTabs } from "./AldoSimpleRail";
import { AldoSimpleLibrary, AldoSimpleNeedsYou } from "./AldoSimplePlaces";
import { AldoStarters, STARTERS_UNTIL_THREADS } from "./AldoStarters";
import { seedAldoComposer, sendText, useAldoAssistant } from "./assistantSession";
import {
  aldoOffersItsModels,
  aldoSupportsGeneralThreads,
  aldoSupportsProjects,
  subscribeAldoEnvironments,
  type AldoHomeConversation,
} from "./cloud";
import { useAldoFirstViewHold } from "./firstView";
import { refreshAldoHome, useAldoHomeRead } from "./homeFeed";
import { AldoUnderTheHood } from "./AldoUnderTheHood";
import { HOST_KINDS, openAldoRepositoryPicker } from "./AldoRepositoryPicker";
import { useStartAldoThread } from "./newThread";
import { ICON_BUTTON } from "./surface";
import { AldoPlacePicker } from "./AldoPlacePicker";
import { forgetAldoRepositories } from "./places";
import { startAldoSandbox } from "./threads";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
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
import { morphIntoThread } from "./morph";
import { setAldoUnderTheHood, useAldoSimple, useAldoUnderTheHood } from "./simpleMode";
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
  const { accounts, error: accountsError, refresh: refreshAccounts } = useAldoAccounts();
  const assistant = useAldoAssistantAvailable();
  const { home, supported, error } = useAldoHomeRead();
  const refresh = refreshAldoHome;
  const mobile = useIsMobile();
  // Aldo's conversation needs Aldo; without it there's the board.
  const aldoView = assistant === true;
  // Simple mode's place, which shows in place of the conversation. It needs Aldo:
  // without it, the sidebar shows as usual (useAldoSimpleRail), and so does the board.
  const simplePlace = useAldoSimple((s) => (s.on && assistant === true ? s.place : null));
  // What runs under the conversation, opened from Aldo's status; it closes once
  // the home screen is left, or simple mode goes to another place.
  const underTheHood = useAldoUnderTheHood((s) => s.open) && assistant === true;
  useEffect(() => () => setAldoUnderTheHood(false), []);
  useEffect(() => {
    if (simplePlace !== null && simplePlace !== "aldo") setAldoUnderTheHood(false);
  }, [simplePlace]);
  const lastSeen = useLastSeen();
  const now = useNow();
  const navigate = useNavigate();

  // The day's first look at the home screen makes Aldo's brief;
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
  // The first view waits for what decides the setup card and the board
  // (firstView.ts, which waits for the directory itself).
  useAldoFirstViewHold(
    assistant === null ||
      (accounts === null && accountsError === null) ||
      (home === null && supported === null && error === null),
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

  const router = useRouter();
  /** Opens the selected conversation, its row growing into the thread. */
  const open = useCallback(
    (c: AldoHomeConversation) =>
      void navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId: c.thread.environmentId as EnvironmentId,
          threadId: c.thread.threadId as ThreadId,
        },
        viewTransition: morphIntoThread(
          router,
          boardRef.current?.querySelector<HTMLElement>("[data-selected]") ?? null,
        ),
      }),
    [navigate, router],
  );

  useEffect(() => {
    // The board's keys: Aldo's conversation has its own (AldoConversationPage), as do simple mode's places.
    if (aldoView || simplePlace !== null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || inField(event.target)) return;
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
  }, [aldoView, simplePlace, open, selectable, selected]);

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

  if (underTheHood)
    return (
      <AldoUnderTheHood
        home={home}
        error={error}
        repos={repos}
        now={now}
        lastSeen={lastSeen}
        tabs={simplePlace !== null && mobile ? <AldoSimpleTabs /> : null}
      />
    );

  if (simplePlace !== null) {
    // On a phone the places are tabs at the top; on a wider screen they're on the rail.
    const tabs = mobile ? <AldoSimpleTabs /> : null;
    if (simplePlace === "needs") {
      return (
        <AldoSimpleNeedsYou
          home={home}
          supported={supported}
          error={error}
          now={now}
          tabs={tabs}
          issues={issues}
          assistant={assistant === true}
        />
      );
    }
    if (simplePlace === "library") return <AldoSimpleLibrary tabs={tabs} />;
    return (
      <AldoConversationPage
        home={home}
        supported={supported}
        error={error}
        now={now}
        tabs={tabs}
        actions={null}
        setup={conversationSetup}
        welcome={welcome}
        issues={issues}
        chips={chips}
        onChip={onChip}
      />
    );
  }

  if (aldoView) {
    return (
      <AldoConversationPage
        home={home}
        supported={supported}
        error={error}
        now={now}
        tabs={null}
        actions={
          <NewMenu
            general={general}
            projects={projects || sourceReady}
            repositories={sourceReady}
            quiet
          />
        }
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
    assistant: false,
    onSelect: () => setSelectedRef(c.ref),
    onActed: () => void refresh(),
  });

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex h-full min-h-0 min-w-0 flex-col lg:flex-row">
        <div ref={boardRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pt-14 pb-8 sm:px-5 sm:pt-6">
            <header className="flex flex-wrap items-center gap-2">
              <h1 className="mr-auto font-semibold text-lg">Your threads</h1>
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
                    {/* Done threads leave the board after two days: it's caught up, not empty. */}
                    <p className="font-medium text-sm">
                      {shown.conversations.some((c) => c.state !== "new")
                        ? "All caught up"
                        : "Nothing yet"}
                    </p>
                    <p className="mt-1 text-muted-foreground text-xs">
                      What you start shows here: what needs you first, then what's working and
                      what's done. Start a thread with New: each gets an agent with its own
                      computer.
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
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </SidebarInset>
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
 * a git host is connected. `quiet`, it's one icon that opens where to start
 * it: Aldo's conversation, where the way to start something is to say it.
 */
function NewMenu(props: {
  readonly general: boolean;
  readonly projects: boolean;
  readonly repositories: boolean;
  readonly quiet?: boolean;
}) {
  // A General draft at once; an older Aldo can't start a thread outside a repository.
  const { start, starting } = useStartAldoThread();
  const handleNewThread = useNewThreadHandler();
  const thread = () => (props.general ? void start([]) : openAldoRepositoryPicker("existing"));
  // A new Aldo project, and a thread in it at once.
  const create = async (name: string) => {
    forgetAldoRepositories();
    const projectRef = await startAldoSandbox({
      create: { host: "aldo", name, isPrivate: true },
    }).catch(() => null);
    if (projectRef) await handleNewThread(projectRef);
  };
  if (props.quiet) {
    const trigger = (
      <button
        type="button"
        aria-label="New thread"
        // It opens a menu: open whenever there's somewhere to start, a project included.
        disabled={starting || (!props.general && !props.repositories && !props.projects)}
        className={cn(ICON_BUTTON, "size-9 text-foreground/70")}
      >
        <SquarePenIcon className="size-[18px]" strokeWidth={1.75} />
      </button>
    );
    return props.general ? (
      <AldoPlacePicker
        mode="start"
        current={null}
        align="end"
        trigger={trigger}
        onPick={(place) => void start(place.repos)}
        onCreate={props.projects ? (name) => void create(name) : null}
        onMore={() => openAldoRepositoryPicker(props.projects ? "new" : "existing")}
      />
    ) : (
      <Menu>
        <MenuTrigger render={trigger} />
        <MenuPopup align="end" className="min-w-52">
          {props.repositories ? (
            <MenuItem onClick={thread}>
              <FolderGit2Icon className="size-4" /> Thread in a repository
            </MenuItem>
          ) : null}
          <MenuItem disabled={!props.projects} onClick={() => openAldoRepositoryPicker("new")}>
            <SparklesIcon className="size-4" /> Project
          </MenuItem>
        </MenuPopup>
      </Menu>
    );
  }
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
      {props.general ? (
        // The same picker a thread has: General, a project, or a new one.
        <AldoPlacePicker
          mode="start"
          current={null}
          align="end"
          trigger={
            <Button aria-label="Start it in a project" size="icon-sm">
              <ChevronDownIcon aria-hidden className="size-4" />
            </Button>
          }
          onPick={(place) => void start(place.repos)}
          onCreate={props.projects ? (name) => void create(name) : null}
          onMore={() => openAldoRepositoryPicker(props.projects ? "new" : "existing")}
        />
      ) : (
        <Menu>
          <MenuTrigger render={<Button aria-label="More to start" size="icon-sm" />}>
            <ChevronDownIcon aria-hidden className="size-4" />
          </MenuTrigger>
          <MenuPopup align="end" className="min-w-52">
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
      )}
    </Group>
  );
}
