// Where an Aldo thread works, at the head of its header: a draft's place (its
// composer's chip moves it), and a sent thread's, which can move it. A sent
// thread's project never changes, so a move is a handoff: its agent writes a
// brief, a thread opens with it in the new place (continue_in_new_thread with
// `move`), and Aldo archives this conversation once that turn ends.

import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { ChevronDownIcon } from "lucide-react";
import { useCallback, useSyncExternalStore, type RefObject } from "react";

import { toastManager } from "../components/ui/toast";
import { AldoPlacePicker, type AldoPlaceChoice } from "./AldoPlacePicker";
import { AldoPlaceTile } from "./AldoPlaceTile";
import { aldoMovesThreads, aldoSupportsProjects, subscribeAldoEnvironments } from "./directory";
import { aldoMoveMessage } from "./places.logic";
import { useAldoPlaceOf } from "./places";

/** Whether this Aldo can move a sent thread (its directory says, once listed). */
export function useAldoMovesThreads(): boolean {
  return useSyncExternalStore(subscribeAldoEnvironments, aldoMovesThreads, () => false);
}

/** Asks the thread's agent to hand the conversation off to a place (or a new project). */
function useMoveThread(send: (text: string) => Promise<boolean>) {
  return useCallback(
    (target: AldoPlaceChoice | { readonly create: string }) => {
      const name = "create" in target ? target.create : target.name;
      void send(aldoMoveMessage(target)).then((sent) => {
        if (!sent) return;
        toastManager.add({
          type: "info",
          title: `Moving this thread to ${name}`,
          description:
            "Its agent writes a brief, and a new thread opens there with it. This one is archived once it's done.",
        });
      });
    },
    [send],
  );
}

export function AldoThreadPlace(props: {
  readonly environmentId: string;
  readonly project: EnvironmentProject | null;
  /** Sends the user's message to the thread's agent: a sent thread, which can move. */
  readonly onSendMessage?: ((text: string) => Promise<boolean>) | undefined;
}) {
  const place = useAldoPlaceOf(props.environmentId, props.project);
  const moves = useAldoMovesThreads();
  const send = props.onSendMessage;
  const move = useMoveThread(send ?? noSend);
  if (!place) return null;
  const mark = (
    <>
      <AldoPlaceTile place={place} className="size-3.5" />
      {/* A phone keeps the thread title readable: the place shows as its tile. */}
      <span className="max-w-40 truncate font-medium text-sm max-sm:sr-only">{place.name}</span>
    </>
  );
  if (!send || !moves) {
    return (
      <span
        data-aldo-thread-place=""
        className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground"
      >
        {mark}
      </span>
    );
  }
  return (
    <AldoPlacePicker
      mode="move"
      current={place.repos}
      onPick={move}
      onCreate={aldoSupportsProjects() ? (name) => move({ create: name }) : null}
      trigger={
        <button
          type="button"
          data-aldo-thread-place=""
          aria-label={`${place.name}: move this thread to another project`}
          className="-mx-1 inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md border border-transparent px-1 py-0.5 text-muted-foreground outline-none hover:border-border hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:border-border data-popup-open:bg-accent"
        >
          {mark}
          <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 opacity-70" />
        </button>
      }
    />
  );
}

/** The move picker on its own, for a thread whose header keeps its project menu (one in a repository). */
export function AldoMoveThreadPicker(props: {
  readonly environmentId: string;
  readonly project: EnvironmentProject | null;
  readonly onSendMessage: (text: string) => Promise<boolean>;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly anchor: RefObject<Element | null>;
}) {
  const place = useAldoPlaceOf(props.environmentId, props.project);
  const move = useMoveThread(props.onSendMessage);
  if (!place) return null;
  return (
    <AldoPlacePicker
      mode="move"
      current={place.repos}
      open={props.open}
      onOpenChange={props.onOpenChange}
      anchor={props.anchor}
      onPick={move}
      onCreate={aldoSupportsProjects() ? (name) => move({ create: name }) : null}
    />
  );
}

async function noSend(): Promise<boolean> {
  return false;
}
