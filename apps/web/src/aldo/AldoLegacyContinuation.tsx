import { useState } from "react";

import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { api, threadIdForEnvironment } from "./api";
import { useAldoAccounts } from "./useAldoAccounts";

export function AldoLegacyContinuation(props: { environmentId: string; threadId: string }) {
  const { accounts } = useAldoAccounts();
  const [open, setOpen] = useState(false);
  const [copyFiles, setCopyFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const providers = [
    ...(accounts?.opencode?.connected ? [{ id: "opencode", label: "OpenCode" }] : []),
    ...(accounts?.antigravity?.connected
      ? [{ id: "antigravity", label: "Google Antigravity" }]
      : []),
  ];
  if (!providers.length) return null;
  const start = async (provider: string) => {
    setBusy(true);
    setError(null);
    try {
      const { link } = await api<{ link: string }>(
        `/api/environments/${threadIdForEnvironment(props.environmentId)}/actions`,
        {
          method: "POST",
          body: JSON.stringify({
            action: "continue_on_new_machine",
            t3ThreadId: props.threadId,
            provider,
            copyFiles,
          }),
        },
      );
      if (!link?.startsWith("/aldo-")) throw new Error("The new conversation couldn’t be opened.");
      window.location.assign(link);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Couldn't start a new machine. Try again.");
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next);
      }}
    >
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Continue on a new machine
      </Button>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Continue on a new machine</DialogTitle>
          <DialogDescription>
            The new thread can use your connected models and will pick up from this conversation.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={copyFiles}
              onChange={(event) => setCopyFiles(event.target.checked)}
            />{" "}
            Bring the workspace files the thread needs
          </label>
          <div className="flex flex-wrap gap-2">
            {providers.map(({ id, label }) => (
              <Button
                key={id}
                disabled={busy}
                size="sm"
                variant="outline"
                onClick={() => void start(id)}
              >
                Use {label}
              </Button>
            ))}
          </div>
          {busy ? (
            <p role="status" className="text-sm">
              Starting a new thread…
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive-foreground">
              {error}
            </p>
          ) : null}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
