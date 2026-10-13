// The start dialog's host, mounted once at the root: a new project, a thread in
// existing repositories, or one in none. The dialog itself
// (AldoRepositoryDialog.tsx) loads when it's first opened, not with the app.

import { lazy, Suspense, useEffect, useState } from "react";

import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { isAldoCloud, type AldoHostKind } from "./cloud";
import { dropAldoCarriedDraft } from "./newThread";

const OPEN_EVENT = "aldo:open-repository-picker";

/** A new project, existing repositories, or none (General: work that isn't code). */
export type AldoStartMode = "new" | "existing" | "general";

/** The git hosts (Aldo's own projects need no account). */
export const HOST_KINDS: ReadonlyArray<AldoHostKind> = ["github", "gitlab", "bitbucket", "azure"];

const AldoStartDialog = lazy(() =>
  import("./AldoRepositoryDialog").then((module) => ({ default: module.AldoStartDialog })),
);

/** Opens the start dialog: a new project, a thread in existing repositories, or one in none. */
export function openAldoRepositoryPicker(mode: AldoStartMode = "existing"): void {
  window.dispatchEvent(new CustomEvent<AldoStartMode>(OPEN_EVENT, { detail: mode }));
}

export function AldoRepositoryPicker() {
  const [open, setOpen] = useState<AldoStartMode | null>(null);
  useEffect(() => {
    if (!isAldoCloud) return;
    const handleOpen = (event: Event) =>
      setOpen((event as CustomEvent<AldoStartMode>).detail ?? "existing");
    window.addEventListener(OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_EVENT, handleOpen);
  }, []);
  if (!isAldoCloud) return null;
  return (
    <Dialog
      open={open !== null}
      onOpenChange={(next) => {
        if (next) return;
        // Dismissed: a draft's words it was to take along stay where they are.
        dropAldoCarriedDraft();
        setOpen(null);
      }}
    >
      {open ? (
        <Suspense fallback={<AldoStartDialogOpening mode={open} />}>
          <AldoStartDialog initialMode={open} onClose={() => setOpen(null)} />
        </Suspense>
      ) : null}
    </Dialog>
  );
}

/** The dialog's frame while its code loads (a slow link), so the click shows and can be undone. */
function AldoStartDialogOpening(props: { readonly mode: AldoStartMode }) {
  return (
    <DialogPopup className="w-[min(680px,calc(100vw-2rem))]">
      <DialogHeader>
        <DialogTitle>{props.mode === "new" ? "New project" : "Start a thread"}</DialogTitle>
        <DialogDescription>Opening…</DialogDescription>
      </DialogHeader>
    </DialogPopup>
  );
}
