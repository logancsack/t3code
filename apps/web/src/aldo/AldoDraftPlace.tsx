// Where a new thread works, shown rather than asked: before its first message
// the draft's timeline starts with a card for its place (General's empty
// dashed tile, or its project's), the composer carries a chip for it next to
// the agent's, and a General draft whose words belong to one of the user's
// projects gets that project suggested. Each moves the draft in place, with
// what's typed (moveDraft.ts); none moves it on its own.

import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { ChevronDownIcon, LoaderCircleIcon, PlusIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ComposerControl } from "../components/chat/ComposerControl";
import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { cn } from "../lib/utils";
import { useThreadShells } from "../state/entities";
import { formatRelativeTime } from "../timestampFormat";
import { AldoPlacePicker, type AldoPlaceChoice } from "./AldoPlacePicker";
import { AldoPlaceTile, type AldoPickedPlace } from "./AldoPlaceTile";
import { openAldoRepositoryPicker } from "./AldoRepositoryPicker";
import { aldoRoutesDrafts, aldoSupportsProjects } from "./directory";
import { routeAldoDraft, type AldoRoutedProject } from "./workspaceApi";
import { useMoveAldoDraft } from "./moveDraft";
import { carryAldoDraft } from "./newThread";
import { placeKey, repoShortName } from "./places.logic";
import { forgetAldoRepositories, useAldoMachines, useAldoPlaceOf, useAldoPlaces } from "./places";

/** Places offered on a General draft's card, beside New project. */
const CARD_PLACES = 3;
/** Threads of the place listed on its card. */
const RECENT_THREADS = 3;

/** What a draft's place offers: where it is, and moving it (to a place, or a new project). */
function useDraftPlace(
  draftId: DraftId,
  environmentId: string,
  project: EnvironmentProject | null,
) {
  const place = useAldoPlaceOf(environmentId, project);
  const { move, moving } = useMoveAldoDraft(draftId);
  const pick = (choice: AldoPlaceChoice) => void move({ repos: choice.repos });
  const create = aldoSupportsProjects()
    ? (name: string) => {
        forgetAldoRepositories();
        void move({ create: { host: "aldo", name, isPrivate: true } });
      }
    : null;
  // A new repository, or several, through the start dialog, with what's typed.
  const more = () => {
    carryAldoDraft(
      draftId,
      useComposerDraftStore.getState().getComposerDraft(draftId)?.prompt ?? "",
    );
    openAldoRepositoryPicker(aldoSupportsProjects() ? "new" : "existing");
  };
  return { place, moving, pick, create, more };
}

function placeSubline(place: AldoPickedPlace): string {
  if (place.repos.length === 0) return "Not part of a project";
  if (place.repos.length === 1 && place.repos[0]!.startsWith("aldo:")) {
    return "Project · its threads share files, instructions and setup";
  }
  return place.repos.length === 1
    ? `Repository · ${place.repos[0]}`
    : `Repositories · ${place.repos.map(repoShortName).join(", ")}`;
}

const ATTENTION_LABEL = {
  working: "Working",
  waiting: "Waiting on you",
  done: "Done",
  failed: "Failed",
} as const;

/** The draft's place, at the head of its empty timeline. */
export function AldoDraftWhereCard(props: {
  readonly draftId: DraftId;
  readonly environmentId: string;
  readonly project: EnvironmentProject | null;
}) {
  const { place, moving, pick, create, more } = useDraftPlace(
    props.draftId,
    props.environmentId,
    props.project,
  );
  const { places } = useAldoPlaces(false);
  const machines = useAldoMachines();
  const threads = useThreadShells();
  const key = place ? placeKey(place.repos) : null;
  const recent = useMemo(() => {
    if (key === null) return [];
    const here = new Set(
      machines
        .filter((machine) => placeKey((machine.repos ?? [machine.repo]).filter(Boolean)) === key)
        .map((machine) => machine.environmentId),
    );
    return threads
      .filter((thread) => thread.archivedAt === null && here.has(thread.environmentId))
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, RECENT_THREADS)
      .map((thread) => ({
        thread,
        attention: machines.find((machine) => machine.environmentId === thread.environmentId)
          ?.attention?.[thread.id]?.state,
      }));
  }, [key, machines, threads]);
  if (!place) return null;
  const general = place.repos.length === 0;
  const elsewhere = places.slice(0, CARD_PLACES);
  return (
    <div
      data-aldo-draft-place=""
      className={cn(
        "pointer-events-auto mx-auto w-full max-w-(--chat-max-width) px-1 transition-opacity",
        moving && "opacity-60",
      )}
    >
      <div className="flex items-center gap-4">
        <AldoPlaceTile place={place} className={cn("size-13", general && "border-2")} />
        <div className="min-w-0">
          <div className="flex items-center gap-2 truncate font-semibold text-2xl text-foreground tracking-tight">
            {place.name}
            {moving ? (
              <LoaderCircleIcon
                aria-label="Moving"
                className="size-4 animate-spin text-muted-foreground"
              />
            ) : null}
          </div>
          <div className="text-muted-foreground text-sm sm:truncate">{placeSubline(place)}</div>
        </div>
      </div>
      {general ? (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-sm">Start it in</span>
          {elsewhere.map((candidate) => (
            <button
              key={placeKey(candidate.repos)}
              type="button"
              disabled={moving}
              onClick={() => pick(candidate)}
              className="inline-flex h-8 max-w-56 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card/40 px-2.5 font-medium text-sm hover:bg-accent disabled:pointer-events-none"
            >
              <AldoPlaceTile place={candidate} className="size-4" />
              <span className="truncate">{candidate.name}</span>
            </button>
          ))}
          <AldoPlacePicker
            mode="draft"
            current={place.repos}
            onPick={pick}
            onCreate={create}
            onMore={more}
            trigger={
              <button
                type="button"
                disabled={moving}
                className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border border-dashed px-2.5 text-muted-foreground text-sm hover:bg-accent hover:text-foreground disabled:pointer-events-none"
              >
                <PlusIcon aria-hidden className="size-3.5" />
                {elsewhere.length > 0 ? "Another, or a new project" : "A project"}
              </button>
            }
          />
        </div>
      ) : null}
      {recent.length > 0 ? (
        <div className="mt-6 border-border/60 border-t pt-4">
          <div className="mb-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
            Recent here
          </div>
          <ul className="flex flex-col">
            {recent.map(({ thread, attention }) => (
              <li key={`${thread.environmentId}:${thread.id}`}>
                <Link
                  to="/$environmentId/$threadId"
                  params={{
                    environmentId: thread.environmentId as EnvironmentId,
                    threadId: thread.id as ThreadId,
                  }}
                  className="-mx-2 flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <span className="min-w-0 flex-1 truncate text-foreground/90">{thread.title}</span>
                  <span
                    className={cn(
                      "shrink-0 text-muted-foreground text-xs",
                      attention === "done" && "text-emerald-500",
                      attention === "failed" && "text-destructive",
                    )}
                  >
                    {attention && attention !== "working"
                      ? ATTENTION_LABEL[attention]
                      : (formatRelativeTime(thread.updatedAt)?.value ?? "")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** The draft's place on its composer, before the agent's: the picker, where it's typed. */
export function AldoComposerPlaceChip(props: {
  readonly draftId: DraftId;
  readonly environmentId: string;
  readonly project: EnvironmentProject | null;
  readonly size?: "sm" | "xs";
}) {
  const { place, moving, pick, create, more } = useDraftPlace(
    props.draftId,
    props.environmentId,
    props.project,
  );
  const size = props.size ?? "sm";
  if (!place) return null;
  return (
    <AldoPlacePicker
      mode="draft"
      current={place.repos}
      onPick={pick}
      onCreate={create}
      onMore={more}
      side="top"
      trigger={
        <ComposerControl
          size={size}
          aria-label={`Where this thread works: ${place.name}`}
          data-aldo-place-chip=""
          data-composer-leading-control=""
          disabled={moving}
          // The strip clips what sticks out of it, so only the footer's chip sits on its edge.
          className={cn("max-w-44 border-border/70", size === "sm" && "-ms-1")}
        >
          {moving ? (
            <LoaderCircleIcon aria-hidden className="size-3.5 animate-spin" />
          ) : (
            <AldoPlaceTile place={place} className="size-3.5" />
          )}
          {/* A phone's composer shows the tile alone: the draft's card and the header name it. */}
          <span className="truncate @max-[480px]/composer-surface:hidden">{place.name}</span>
          <ChevronDownIcon
            aria-hidden
            data-composer-control-chevron
            className="size-3.5 opacity-70"
          />
        </ComposerControl>
      }
    />
  );
}

/** How long typing pauses before a General draft's words are matched to a project. */
const SUGGEST_AFTER_MS = 700;
/** Fewer characters than this say too little to match. */
const SUGGEST_MIN_CHARS = 12;

/**
 * A General draft whose words belong to one of the user's projects (Aldo's
 * own routing, POST /api/routing) gets that project suggested above its
 * composer, with why; it moves only when the user says so.
 */
export function AldoPlaceSuggestion(props: {
  readonly draftId: DraftId;
  readonly environmentId: string;
  readonly project: EnvironmentProject | null;
}) {
  const prompt = useComposerDraftStore(
    (store) => store.getComposerDraft(props.draftId)?.prompt ?? "",
  );
  const { place, moving, pick } = useDraftPlace(props.draftId, props.environmentId, props.project);
  const { places } = useAldoPlaces(false);
  const [routed, setRouted] = useState<{ text: string; project: AldoRoutedProject | null } | null>(
    null,
  );
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const general = place !== null && place.repos.length === 0;
  const text = prompt.trim();
  const asks = general && aldoRoutesDrafts() && text.length >= SUGGEST_MIN_CHARS;
  useEffect(() => {
    if (!asks || routed?.text === text) return;
    let live = true;
    const timer = window.setTimeout(() => {
      void routeAldoDraft(text)
        .catch(() => null)
        .then((project) => {
          if (live) setRouted({ text, project });
        });
    }, SUGGEST_AFTER_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [asks, routed?.text, text]);
  // Kept while the user types on, so it doesn't flicker, but not once they've changed what it read.
  const current = asks && routed !== null && text.startsWith(routed.text);
  const suggested = current ? routed.project : null;
  if (!suggested || suggested.repos.length === 0 || dismissed.has(placeKey(suggested.repos))) {
    return null;
  }
  const known = places.find((candidate) => placeKey(candidate.repos) === placeKey(suggested.repos));
  const target = known ?? { repos: suggested.repos, name: suggested.name, project: null };
  const why = suggested.named
    ? "you named it"
    : suggested.words.length > 0
      ? `its threads talk about ${suggested.words.map((word) => `“${word}”`).join(", ")}`
      : "it matches its threads";
  return (
    <div
      data-aldo-place-suggestion=""
      className="mb-2 flex items-center gap-2.5 rounded-xl border border-border bg-card/70 px-3 py-2 text-sm shadow-xs backdrop-blur"
    >
      <AldoPlaceTile place={target} className="size-5" />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        Looks like <span className="font-medium text-foreground">{suggested.name}</span> work: {why}
        .
      </span>
      <button
        type="button"
        disabled={moving}
        onClick={() => pick({ repos: suggested.repos, name: suggested.name })}
        className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-foreground px-2.5 font-medium text-background text-xs hover:bg-foreground/90 disabled:opacity-60"
      >
        {moving ? <LoaderCircleIcon aria-hidden className="size-3.5 animate-spin" /> : null}
        Move it there
      </button>
      <button
        type="button"
        aria-label="Keep it in General"
        onClick={() => setDismissed((current) => new Set([...current, placeKey(suggested.repos)]))}
        className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <XIcon aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}

/** "Today, 7:41 PM", or "Oct 12, 7:41 PM" (with the year when it isn't this one). */
function startedLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const now = new Date();
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (at.toDateString() === now.toDateString()) return `Today, ${time}`;
  const day = at.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${day}, ${time}`;
}

/** A sent thread's first line, where its where-card was: where it works and when it started. */
export function AldoThreadFirstLine(props: {
  readonly environmentId: string;
  readonly project: EnvironmentProject | null;
  readonly startedAt: string;
}) {
  const place = useAldoPlaceOf(props.environmentId, props.project);
  if (!place) return null;
  return (
    <div data-aldo-thread-first-line="" className="mx-auto w-full max-w-(--chat-max-width) pb-4">
      <div className="flex min-w-0 items-center gap-2 border-border/60 border-b pb-2.5 text-muted-foreground text-xs">
        <AldoPlaceTile place={place} className="size-3.5" />
        <span className="truncate font-medium text-foreground/80">{place.name}</span>
        <span aria-hidden>·</span>
        <time dateTime={props.startedAt} className="shrink-0">
          {startedLabel(props.startedAt)}
        </time>
      </div>
    </div>
  );
}
