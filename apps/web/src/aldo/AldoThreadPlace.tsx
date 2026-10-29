// The thread menu’s move picker. A move is a handoff: its agent writes a brief,
// opens a thread in the new place and archives this conversation once done.

import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { useCallback, useSyncExternalStore, type RefObject } from "react";

import { toastManager } from "../components/ui/toast";
import { AldoPlacePicker, type AldoPlaceChoice } from "./AldoPlacePicker";
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

/** The thread menu’s move action, for repository and General threads alike. */
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
