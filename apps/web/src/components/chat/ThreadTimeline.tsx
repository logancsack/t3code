import type { ScopedThreadRef } from "@t3tools/contracts";
import { isAldoCloud } from "../../aldo/api";
import { useAldoThreadApprovals } from "../../aldo/AldoApprovals";
import { useAldoStallSignals } from "../../aldo/AldoStall";
import { withThreadApprovals } from "../../aldo/approvals.logic";
import { type ComponentProps, useLayoutEffect } from "react";
import { useIncrementalTimelineEntries } from "../../hooks/useIncrementalTimelineEntries";
import type { TimelineEntriesInput, TimelineEntry } from "../../session-logic";
import type { ChatMessage } from "../../types";
import { useTimelineVisibleTurnItems } from "../../state/entities";
import {
  peekRememberedThreadTimeline,
  rememberReadyThreadTimeline,
  resolveThreadSwitchTimeline,
  timelineHasEphemeralPreviewUrls,
} from "../ChatView.logic";
import { MessagesTimeline } from "./MessagesTimeline";

const NO_ENTRIES: ReadonlyArray<TimelineEntry> = [];
const NO_MESSAGES: ReadonlyArray<ChatMessage> = [];
const noop = () => undefined;

/**
 * The timeline with the streamed text. ChatView reads the thread through its quiet
 * atoms, which hold through text deltas; this reads the live turn items, so a
 * reasoning delta re-renders the timeline without re-rendering ChatView. Streamed
 * assistant text reaches only its own row, through useAssistantMessageText.
 */
export function ThreadTimeline({
  threadDetailRef,
  entriesInput,
  draftEntries,
  activeThreadKey,
  syncing,
  detailLoading,
  aldoStall,
  ...timelineProps
}: Omit<ComponentProps<typeof MessagesTimeline>, "timelineEntries"> & {
  /** Null until the thread's detail may load; see resolveThreadDetailRef. */
  threadDetailRef: ScopedThreadRef | null;
  entriesInput: Omit<TimelineEntriesInput, "visibleTurnItems">;
  /** A local draft's optimistic rows; null for a server thread. */
  draftEntries: ReadonlyArray<TimelineEntry> | null;
  activeThreadKey: string | null;
  syncing: boolean;
  detailLoading: boolean;
  /** Aldo: how the working line nudges and stops a turn that has stopped moving; null outside Aldo. */
  aldoStall: { send: (text: string) => Promise<boolean>; stop: () => unknown } | null;
}) {
  const visibleTurnItems = useTimelineVisibleTurnItems(threadDetailRef);
  const serverEntries = useIncrementalTimelineEntries(activeThreadKey, {
    ...entriesInput,
    visibleTurnItems,
  });
  const entries = draftEntries ?? serverEntries;
  const displayedEntries = resolveThreadSwitchTimeline({
    loading: entries.length === 0 && syncing,
    activeThreadKey,
    nextEntries: entries,
    rememberedForActive: peekRememberedThreadTimeline<typeof entries>(activeThreadKey),
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- stores the committed ready timeline in the module-level cache used during thread switches
  useLayoutEffect(() => {
    if (detailLoading || entries.length === 0 || timelineHasEphemeralPreviewUrls(entries)) {
      return;
    }
    rememberReadyThreadTimeline({ threadKey: activeThreadKey, entries });
  }, [activeThreadKey, detailLoading, entries]);
  // Aldo: the approvals this thread's agent asked, in its timeline where it asked.
  const aldoApprovals = useAldoThreadApprovals(
    threadDetailRef?.environmentId ?? null,
    threadDetailRef?.threadId ?? null,
    isAldoCloud,
  );
  const stallTarget = aldoStall && !draftEntries ? threadDetailRef : null;
  useAldoStallSignals({
    threadKey: stallTarget ? timelineProps.routeThreadKey : null,
    activities: stallTarget ? entries : NO_ENTRIES,
    messages: stallTarget
      ? entries.flatMap((entry) => (entry.kind === "message" ? [entry.message] : []))
      : NO_MESSAGES,
    // Words streaming in reach only their own row, so a streaming answer counts as moving.
    waitingOnYou:
      timelineProps.awaitingUser != null ||
      entries.some((entry) => entry.kind === "message" && entry.message.streaming),
    target: stallTarget,
    send: aldoStall?.send ?? null,
    stop: aldoStall?.stop ?? noop,
  });
  return (
    <MessagesTimeline
      {...timelineProps}
      syncing={syncing}
      timelineEntries={withThreadApprovals(displayedEntries, aldoApprovals)}
    />
  );
}
