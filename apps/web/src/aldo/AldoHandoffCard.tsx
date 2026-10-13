// What only the user can get past, asked in place (handoffs.logic.ts): over
// the composer of the conversation that asked, a card with the reason, what
// to do and the one step that gets the agent going again: doing it in the
// agent's browser (full screen, AldoHandoffTakeover.tsx), typing a code for
// Aldo to put into the page, or skipping the site. The Browser panel shows a
// bar while its machine's agent waits on the user. Shown only when Aldo
// reports handoffs.

import { HandIcon, LoaderIcon } from "lucide-react";
import { useState, type MouseEvent } from "react";
import { create } from "zustand";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toastManager } from "../components/ui/toast";
import { AldoApiError, resolveAldoHandoff, type AldoHandoff } from "./cloud";
import { aldoMorph, aldoMorphSource } from "./morph";
import {
  aldoHandoffCode,
  aldoHandoffElsewhere,
  aldoHandoffEyebrow,
  aldoHandoffFor,
  aldoHandoffHow,
  aldoHandoffOn,
  aldoHandoffSkipLabel,
  aldoHandoffWantsCode,
} from "./handoffs.logic";
import { refreshAldoHome, useAldoHomeFeed, useAldoHomeRead } from "./homeFeed";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The handoff whose agent's browser fills the screen (AldoHandoffTakeover.tsx), if any. */
export const useAldoHandoffTakeover = create<{ readonly id: string | null }>(() => ({ id: null }));

/** What opened the takeover, for it to shrink back into on closing. */
let opener: HTMLElement | null = null;
const takeoverElement = () => document.querySelector<HTMLElement>("[data-aldo-takeover]");

/** Opens the takeover, growing out of `from` (the card or button that opened it) where it can. */
export function openAldoHandoffTakeover(id: string, from?: Element | null): void {
  if (useAldoHandoffTakeover.getState().id === id) return;
  const source = from instanceof HTMLElement ? (aldoMorphSource(from) ?? from) : null;
  opener = source;
  aldoMorph(() => useAldoHandoffTakeover.setState({ id }), source, takeoverElement);
}

export function closeAldoHandoffTakeover(): void {
  if (useAldoHandoffTakeover.getState().id === null) return;
  const back = opener?.isConnected ? opener : null;
  opener = null;
  aldoMorph(
    () => useAldoHandoffTakeover.setState({ id: null }),
    takeoverElement(),
    () => back,
  );
}

export type AldoHandoffAnswer =
  | { readonly decision: "done" | "skip" }
  | { readonly decision: "code"; readonly code: string };

/** Answers a handoff and says how it went; true once it's settled. */
export async function answerAldoHandoff(
  handoff: AldoHandoff,
  answer: AldoHandoffAnswer,
): Promise<boolean> {
  try {
    const { message } = await resolveAldoHandoff(handoff.id, answer);
    toastManager.add({ type: "success", title: message });
    return true;
  } catch (cause) {
    // A code that didn't go in leaves it open: the page is where to type it then.
    const typing = answer.decision === "code" && cause instanceof AldoApiError;
    const id = toastManager.add({
      type: typing ? "warning" : "error",
      title: typing ? "The code didn't go in" : "Couldn't do that",
      description: messageOf(cause),
      ...(typing
        ? {
            actionProps: {
              children: "Open its browser",
              onClick: () => {
                toastManager.close(id);
                openAldoHandoffTakeover(handoff.id);
              },
            },
          }
        : {}),
    });
    return false;
  } finally {
    void refreshAldoHome();
  }
}

/** Over a conversation's composer: what its agent waits on the user for, if anything. */
export function AldoHandoffCard(props: {
  readonly environmentId: string;
  readonly threadId: string;
}) {
  const { home } = useAldoHomeRead();
  const handoff = aldoHandoffFor(home, props);
  // Keyed, so a new request starts with an empty field.
  return handoff ? <HandoffCard key={handoff.id} handoff={handoff} /> : null;
}

function HandoffCard({ handoff }: { readonly handoff: AldoHandoff }) {
  return (
    // Solid under the tint: it floats over the conversation.
    <section
      aria-label="Your agent needs you"
      className="mb-2 overflow-hidden rounded-xl border border-warning/40 bg-background shadow-sm"
      data-aldo-handoff-card=""
    >
      <div className="bg-warning/8 p-3 sm:p-4">
        <p className="flex items-center gap-1.5 font-semibold text-[11px] text-warning uppercase tracking-wide">
          <HandIcon className="size-3.5 shrink-0" />
          {aldoHandoffEyebrow(handoff)}
        </p>
        <p className="mt-1 font-semibold text-foreground text-sm">{handoff.reason}</p>
        <AldoHandoffActions handoff={handoff} />
      </div>
    </section>
  );
}

/**
 * What to do and the buttons to do it: the card's, and the home screen's
 * under a conversation that waits on one (AldoHomeInbox.tsx).
 */
export function AldoHandoffActions(props: {
  readonly handoff: AldoHandoff;
  readonly onActed?: () => void;
}) {
  const { handoff } = props;
  const [busy, setBusy] = useState<"done" | "skip" | "code" | null>(null);
  const [code, setCode] = useState("");
  const elsewhere = aldoHandoffElsewhere(handoff);
  const wantsCode = aldoHandoffWantsCode(handoff);
  const answer = async (next: AldoHandoffAnswer) => {
    setBusy(next.decision);
    // Settled, it goes with the next read; until then it stays busy.
    if (await answerAldoHandoff(handoff, next)) props.onActed?.();
    else setBusy(null);
  };
  const open = (event: MouseEvent<HTMLElement>) =>
    openAldoHandoffTakeover(handoff.id, event.currentTarget);
  const spinner = (decision: typeof busy) =>
    busy === decision ? <LoaderIcon className="size-3.5 animate-spin" /> : null;
  return (
    <>
      <p className="mt-0.5 text-muted-foreground text-sm">{aldoHandoffHow(handoff)}</p>
      {wantsCode ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const typed = aldoHandoffCode(code);
            if (typed && busy === null) void answer({ decision: "code", code: typed });
          }}
        >
          <Input
            aria-label="The code"
            autoComplete="one-time-code"
            placeholder="The code"
            className="max-w-48"
            value={code}
            disabled={busy !== null}
            onChange={(event) => setCode(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={busy !== null || !aldoHandoffCode(code)}>
            {spinner("code")} Type it in
          </Button>
        </form>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {wantsCode ? (
          <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={open}>
            Open its browser
          </Button>
        ) : elsewhere ? (
          <>
            <Button
              type="button"
              size="sm"
              disabled={busy !== null}
              onClick={() => void answer({ decision: "done" })}
            >
              {spinner("done")} I'm done
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={open}>
              Open its browser
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" disabled={busy !== null} onClick={open}>
            <HandIcon className="size-3.5" /> Do it now
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy !== null}
          onClick={() => void answer({ decision: "skip" })}
        >
          {spinner("skip")} {aldoHandoffSkipLabel(handoff)}
        </Button>
      </div>
    </>
  );
}

/**
 * Over the Browser panel's page while its machine's agent waits on the user
 * there: take it over full screen, or say it's done after doing it here.
 * Reads the home the page already has; it doesn't keep it fresh itself.
 */
export function AldoHandoffBar(props: { readonly environmentId: string }) {
  const home = useAldoHomeFeed((s) => s.home);
  const handoff = aldoHandoffOn(home, props.environmentId);
  const [busy, setBusy] = useState(false);
  if (!handoff) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-warning/40 bg-warning/8 px-3 py-1.5 text-xs">
      <HandIcon className="size-3.5 shrink-0 text-warning" />
      <span className="min-w-0 flex-1 truncate">Your agent is waiting for you here</span>
      <Button
        type="button"
        size="compact"
        variant="ghost"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void answerAldoHandoff(handoff, { decision: "done" }).then(() => setBusy(false));
        }}
      >
        I'm done
      </Button>
      <Button
        type="button"
        size="compact"
        disabled={busy}
        onClick={(event) => openAldoHandoffTakeover(handoff.id, event.currentTarget)}
      >
        Take over
      </Button>
    </div>
  );
}
