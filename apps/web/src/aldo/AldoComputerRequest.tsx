// Home offers the same computer request as its thread, at the time it arrived.
import { useState } from "react";
import { cn } from "~/lib/utils";
import { answerAldoComputer } from "./workspaceApi";
import { refreshAldoHome } from "./homeFeed";
import { requestAldoDirectoryRefresh } from "./directory";
import { addAldoReceipt } from "./receipts";
import type { ComputerRequest } from "./needsYou.logic";
import { aldoComputerAskDescription } from "./computer.logic";
import { PRIMARY, SECONDARY, SURFACE } from "./surface";

export function AldoComputerRequest({ request }: { readonly request: ComputerRequest }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answer = async (approve: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await answerAldoComputer(
        request.conversation.thread.environmentId,
        approve,
        request.computer.computer,
      );
      addAldoReceipt({
        key: request.key,
        at: request.at,
        text: approve ? `${request.title}: approved` : `${request.title}: declined`,
        thread: request.conversation.thread,
      });
      requestAldoDirectoryRefresh();
      void refreshAldoHome();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't answer your agent. Try again.");
      setBusy(false);
      void refreshAldoHome();
    }
  };
  return (
    <article
      data-aldo-computer-request={request.key}
      tabIndex={-1}
      aria-label={request.title}
      className={cn(SURFACE, "flex min-w-0 flex-col gap-3 p-4 [overflow-wrap:anywhere]")}
    >
      <p className="text-xs text-muted-foreground">
        Computer request · {request.conversation.title}
      </p>
      <h3 className="text-sm font-medium">{request.title}</h3>
      <p className="break-words text-sm text-muted-foreground">
        {aldoComputerAskDescription({
          why: request.computer.why ?? null,
          creditsPerHour: request.computer.creditsPerHour,
        })}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          className={cn(PRIMARY, "min-h-11 px-4 text-sm")}
          onClick={() => void answer(true)}
        >
          {busy ? "Answering…" : "Start it"}
        </button>
        <button
          type="button"
          disabled={busy}
          className={cn(SECONDARY, "min-h-11 px-4 text-sm")}
          onClick={() => void answer(false)}
        >
          Not now
        </button>
      </div>
    </article>
  );
}
