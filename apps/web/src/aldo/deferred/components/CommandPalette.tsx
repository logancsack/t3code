// The palette's shell as components/CommandPalette.tsx has it, so the app under it keeps its
// place in the tree; the dialog's body loads when the palette first opens. CommandDialog there
// is this Dialog.Root, taken from the library so the palette's inputs stay with its body.

import { Dialog } from "@base-ui/react/dialog";
import { useRef, useState, type ReactNode } from "react";

import type { ChatComposerHandle } from "../../../components/chat/ChatComposer";
import { ThreadContextDragGhost } from "../../../components/chat/ThreadContextDragGhost";
import type { CommandPaletteReturnContext } from "../../../components/CommandPalette.logic";
import {
  dispatchCommandPalette,
  useCommandPaletteMount,
  useCommandPaletteStore,
} from "../../../commandPaletteStore";
import { ComposerHandleContext } from "../../../composerHandleContext";
import { deferred } from "../../deferred";

const CommandPaletteDialog = deferred(
  () => import("../../../components/CommandPalette").then((m) => m.CommandPaletteDialog),
  { warm: true },
);

export function CommandPalette({ children }: { children: ReactNode }) {
  useCommandPaletteMount();
  const state = useCommandPaletteStore();
  const [opened, setOpened] = useState(state.open);
  if (state.open && !opened) setOpened(true);
  const setOpen = (open: boolean) => dispatchCommandPalette({ _tag: "SetOpen", open });
  const openChildSearch = (mode: "files" | "content", context: CommandPaletteReturnContext) =>
    dispatchCommandPalette({ _tag: "OpenChildSearch", mode, context });
  const composerHandleRef = useRef<ChatComposerHandle | null>(null);

  return (
    <ComposerHandleContext value={composerHandleRef}>
      <ThreadContextDragGhost />
      <Dialog.Root
        open={state.open}
        onOpenChange={(open, eventDetails) => {
          if (!open && eventDetails.reason === "escape-key" && state.mode !== "command") {
            eventDetails.cancel();
            dispatchCommandPalette({ _tag: "BackToCommand" });
            return;
          }
          setOpen(open);
        }}
      >
        <div className="contents" inert={state.open}>
          {children}
        </div>
        {opened ? (
          <CommandPaletteDialog
            mode={state.mode}
            session={state.session}
            openIntent={state.openIntent}
            setOpen={setOpen}
            openChildSearch={openChildSearch}
            initialContext={state.restoredSearch}
          />
        ) : null}
      </Dialog.Root>
    </ComposerHandleContext>
  );
}
