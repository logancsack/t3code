// One picker for where a thread works, wherever it's asked: a draft's chip
// and where-card, a sent thread's header (a move, which its agent hands off),
// and Home's New. General is pinned on top, the user's projects follow, most
// recently active first, and what's typed finds their other repositories,
// takes a pasted repository URL, or names a new Aldo project. A popover on a
// computer, a sheet on a phone.

import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import type { SourceControlRepositorySummary } from "@t3tools/contracts";
import {
  CheckIcon,
  FolderGit2Icon,
  LoaderCircleIcon,
  PlusIcon,
  SearchIcon,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";

import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { SheetPopup } from "../components/ui/sheet";
import { useIsMobile } from "../hooks/useMediaQuery";
import { cn } from "../lib/utils";
import { formatRelativeTime } from "../timestampFormat";
import { AldoPlaceTile, type AldoPickedPlace } from "./AldoPlaceTile";
import { aldoSupportsProjects } from "./cloud";
import {
  aldoProjectSlug,
  filterAldoPlaces,
  generalMatches,
  generalPlace,
  namesAPlace,
  placeDetail,
  placeKey,
  repoShortName,
  typedRepositoryRef,
} from "./places.logic";
import { useAldoPlaces } from "./places";

/** A draft moves in place; a sent thread's agent hands it off; Home starts a thread there. */
export type AldoPlacePickerMode = "draft" | "move" | "start";

export interface AldoPlaceChoice {
  readonly repos: ReadonlyArray<string>;
  readonly name: string;
}

const TITLES: Record<AldoPlacePickerMode, string> = {
  draft: "Where this thread works",
  move: "Move this thread to",
  start: "Start a thread in",
};

/** Repositories found by a search, beyond the user's projects. */
const MOST_REPOSITORIES = 5;

export function AldoPlacePicker(props: {
  readonly mode: AldoPlacePickerMode;
  /** Where the thread is now (none: General); null when there's no thread yet. */
  readonly current: ReadonlyArray<string> | null;
  /** What opens it; left out, it opens with `open` by `anchor`. */
  readonly trigger?: ReactElement | undefined;
  readonly anchor?: RefObject<Element | null> | undefined;
  readonly open?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly onPick: (place: AldoPlaceChoice) => void;
  /** A new Aldo project by this name; null where Aldo has none. */
  readonly onCreate: ((name: string) => void) | null;
  /** The start dialog, for a new repository or several at once. */
  readonly onMore?: (() => void) | undefined;
  readonly align?: "start" | "center" | "end" | undefined;
  readonly side?: "top" | "bottom" | undefined;
}) {
  const isMobile = useIsMobile();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = props.open ?? ownOpen;
  const setOpen = (next: boolean) => {
    setOwnOpen(next);
    props.onOpenChange?.(next);
  };
  const closeThen =
    <T,>(act: (value: T) => void) =>
    (value: T) => {
      setOpen(false);
      act(value);
    };
  const list = open ? (
    <AldoPlaceList
      mode={props.mode}
      current={props.current}
      showTitle={isMobile || props.mode === "move"}
      autoFocus={!isMobile}
      onPick={closeThen(props.onPick)}
      onCreate={props.onCreate ? closeThen(props.onCreate) : null}
      onMore={props.onMore ? closeThen<void>(props.onMore) : undefined}
    />
  ) : null;
  if (isMobile) {
    return (
      <SheetPrimitive.Root open={open} onOpenChange={(next) => setOpen(next)}>
        {props.trigger ? <SheetPrimitive.Trigger render={props.trigger} /> : null}
        <SheetPopup
          side="bottom"
          showCloseButton={false}
          className="max-h-[85dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
        >
          <div
            aria-hidden
            className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/30"
          />
          {list}
        </SheetPopup>
      </SheetPrimitive.Root>
    );
  }
  return (
    <Popover open={open} onOpenChange={(next) => setOpen(next)}>
      {props.trigger ? <PopoverTrigger render={props.trigger} /> : null}
      <PopoverPopup
        padding="none"
        align={props.align ?? "start"}
        side={props.side ?? "bottom"}
        anchor={props.anchor}
        className="w-96 max-w-[calc(100vw-2rem)]"
      >
        {list}
      </PopoverPopup>
    </Popover>
  );
}

interface Row {
  readonly key: string;
  readonly tile: ReactNode;
  readonly name: ReactNode;
  readonly detail: string;
  readonly trailing?: ReactNode;
  /** What choosing it does; none: it points at the search field. */
  readonly act?: () => void;
}

function folded(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function IconTile(props: { readonly icon: LucideIcon }) {
  const Icon = props.icon;
  return (
    <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
      <Icon aria-hidden className="size-4" />
    </span>
  );
}

function AldoPlaceList(props: {
  readonly mode: AldoPlacePickerMode;
  readonly current: ReadonlyArray<string> | null;
  readonly showTitle: boolean;
  readonly autoFocus: boolean;
  readonly onPick: (place: AldoPlaceChoice) => void;
  readonly onCreate: ((name: string) => void) | null;
  readonly onMore: (() => void) | undefined;
}) {
  const { mode, onPick, onCreate } = props;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { places, repositories } = useAldoPlaces(true);
  const currentKey = props.current === null ? null : placeKey(props.current);
  const q = query.trim();

  const sections = useMemo(() => {
    // A move goes somewhere else; a draft shows where it is.
    const elsewhere = (repos: ReadonlyArray<string>) =>
      mode !== "move" || placeKey(repos) !== currentKey;
    const checked = (repos: ReadonlyArray<string>) =>
      mode === "draft" && placeKey(repos) === currentKey ? (
        <CheckIcon aria-label="Here now" className="size-4 shrink-0 text-foreground" />
      ) : null;
    const placeKeys = new Set(places.map((place) => placeKey(place.repos)));
    const listed = (ref: string) => placeKeys.has(ref);
    const general: Row[] =
      generalMatches(q) && elsewhere([])
        ? [
            {
              key: "general",
              tile: <AldoPlaceTile place={generalPlace()} className="size-5" />,
              name: "General",
              detail: placeDetail([]),
              trailing: checked([]),
              act: () => onPick({ repos: [], name: "General" }),
            },
          ]
        : [];
    const projects: Row[] = filterAldoPlaces(places, q)
      .filter((place) => elsewhere(place.repos))
      .map((place: AldoPickedPlace) => ({
        key: placeKey(place.repos),
        tile: <AldoPlaceTile place={place} className="size-5" />,
        name: place.name,
        detail: place.detail,
        trailing: checked(place.repos) ?? (
          <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
            {place.activeAt ? (formatRelativeTime(place.activeAt)?.value ?? "") : ""}
          </span>
        ),
        act: () => onPick({ repos: place.repos, name: place.name }),
      }));
    const typed = typedRepositoryRef(q);
    const found: ReadonlyArray<SourceControlRepositorySummary> = q
      ? (repositories ?? [])
          .filter(
            (repo) =>
              !repo.nameWithOwner.startsWith("aldo:") &&
              !listed(repo.nameWithOwner) &&
              folded(`${repo.nameWithOwner} ${repo.description ?? ""}`).includes(folded(q)),
          )
          .slice(0, MOST_REPOSITORIES)
      : [];
    const repositoryRows: Row[] = found.map((repo) => ({
      key: `repo:${repo.nameWithOwner}`,
      tile: <IconTile icon={FolderGit2Icon} />,
      name: repo.nameWithOwner,
      detail: repo.description?.trim() || "Repository",
      act: () => onPick({ repos: [repo.nameWithOwner], name: repo.nameWithOwner }),
    }));
    if (
      typed &&
      !listed(typed) &&
      !(repositories ?? []).some((repo) => repo.nameWithOwner === typed)
    ) {
      repositoryRows.push({
        key: `typed:${typed}`,
        tile: <IconTile icon={FolderGit2Icon} />,
        name: typed,
        detail: "Repository · as typed",
        act: () => onPick({ repos: [typed], name: repoShortName(typed) }),
      });
    }
    const creating: Row[] = [];
    if (onCreate && !typed) {
      if (q && !namesAPlace(places, q)) {
        creating.push({
          key: "create",
          tile: (
            <AldoPlaceTile
              place={{ repos: [`aldo:${aldoProjectSlug(q)}`], name: q, project: null }}
              className="size-5"
            />
          ),
          name: (
            <>
              New project <span className="text-foreground">“{q}”</span>
            </>
          ),
          detail: `An Aldo project, aldo:${aldoProjectSlug(q)}`,
          act: () => onCreate(q),
        });
      } else if (!q) {
        creating.push({
          key: "create",
          tile: <IconTile icon={PlusIcon} />,
          name: "New project",
          detail: "Type a name, or paste a repository URL",
        });
      }
    }
    return { general, projects, repositoryRows, creating };
  }, [currentKey, mode, onCreate, onPick, places, q, repositories]);

  const rows = [
    ...sections.general,
    ...sections.projects,
    ...sections.repositoryRows,
    ...sections.creating,
  ];
  const activeIndex = Math.min(active, Math.max(rows.length - 1, 0));
  useEffect(() => {
    if (props.autoFocus) inputRef.current?.focus();
  }, [props.autoFocus]);
  const loading = repositories === null && aldoSupportsProjects();

  const rowIndex = new Map(rows.map((row, at) => [row.key, at]));
  const renderRow = (row: Row) => {
    const at = rowIndex.get(row.key) ?? -1;
    return (
      <button
        key={row.key}
        type="button"
        role="option"
        aria-selected={at === activeIndex}
        data-active={at === activeIndex ? "" : undefined}
        onMouseMove={() => setActive(at)}
        onClick={row.act ?? (() => inputRef.current?.focus())}
        className="flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-left outline-none data-active:bg-accent"
      >
        {row.tile}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-foreground text-sm">{row.name}</span>
          <span className="truncate text-muted-foreground text-xs">{row.detail}</span>
        </span>
        {row.trailing ?? null}
      </button>
    );
  };
  const label = (text: string) => (
    <div className="px-2 pt-2 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
      {text}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-col">
      {props.showTitle ? (
        <div className="shrink-0 px-3 pt-3 pb-2 font-semibold text-sm">{TITLES[mode]}</div>
      ) : null}
      <label className="flex shrink-0 items-center gap-2 border-border/60 border-b px-3">
        <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setActive((rows.length + activeIndex + step) % Math.max(rows.length, 1));
            } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              rows[activeIndex]?.act?.();
            }
          }}
          aria-label="Find or create a project"
          placeholder={onCreate ? "Find or create a project" : "Find a project"}
          className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </label>
      <div
        role="listbox"
        aria-label={TITLES[mode]}
        className="min-h-0 flex-1 overflow-y-auto p-1.5"
      >
        {sections.general.map(renderRow)}
        {sections.projects.length > 0 ? label("Projects") : null}
        {sections.projects.map(renderRow)}
        {sections.repositoryRows.length > 0 ? label("Repositories") : null}
        {sections.repositoryRows.map(renderRow)}
        {loading ? (
          <div className="flex items-center gap-2 px-2 py-1.5 text-muted-foreground text-xs">
            <LoaderCircleIcon aria-hidden className="size-3.5 animate-spin" /> Your projects…
          </div>
        ) : null}
        {sections.creating.length > 0 ? (
          <div
            className={cn(
              rows.length > sections.creating.length && "mt-1 border-border/60 border-t pt-1",
            )}
          >
            {sections.creating.map(renderRow)}
          </div>
        ) : null}
        {rows.length === 0 && !loading ? (
          <div className="px-2 py-3 text-muted-foreground text-sm">Nothing called that.</div>
        ) : null}
      </div>
      {mode === "move" ? (
        <p className="shrink-0 border-border/60 border-t px-3 py-2.5 text-muted-foreground text-xs leading-relaxed">
          <span className="font-medium text-foreground">A new thread opens there</span> with a brief
          from this one's agent and its files. This one is archived, linked to it.
        </p>
      ) : props.onMore ? (
        <button
          type="button"
          onClick={props.onMore}
          className="shrink-0 cursor-pointer border-border/60 border-t px-3 py-2.5 text-left text-muted-foreground text-xs hover:text-foreground"
        >
          More ways to start: a new repository, or several at once…
        </button>
      ) : null}
    </div>
  );
}
