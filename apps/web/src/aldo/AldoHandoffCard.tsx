// What only the user can get past, asked in place (handoffs.logic.ts): over
// the composer of the conversation that asked, a card with the reason, what
// to do and the one step that gets the agent going again: taking control of
// the agent's browser (full screen, AldoHandoffTakeover.tsx) or doing it on a
// phone, typing a code for Aldo to put into the page, or skipping the site.
// On a computer, "Do it on my phone" shows a QR code for the phone: the
// conversation with that browser full screen (behind the phone's own Aldo
// sign-in), or the site's own "continue on your phone" link for a camera
// step. The Browser panel shows a bar while its machine's agent waits on the
// user. Shown only when Aldo reports handoffs.

import { ExternalLinkIcon, HandIcon, LoaderIcon, SmartphoneIcon } from "lucide-react";
import { useState, type MouseEvent } from "react";
import { create } from "zustand";

import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { QRCodeSvg } from "../components/ui/qr-code";
import { toastManager } from "../components/ui/toast";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { cn } from "~/lib/utils";
import { AldoApiError } from "./api";
import { resolveAldoHandoff, type AldoHandoff } from "./homeApi";
import { aldoMorph, aldoMorphSource } from "./morph";
import {
  aldoHandoffButtons,
  aldoHandoffCode,
  aldoHandoffEyebrow,
  aldoHandoffFor,
  aldoHandoffHow,
  aldoHandoffOn,
  aldoHandoffPhoneLink,
  aldoHandoffSiteLabel,
  aldoHandoffSiteLink,
  aldoHandoffSiteName,
  aldoHandoffSkipLabel,
  aldoHandoffWantsCode,
  type AldoHandoffButton,
} from "./handoffs.logic";
import { refreshAldoHome, useAldoHomeFeed, useAldoHomeRead } from "./homeFeed";
import { PRIMARY, SECONDARY } from "./surface";

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
 * A phone or tablet, in the hand: touch, with no mouse to hover. Its own
 * browser is where "Do it on my phone" would go, held either way up (a phone
 * on its side is as wide as a small laptop).
 */
export function useAldoOnPhone(): boolean {
  return useMediaQuery("(pointer: coarse) and (hover: none)");
}

/**
 * What to do and the buttons to do it: the card's, and the home screen's
 * under a conversation that waits on one (AldoHomeInbox.tsx). `pills` makes
 * them the big round buttons of Aldo's conversation (AldoUpNext.tsx). Which
 * buttons, and in what order, is aldoHandoffButtons'.
 */
export function AldoHandoffActions(props: {
  readonly handoff: AldoHandoff;
  readonly onActed?: () => void;
  readonly pills?: boolean;
}) {
  const { handoff } = props;
  const [busy, setBusy] = useState<"done" | "skip" | "code" | null>(null);
  const [code, setCode] = useState("");
  const [phoneOpen, setPhoneOpen] = useState(false);
  const onPhone = useAldoOnPhone();
  const phoneLink = aldoHandoffPhoneLink(handoff, window.location.origin);
  const siteLink = aldoHandoffSiteLink(handoff);
  const buttons = aldoHandoffButtons(handoff, { onPhone, phoneLink: phoneLink !== null });
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
  const submitCode = () => {
    const typed = aldoHandoffCode(code);
    if (typed && busy === null) void answer({ decision: "code", code: typed });
  };
  const label = (button: AldoHandoffButton) => {
    switch (button) {
      case "take":
        return <>{props.pills ? null : <HandIcon className="size-3.5" />} Take control</>;
      case "phone":
        return (
          <>{props.pills ? null : <SmartphoneIcon className="size-3.5" />} Do it on my phone</>
        );
      case "site":
        return (
          <>
            {aldoHandoffSiteLabel(handoff)} <ExternalLinkIcon className="size-3.5" />
          </>
        );
      case "done":
        return <>{spinner("done")} I'm done</>;
      case "browser":
        return "Open its browser";
      case "skip":
        return (
          <>
            {spinner("skip")} {aldoHandoffSkipLabel(handoff)}
          </>
        );
    }
  };
  /** What a button does (the site's page is a link instead). */
  const act = (button: AldoHandoffButton, event: MouseEvent<HTMLElement>) => {
    if (button === "take" || button === "browser") open(event);
    else if (button === "phone") setPhoneOpen((was) => !was);
    else if (button === "done") void answer({ decision: "done" });
    else if (button === "skip") void answer({ decision: "skip" });
  };
  const phonePanel =
    phoneOpen && phoneLink && buttons.includes("phone") ? (
      <HandoffPhonePanel
        handoff={handoff}
        link={phoneLink}
        busy={busy !== null}
        doneBusy={busy === "done"}
        onDone={() => void answer({ decision: "done" })}
      />
    ) : null;

  if (props.pills) {
    // Aldo's conversation (AldoUpNext.tsx): the way out on the left, the way on on the right, the rest quietly under them.
    const [main] = buttons;
    const quiet = buttons.filter((button) => button !== main && button !== "skip");
    const mainClass = main === "browser" ? SECONDARY : PRIMARY;
    return (
      <>
        <p className="text-[14px] text-muted-foreground leading-6 dark:text-foreground/70">
          {aldoHandoffHow(handoff)}
        </p>
        {wantsCode ? (
          <form
            className="flex h-11 items-center gap-1 rounded-full bg-foreground/[0.05] ps-4 pe-1 focus-within:bg-foreground/[0.07]"
            onSubmit={(event) => {
              event.preventDefault();
              submitCode();
            }}
          >
            <input
              aria-label="The code"
              autoComplete="one-time-code"
              inputMode="numeric"
              placeholder="The code"
              className="min-w-0 flex-1 bg-transparent text-[15px] tracking-[0.08em] outline-none placeholder:tracking-normal placeholder:text-muted-foreground/70"
              value={code}
              disabled={busy !== null}
              onChange={(event) => setCode(event.target.value)}
            />
            <button
              type="submit"
              className={cn(PRIMARY, "h-9 px-4 text-sm")}
              disabled={busy !== null || !aldoHandoffCode(code)}
            >
              {spinner("code")} Type it in
            </button>
          </form>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={SECONDARY}
            disabled={busy !== null}
            onClick={() => void answer({ decision: "skip" })}
          >
            {label("skip")}
          </button>
          {main === "site" && siteLink ? (
            <a className={PRIMARY} href={siteLink} target="_blank" rel="noopener noreferrer">
              {label("site")}
            </a>
          ) : main ? (
            <button
              type="button"
              className={mainClass}
              disabled={busy !== null}
              onClick={(event) => act(main, event)}
            >
              {label(main)}
            </button>
          ) : null}
        </div>
        {quiet.length > 0 ? (
          <div className="-mb-1 flex flex-wrap justify-center gap-1">
            {quiet.map((button) => (
              <button
                key={button}
                type="button"
                className="rounded-full px-3 py-1 text-muted-foreground text-sm hover:text-foreground pointer-coarse:min-h-11"
                disabled={busy !== null && button !== "phone"}
                aria-expanded={button === "phone" ? phoneOpen : undefined}
                onClick={(event) => act(button, event)}
              >
                {label(button)}
              </button>
            ))}
          </div>
        ) : null}
        {phonePanel}
      </>
    );
  }
  return (
    <>
      <p className="mt-0.5 text-muted-foreground text-sm">{aldoHandoffHow(handoff)}</p>
      {wantsCode ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitCode();
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
        {buttons.map((button, index) => {
          // The main one first (a code's is its field's); the phone and "I'm done" beside it; the rest quiet.
          const variant =
            index === 0 && !wantsCode
              ? "default"
              : button === "phone" || button === "done" || (index === 0 && wantsCode)
                ? "outline"
                : "ghost";
          if (button === "site" && siteLink)
            return (
              <Button
                key={button}
                size="sm"
                variant={variant}
                render={<a href={siteLink} target="_blank" rel="noopener noreferrer" />}
              >
                {label(button)}
              </Button>
            );
          return (
            <Button
              key={button}
              type="button"
              size="sm"
              variant={variant}
              disabled={busy !== null && button !== "phone"}
              aria-expanded={button === "phone" ? phoneOpen : undefined}
              onClick={(event) => act(button, event)}
            >
              {label(button)}
            </Button>
          );
        })}
      </div>
      {phonePanel}
    </>
  );
}

/**
 * "Do it on my phone", on a computer: a QR code for the phone's camera and the
 * link to copy. It opens the site's own page for a camera step, or the
 * conversation with the agent's browser full screen, which hands it back
 * there; either way "I'm done" here hands it back too.
 */
function HandoffPhonePanel(props: {
  readonly handoff: AldoHandoff;
  readonly link: { readonly href: string; readonly onSite: boolean };
  readonly busy: boolean;
  readonly doneBusy: boolean;
  readonly onDone: () => void;
}) {
  const { handoff, link } = props;
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    onError: () => toastManager.add({ type: "error", title: "Couldn't copy the link" }),
  });
  const site = aldoHandoffSiteName(handoff);
  return (
    <div className="mt-3 flex items-start gap-3 rounded-lg border border-border bg-background p-3">
      {/* Dark on white whatever the theme: a camera reads it that way. */}
      <div className="shrink-0 rounded-md bg-white p-1">
        <QRCodeSvg
          value={link.href}
          size={128}
          level="M"
          marginSize={1}
          title="QR code for your phone"
        />
      </div>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium text-foreground">Scan it with your phone's camera</p>
        <p className="mt-0.5 text-muted-foreground">
          {link.onSite
            ? `It opens ${site ? `${site}'s` : "the site's"} own page for this step, where your phone's camera works. Hand it back here when you've finished.`
            : "It opens your agent's browser at this step, full screen, once your phone is signed in to Aldo. Hand it back there or here."}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={props.busy}
            onClick={props.onDone}
          >
            {props.doneBusy ? <LoaderIcon className="size-3.5 animate-spin" /> : null} I'm done
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => copyToClipboard(link.href, undefined)}
          >
            {isCopied ? "Copied" : "Copy link"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Over the Browser panel's page while its machine's agent waits on the user
 * there: take it over full screen, or say it's done after doing it here (not
 * while a recording holds the browser: that's finished first).
 * Reads the home the page already has; it doesn't keep it fresh itself.
 */
export function AldoHandoffBar(props: {
  readonly environmentId: string;
  /** A recording is under way or waiting to be taught (AldoTeach.tsx). */
  readonly teaching?: boolean;
}) {
  const home = useAldoHomeFeed((s) => s.home);
  const handoff = aldoHandoffOn(home, props.environmentId);
  const [busy, setBusy] = useState(false);
  if (!handoff) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-warning/40 bg-warning/8 px-3 py-1.5 text-xs">
      <HandIcon className="size-3.5 shrink-0 text-warning" />
      <span className="min-w-0 flex-1 truncate">
        {props.teaching
          ? "Finish the recording to hand it back"
          : "Your agent is waiting for you here"}
      </span>
      <Button
        type="button"
        size="compact"
        variant="ghost"
        disabled={busy || props.teaching}
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
