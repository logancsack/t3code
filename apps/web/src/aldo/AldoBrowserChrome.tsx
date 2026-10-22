// The shared browser's chrome (AldoBrowserPanel.tsx), laid out as a browser's
// own: tabs on top, then the address, then one line that says who's using it
// (the agent, the user, a recording, an agent waiting on the user) with the
// one thing to do about it. That line is always there and always one line
// high, so the page under it never moves.

import {
  AppWindowIcon,
  ArrowRightIcon,
  CircleAlertIcon,
  GlobeIcon,
  HandIcon,
  LoaderIcon,
  Maximize2Icon,
  MonitorIcon,
  MoonIcon,
  PlusIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "../components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { faviconUrlForOrigin } from "../lib/favicon";
import { cn } from "../lib/utils";
import { answerAldoHandoff, openAldoHandoffTakeover } from "./AldoHandoffCard";
import {
  aldoAddressParts,
  aldoBlankPage,
  aldoTabTitle,
  type AldoBrowserState,
} from "./browserChrome.logic";
import type { AldoHandoff } from "./homeApi";
import { aldoOfflineMessage } from "./directory";
import { aldoTeachClock, type AldoTeach } from "./teach.logic";
import { fetchAldoPreviews, type AldoPreviews } from "./workspaceApi";

export type AldoBrowserTab = { id: string; url: string; title: string };

/** The status line's buttons: the line's own size of text. */
const LINE_BUTTON = "gap-1.5 px-2.5 sm:text-[13px]";

/** A tab's site icon, the page's own where there is one, else a globe; a spinner while it loads. */
function TabIcon(props: { url: string; loading: boolean }) {
  const src = faviconUrlForOrigin(props.url, 32);
  const [failed, setFailed] = useState<string | null>(null);
  if (props.loading) return <LoaderIcon className="size-3.5 shrink-0 animate-spin opacity-70" />;
  if (!src || failed === src) return <GlobeIcon className="size-3.5 shrink-0 opacity-60" />;
  return (
    <img
      src={src}
      alt=""
      className="size-4 shrink-0 rounded-[3px]"
      onError={() => setFailed(src)}
      referrerPolicy="no-referrer"
    />
  );
}

/**
 * The browser's tabs, as Chrome draws them: the open one joined to the
 * address bar under it, the others quieter, a close button on the open one
 * (and on any other under the pointer), and + for a new one.
 */
export function AldoBrowserTabs(props: {
  tabs: ReadonlyArray<AldoBrowserTab>;
  active: string | null;
  /** The open tab is loading. */
  loading: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  /** Whether the machine's browser is reachable: a new tab waits for it. */
  connected: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-9 shrink-0 items-end gap-2 bg-muted/60 ps-1.5 pe-1.5 dark:bg-white/[0.03]">
      <div
        role="tablist"
        aria-label="Browser tabs"
        className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {props.tabs.map((tab) => {
          const open = tab.id === props.active;
          const title = aldoTabTitle(tab);
          return (
            <div
              key={tab.id}
              data-open={open || undefined}
              className={cn(
                "group/tab relative flex h-[30px] min-w-16 max-w-52 flex-1 basis-0 items-center rounded-t-lg text-xs transition-colors",
                open
                  ? "bg-background text-foreground shadow-[0_-1px_0_0_var(--color-border)]"
                  : "text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground",
              )}
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      role="tab"
                      aria-selected={open}
                      onClick={() => props.onActivate(tab.id)}
                      className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-t-lg ps-2.5 pe-1 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    />
                  }
                >
                  <TabIcon url={tab.url} loading={open && props.loading} />
                  <span className="min-w-0 truncate">{title}</span>
                </TooltipTrigger>
                <TooltipPopup side="bottom" className="max-w-96">
                  <span className="block font-medium">{title}</span>
                  {tab.url && !aldoBlankPage(tab.url) ? (
                    <span className="block truncate text-muted-foreground">{tab.url}</span>
                  ) : null}
                </TooltipPopup>
              </Tooltip>
              <button
                type="button"
                aria-label={`Close ${title}`}
                onClick={() => props.onClose(tab.id)}
                className={cn(
                  "me-1 size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-foreground/[0.08] hover:text-foreground focus-visible:inline-flex focus-visible:ring-2 focus-visible:ring-ring",
                  // Another tab's takes room from its title only under the pointer.
                  open ? "inline-flex" : "hidden group-hover/tab:inline-flex",
                )}
              >
                <XIcon className="size-3" />
              </button>
            </div>
          );
        })}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="New tab"
                disabled={!props.connected}
                onClick={props.onNew}
                className="mb-[3px] inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 pointer-coarse:size-8"
              />
            }
          >
            <PlusIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup>New tab</TooltipPopup>
        </Tooltip>
      </div>
      <div className="flex shrink-0 items-center self-center">{props.children}</div>
    </div>
  );
}

/** Browser or Desktop: the page alone, or the agent's whole screen. */
export function AldoBrowserViewSwitch(props: {
  view: "browser" | "desktop";
  onChange: (view: "browser" | "desktop") => void;
}) {
  const options = [
    ["browser", GlobeIcon, "Browser", "Just the page"],
    ["desktop", MonitorIcon, "Desktop", "Its whole screen: Chrome, desktop apps and the taskbar"],
  ] as const;
  return (
    <div
      role="tablist"
      aria-label="View"
      className="flex shrink-0 items-center rounded-lg bg-foreground/[0.05] p-0.5 dark:bg-white/[0.06]"
    >
      {options.map(([value, Icon, label, hint]) => (
        <Tooltip key={value}>
          <TooltipTrigger
            render={
              <button
                type="button"
                role="tab"
                aria-selected={props.view === value}
                aria-label={label}
                onClick={() => props.onChange(value)}
                className={cn(
                  "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  props.view === value
                    ? "bg-background text-foreground shadow-xs dark:bg-white/[0.1]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              />
            }
          >
            <Icon className="size-3.5" />
            <span className="hidden @[30rem]:inline">{label}</span>
          </TooltipTrigger>
          <TooltipPopup>{hint}</TooltipPopup>
        </Tooltip>
      ))}
    </div>
  );
}

/** The recording's clock, from when it started, stopping at its limit. */
function useTeachClock(teach: AldoTeach | null): string {
  const [now, setNow] = useState(() => Date.now());
  const running = teach?.state === "recording";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return teach ? aldoTeachClock(Math.min(now, teach.endsAt) - teach.startedAt) : "0:00";
}

/**
 * The line under the address: who's using the browser right now, and the one
 * thing to do about it. One state at a time (browserChrome.logic.ts), in one
 * place, at one height.
 */
export function AldoBrowserStatus(props: {
  state: AldoBrowserState;
  /** What the user sees: the page, or the agent's whole desktop. */
  surface: "browser" | "desktop";
  teach: AldoTeach | null;
  handoff: AldoHandoff | null;
  /** A recording waits to be taught: it's handed back only after. */
  teaching: boolean;
  /** Whether the machine's browser is reachable: what's sent waits for it. */
  connected: boolean;
  onTake: () => void;
  onHandBack: () => void;
  onStopRecording: () => void;
}) {
  const clock = useTeachClock(props.teach);
  const [handing, setHanding] = useState(false);
  const page = props.surface === "desktop" ? "desktop" : "page";
  const take = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="compact"
            variant="outline"
            className={LINE_BUTTON}
            disabled={!props.connected}
            onClick={props.onTake}
          />
        }
      >
        <HandIcon /> Take control
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        Your agent waits until you hand it back, for up to 30 minutes.
      </TooltipPopup>
    </Tooltip>
  );

  let tone = "";
  let indicator: ReactNode;
  let title: ReactNode;
  let detail: ReactNode = null;
  // What's said first where there's room for only one: a handoff's reason, over "Your agent needs you".
  let detailFirst = false;
  let actions: ReactNode;
  switch (props.state) {
    case "recording":
      tone = "bg-destructive/[0.06] dark:bg-destructive/[0.1]";
      indicator = (
        <span className="relative flex size-2.5 items-center justify-center" aria-hidden>
          <span className="absolute inset-0 animate-ping rounded-full bg-destructive/50 motion-reduce:hidden" />
          <span className="size-2 rounded-full bg-destructive" />
        </span>
      );
      title = (
        <span className="tabular-nums">
          {/* The clock ticks outside what's announced: "Recording" is said once. */}
          Recording<span aria-hidden> · {clock}</span>
        </span>
      );
      detail = "Do the task here. Agents wait; passwords aren't recorded.";
      actions = (
        <Button
          type="button"
          size="compact"
          variant="outline"
          className={LINE_BUTTON}
          disabled={!props.connected}
          onClick={props.onStopRecording}
        >
          <SquareIcon className="size-3 fill-current" /> Stop
        </Button>
      );
      break;
    case "handoff": {
      const handoff = props.handoff;
      tone = "bg-warning/[0.08] dark:bg-warning/[0.1]";
      indicator = <HandIcon className="size-4 text-warning" aria-hidden />;
      title = "Your agent needs you";
      detail = props.teaching ? "Finish the recording to hand it back." : handoff?.reason;
      detailFirst = Boolean(detail);
      actions = handoff ? (
        <>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="compact"
                  variant="ghost"
                  className={LINE_BUTTON}
                  aria-label="Full screen"
                  onClick={(event) => openAldoHandoffTakeover(handoff.id, event.currentTarget)}
                />
              }
            >
              <Maximize2Icon />
              <span className="hidden @[36rem]:inline">Full screen</span>
            </TooltipTrigger>
            <TooltipPopup>Do it full screen, with what to do beside it</TooltipPopup>
          </Tooltip>
          <Button
            type="button"
            size="compact"
            className={LINE_BUTTON}
            disabled={handing || props.teaching}
            onClick={() => {
              setHanding(true);
              void answerAldoHandoff(handoff, { decision: "done" }).finally(() =>
                setHanding(false),
              );
            }}
          >
            {handing ? <LoaderIcon className="animate-spin" /> : null} I'm done
          </Button>
        </>
      ) : null;
      break;
    }
    case "yours":
      tone = "bg-primary/[0.06] dark:bg-primary/[0.1]";
      indicator = <HandIcon className="size-4 text-primary" aria-hidden />;
      title = "You have control";
      detail = "Your agent waits until you hand it back.";
      actions = (
        <Button
          type="button"
          size="compact"
          className={LINE_BUTTON}
          disabled={!props.connected}
          onClick={props.onHandBack}
        >
          Hand back
        </Button>
      );
      break;
    case "using":
      indicator = <span className="size-2 rounded-full bg-foreground/70" aria-hidden />;
      title = `You're using the ${page}`;
      detail = "Your agent waits until you stop.";
      actions = take;
      break;
    case "agent":
      indicator = (
        <span className="relative flex size-2.5 items-center justify-center" aria-hidden>
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/40 motion-reduce:hidden" />
          <span className="size-2 rounded-full bg-primary" />
        </span>
      );
      title =
        props.surface === "desktop" ? "Your agent is using the desktop" : "Your agent is browsing";
      detail = "Watch here, or take control to do something yourself.";
      actions = take;
      break;
    case "shared":
      indicator = <span className="size-2 rounded-full bg-muted-foreground/35" aria-hidden />;
      title = "Shared with your agent";
      detail = `Click the ${page} to use it too.`;
      actions = take;
      break;
  }

  return (
    <div
      className={cn(
        "flex h-10 shrink-0 items-center gap-2.5 border-b border-border/60 ps-3 pe-1.5 text-[13px] pointer-coarse:h-12",
        tone,
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{indicator}</span>
      <p role="status" className="flex min-w-0 flex-1 items-baseline gap-2">
        <span
          className={cn(
            // The title truncates last: at most the line's width, the detail giving way first.
            "max-w-full shrink-0 truncate font-medium text-foreground",
            detailFirst && "hidden @[34rem]:inline",
          )}
        >
          {title}
        </span>
        {detail ? (
          <span
            className={cn(
              "min-w-0 truncate",
              detailFirst
                ? "text-foreground @[34rem]:text-muted-foreground"
                : "hidden text-muted-foreground @[34rem]:inline",
            )}
          >
            {detail}
          </span>
        ) : null}
      </p>
      <div className="flex shrink-0 items-center gap-1">{actions}</div>
    </div>
  );
}

/**
 * The address, as a browser's: at rest it reads as text (the site in full,
 * the rest quieter); clicked, it's the whole address, selected, to type over.
 * Escape puts it back.
 */
export function AldoAddressBar(props: { url: string; onSubmit: (address: string) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");
  const parts = aldoAddressParts(props.url);
  const shown = aldoBlankPage(props.url) ? "" : props.url;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = draft.trim();
    if (!next) return;
    props.onSubmit(next);
    inputRef.current?.blur();
  };
  const text = "text-base sm:text-[13px]";
  return (
    <form onSubmit={submit} className="relative min-w-0 flex-1">
      <input
        ref={inputRef}
        aria-label="Address"
        placeholder="Search or enter an address"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="go"
        value={focused ? draft : shown}
        onFocus={() => {
          setDraft(shown);
          setFocused(true);
          queueMicrotask(() => inputRef.current?.select());
        }}
        onBlur={() => setFocused(false)}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          setDraft(shown);
          inputRef.current?.blur();
        }}
        className={cn(
          "h-7 w-full rounded-md bg-foreground/[0.045] px-2.5 text-foreground outline-none transition-[background-color,box-shadow] placeholder:text-muted-foreground hover:bg-foreground/[0.07] focus:bg-background focus:ring-2 focus:ring-ring dark:bg-white/[0.06] dark:hover:bg-white/[0.08] pointer-coarse:h-9",
          text,
          !focused && parts && "text-transparent",
        )}
      />
      {!focused && parts ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 start-0 end-0 flex items-center overflow-hidden whitespace-nowrap px-2.5",
            text,
          )}
        >
          <span className="shrink-0 text-foreground">{parts.host}</span>
          <span className="min-w-0 truncate text-muted-foreground">{parts.rest}</span>
        </span>
      ) : null}
    </form>
  );
}

/**
 * A tab with nothing in it yet: what this browser is, and the thread's own
 * previews (its dev servers) to open in it.
 */
export function AldoBrowserStart(props: {
  environmentId: string;
  onOpen: (address: string) => void;
}) {
  const [ports, setPorts] = useState<AldoPreviews["ports"]>([]);
  useEffect(() => {
    let current = true;
    fetchAldoPreviews(props.environmentId)
      .then((previews) => current && setPorts(previews.ports))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [props.environmentId]);
  return (
    <div className="absolute inset-0 overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-sm flex-col items-center px-6 pt-[clamp(2rem,12vh,6rem)] pb-8 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-foreground/[0.05] dark:bg-white/[0.06]">
          <GlobeIcon className="size-5 text-muted-foreground" />
        </span>
        <h2 className="mt-4 font-medium text-[15px] text-foreground">Your agent's browser</h2>
        <p className="mt-1.5 text-balance text-[13px] text-muted-foreground leading-5">
          Your agent browses here while it works, and you can too. Type an address above
          {ports.length > 0 ? ", or open what's running on its computer." : "."}
        </p>
        {ports.length > 0 ? (
          <div className="mt-6 w-full text-left">
            <p className="px-1 pb-1.5 text-muted-foreground text-xs">Previews</p>
            <ul className="overflow-hidden rounded-xl border border-border/70">
              {ports.map((port) => (
                <li key={port.port} className="border-border/70 not-first:border-t">
                  <button
                    type="button"
                    onClick={() => props.onOpen(`http://localhost:${port.port}`)}
                    className="group/row flex h-12 w-full items-center gap-3 px-3.5 text-left outline-none transition-colors hover:bg-foreground/[0.035] focus-visible:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <AppWindowIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="shrink-0 font-medium text-[13px] text-foreground">
                      localhost:{port.port}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">
                      {port.command || port.process}
                    </span>
                    <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A screen (the browser's page, or the desktop) while it isn't showing:
 * connecting, asleep, or out of reach. Before any picture it fills the view;
 * over the last picture (dimmed), it's one line across its top.
 */
export function AldoScreenState(props: {
  status: "connecting" | "starting" | "asleep" | "error";
  environmentId: string;
  /** What's connecting: "the browser", "the desktop". */
  what: string;
  error?: string | null;
  /** Whether the last picture is still there, dimmed. */
  over?: boolean;
  /** Tries again now, rather than when the backoff says. */
  onRetry?: () => void;
}) {
  let title: string;
  let detail: string | null = null;
  let Icon = LoaderIcon;
  if (props.status === "asleep") {
    // "Its computer is asleep. It wakes when you send a message.": the first sentence leads.
    const message = aldoOfflineMessage(props.environmentId);
    const split = message.indexOf(". ");
    title = split > 0 ? message.slice(0, split + 1) : message;
    detail = split > 0 ? message.slice(split + 2) : null;
    if (!message.endsWith("…")) Icon = MoonIcon;
  } else if (props.status === "error") {
    title = `Couldn't reach ${props.what}`;
    detail = `${props.error ? `${props.error.replace(/\.+$/, "")}. ` : ""}Trying again in a few seconds.`;
    Icon = CircleAlertIcon;
  } else if (props.status === "starting") {
    title = "Starting the browser…";
    detail = "Chrome is opening on your agent's computer.";
  } else {
    title = `Connecting to ${props.what}…`;
  }
  const spinning = Icon === LoaderIcon;
  const retry = props.status === "error" && props.onRetry ? props.onRetry : null;

  if (props.over) {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-3">
        <div
          role="status"
          className="pointer-events-auto flex h-8 max-w-full items-center gap-2 rounded-full border border-border/70 bg-popover ps-3 pe-1 text-[13px] text-popover-foreground shadow-md"
        >
          <Icon
            className={cn("size-3.5 shrink-0 text-muted-foreground", spinning && "animate-spin")}
          />
          <span className="min-w-0 truncate pe-2">{title}</span>
          {retry ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="rounded-full"
              onClick={retry}
            >
              Try now
            </Button>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
      <div role="status" className="flex max-w-xs flex-col items-center text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-foreground/[0.05] text-muted-foreground dark:bg-white/[0.06]">
          <Icon className={cn("size-5", spinning && "animate-spin")} />
        </span>
        <p className="mt-4 text-balance font-medium text-[15px] text-foreground">{title}</p>
        {detail ? (
          <p className="mt-1.5 text-balance text-[13px] text-muted-foreground leading-5">
            {detail}
          </p>
        ) : null}
        {retry ? (
          <Button type="button" size="sm" variant="outline" className="mt-4" onClick={retry}>
            Try now
          </Button>
        ) : null}
      </div>
    </div>
  );
}
