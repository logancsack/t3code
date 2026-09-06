import { useState } from "react";
import { PlugIcon } from "lucide-react";

import { isManagedDevPc } from "../managedDevPc";
import { isLandingDemo } from "../landingDemo/mode";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

/** Account connections belong to the managed workspace, outside personal profile settings. */
export function ManagedDevPcConnections() {
  const [open, setOpen] = useState(false);
  if (!isManagedDevPc || isLandingDemo()) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-sm text-sidebar-muted-foreground/80 outline-hidden hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            data-devpc-connections-button
          />
        }
      >
        <PlugIcon className="size-5 shrink-0" aria-hidden />
        <span className="font-medium">Connections</span>
      </DialogTrigger>
      <DialogPopup
        className="h-[calc(100dvh-3rem)] w-screen max-w-none overflow-hidden rounded-t-2xl border-x-0 border-b-0 sm:h-[min(800px,calc(100dvh-2rem))] sm:w-[min(900px,calc(100vw-2rem))] sm:rounded-2xl sm:border"
        data-devpc-connections-dialog
      >
        <DialogHeader className="shrink-0 border-b py-4 pr-14">
          <DialogTitle className="text-lg">Connections</DialogTitle>
          <DialogDescription className="mt-1">
            Manage the accounts your workspace agents can use.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          // eslint-disable-next-line react/iframe-missing-sandbox -- trusted same-origin managed gateway
          <iframe
            className="min-h-0 flex-1 border-0 bg-background"
            data-devpc-connections-frame
            src="/_devpc/connections"
            title="Connected accounts"
          />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}
