import {
  ArrowLeftIcon,
  ArrowRightIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  GraduationCapIcon,
  Maximize2Icon,
  Minimize2Icon,
  MonitorIcon,
  PlusIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useParams } from "@tanstack/react-router";

import { readComposerThreadPrompt, useComposerDraftStore } from "../composerDraftStore";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { toastManager } from "../components/ui/toast";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { cn } from "../lib/utils";
import { useAldoBrowserRequests } from "./browserStore";
import { stopAldoThreadComputer, useAldoComputer } from "./AldoComputer";
import { AldoDesktopScreenSwitch, AldoDesktopView } from "./AldoDesktopView";
import {
  AldoAddressBar,
  AldoBrowserStart,
  AldoBrowserStatus,
  AldoBrowserTabs,
  AldoBrowserViewSwitch,
  AldoScreenState,
} from "./AldoBrowserChrome";
import { useAldoHandoffTakeover } from "./AldoHandoffCard";
import type { AldoKeyInputHandle } from "./AldoKeyInput";
import { AldoLivePage } from "./AldoLivePage";
import { AldoLoginOfferCard } from "./AldoLoginOfferCard";
import { AldoTeachForm } from "./AldoTeach";
import {
  aldoBlankPage,
  aldoBrowserState,
  aldoDialogFrom,
  aldoTabTitle,
} from "./browserChrome.logic";
import { aldoHandoffOn } from "./handoffs.logic";
import { useAldoHomeFeed } from "./homeFeed";
import { AldoApiError } from "./api";
import { aldoBrowserConnection, aldoPreviewUrl } from "./workspaceApi";
import {
  aldoMachineIsAsleep,
  getAldoEnvironments,
  subscribeAldoEnvironments,
  whenAldoMachineUp,
} from "./directory";
import { aldoDesktopScreen, type AldoDesktopScreen } from "./computer.logic";
import { aldoCanDecodeH264, AldoVideoPlayer } from "./liveVideo";
import { ALDO_FRAME_VIDEO } from "./liveVideo.logic";
import {
  ALDO_FRAME_JPEG,
  aldoLiveViewSize,
  aldoLiveViewUrl,
  parseAldoLiveFrame,
} from "./liveView.logic";
import { aldoFieldOf, aldoKeyboardFor, type AldoField, type AldoSize } from "./livePage.logic";
import {
  nextAldoLoginOffer,
  parseAldoLoginOffers,
  pendingAldoLoginAnswers,
  type AldoLoginOffer,
} from "./loginOffers.logic";
import { neverSaveLoginsFor, useAldoNeverSaveLogins } from "./neverSaveLogins";
import { useAldoPageVisible } from "./pageVisibility";
import { promptWith } from "./summon.logic";
import {
  aldoTeachMessage,
  parseAldoTeach,
  parseAldoTeachSteps,
  type AldoTeach,
} from "./teach.logic";

type Tab = { id: string; url: string; title: string };
type Nav = { url: string; canGoBack: boolean; canGoForward: boolean; loading: boolean };
type Control = { human: boolean; explicit: boolean; agentActiveAt: number };
type Dialog = { message: string; type: string; defaultPrompt?: string };
type FrameMeta = { deviceWidth: number; deviceHeight: number };
type Status = "connecting" | "live" | "asleep" | "error";
// How long the agent counts as browsing after its last step: long enough to
// span the pause while it thinks, so the line under the address holds still.
const AGENT_ACTIVE_MS = 15_000;
// How long agents wait after the user's last click or key (the machine's INPUT_HOLD_MS).
const USE_HOLD_MS = 10_000;

// A phone, upright or on its side: one row of controls over the page.
const COMPACT =
  "(pointer: coarse) and (max-width: 639px), (pointer: coarse) and (max-height: 500px)";

function localPort(url: string): number | null {
  try {
    const parsed = new URL(url);
    if (!["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(parsed.hostname)) return null;
    return Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
  } catch {
    return null;
  }
}

/**
 * The thread's shared browser: a live view of Chrome in the sandbox. The user
 * can browse and type in it; agents drive the same browser, and "Take control"
 * holds them off (for sign-ins, 2FA or anything the user wants to do alone).
 */
export function AldoBrowserPanel({
  environmentId,
  threadId,
  inTakeover = false,
  onTeaching,
}: {
  environmentId: string;
  /** The conversation "Teach this" teaches; else the one on screen, when it's this machine's. */
  threadId?: string;
  /** Full screen for a handoff (AldoHandoffTakeover.tsx), which says what to do itself. */
  inTakeover?: boolean;
  /** Whether a recording is under way or waiting to be taught: the takeover holds its "I'm done" meanwhile. */
  onTeaching?: (teaching: boolean) => void;
}) {
  const [status, setStatus] = useState<Status>("connecting");
  // Whether what's sent reaches the machine: status stays "live" from a dropped connection until the next try.
  const [connected, setConnected] = useState(false);
  // Whether a picture of the page has been drawn: until then, a connected panel is still starting the browser.
  const [pictured, setPictured] = useState(false);
  const picturedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<ReadonlyArray<Tab>>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [phone, setPhone] = useState(false);
  const [view, setView] = useState<"browser" | "desktop">("browser");
  const [chosenScreen, setChosenScreen] = useState<AldoDesktopScreen>("machine");
  const [nav, setNav] = useState<Nav>({
    url: "",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  });
  const [control, setControl] = useState<Control>({
    human: false,
    explicit: false,
    agentActiveAt: 0,
  });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [loginOffers, setLoginOffers] = useState<ReadonlyArray<AldoLoginOffer>>([]);
  // The user's answers to offers, until the machine drops the offer: sent again after a reconnect.
  const [loginAnswers, setLoginAnswers] = useState<ReadonlyMap<string, boolean>>(new Map());
  const loginAnswersRef = useRef<ReadonlyMap<string, boolean>>(new Map());
  // Saves waiting for an offer's password from the machine.
  const passwordWaits = useRef(new Map<string, (password: string | null) => void>());
  const neverSave = useAldoNeverSaveLogins();
  // "Teach this" (teach.logic.ts): how the recording stands, once the machine says it can record.
  const [teach, setTeach] = useState<AldoTeach | null>(null);
  // Teaching it: what to do with the steps once the machine gives them, even after the form gave up waiting.
  const teachStepsWait = useRef<((steps: string[] | null, id?: string) => void) | null>(null);
  const route = useParams({ strict: false }) as { environmentId?: string; threadId?: string };
  const teachThread = threadId ?? (route.environmentId === environmentId ? route.threadId : null);
  // The conversation a recording started from: its lesson goes there, wherever the user went since.
  const [teachFrom, setTeachFrom] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // When the user last clicked or typed in the page here: agents wait a moment after.
  const [usedAt, setUsedAt] = useState(0);
  const usedAtRef = useRef(0);
  // Connects again now, rather than when the backoff says.
  const retryNow = useRef<() => void>(() => {});
  // The page's size (its CSS pixels) and the frames' width, from the latest picture.
  const [page, setPage] = useState<AldoSize | null>(null);
  const pageRef = useRef<AldoSize | null>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  // The text field with focus in the page, as the machine last reported it (a newer one does).
  const [focus, setFocus] = useState<{ field: AldoField | null; at: number }>({
    field: null,
    at: 0,
  });
  const [reportsFocus, setReportsFocus] = useState<boolean | null>(null);
  // The page over the whole screen (and the browser full screen, where it can be).
  const [full, setFull] = useState(false);
  const compact = useMediaQuery(COMPACT);
  const coarse = useMediaQuery("(pointer: coarse)");
  // Nothing streams while nobody can see it: the Desktop view is up, or the page is hidden.
  const pageVisible = useAldoPageVisible();
  // Nor while a handoff's takeover covers it: that one streams.
  const takenOver = useAldoHandoffTakeover((s) => s.id !== null) && !inTakeover;
  const paused = view === "desktop" || !pageVisible || takenOver;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const socketRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const keysRef = useRef<AldoKeyInputHandle | null>(null);
  // How big the page shows (AldoLivePage), in CSS pixels.
  const shownRef = useRef<AldoSize>({ width: 0, height: 0 });
  const frameSeq = useRef(0);

  const send = useCallback((message: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  /** How big the page shows, in device pixels: frames are never bigger than that. */
  const viewportSize = useCallback(() => {
    const shown = shownRef.current;
    return aldoLiveViewSize(shown.width, shown.height, window.devicePixelRatio);
  }, []);

  const sendViewport = useCallback(() => {
    const size = viewportSize();
    if (size.width > 0 && size.height > 0) send({ type: "viewport", ...size });
  }, [send, viewportSize]);

  // Connection: fetch a signed URL, stream, and reconnect with backoff.
  useEffect(() => {
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopWaiting: (() => void) | null = null;
    let attempt = 0;

    /** Draws a frame unless a newer one has arrived meanwhile. */
    const paint = (
      seq: number,
      image: CanvasImageSource,
      width: number,
      height: number,
      metadata: FrameMeta,
    ) => {
      if (seq !== frameSeq.current) return;
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        setFrameWidth(width);
      }
      context.drawImage(image, 0, 0);
      const shown = pageRef.current;
      if (shown?.width !== metadata.deviceWidth || shown.height !== metadata.deviceHeight) {
        pageRef.current = { width: metadata.deviceWidth, height: metadata.deviceHeight };
        setPage(pageRef.current);
      }
      if (!picturedRef.current) {
        picturedRef.current = true;
        setPictured(true);
        setError(null);
      }
    };

    // An older machine's frames: JSON, base64.
    const draw = (data: string, metadata: FrameMeta) => {
      const seq = ++frameSeq.current;
      const image = new Image();
      image.onload = () => paint(seq, image, image.naturalWidth, image.naturalHeight, metadata);
      image.src = `data:image/jpeg;base64,${data}`;
    };

    // A newer machine's: binary, decoded off the main thread, and acknowledged
    // once drawn, which is when the machine sends the next (it paces the
    // stream to this panel rather than queueing frames on a slow link). Video
    // frames go to the connection's player, which acknowledges them itself.
    const drawBinary = (socket: WebSocket, data: ArrayBuffer, player: AldoVideoPlayer | null) => {
      const frame = parseAldoLiveFrame(data);
      const acknowledge = () => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "frameAck" }));
      };
      if (frame?.kind === ALDO_FRAME_VIDEO) {
        if (player) return player.decode(frame);
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "videoAck" }));
        return;
      }
      if (frame?.kind !== ALDO_FRAME_JPEG) return acknowledge();
      const seq = ++frameSeq.current;
      const metadata = frame.header as unknown as FrameMeta;
      createImageBitmap(new Blob([frame.payload], { type: "image/jpeg" }))
        .then((bitmap) => {
          paint(seq, bitmap, bitmap.width, bitmap.height, metadata);
          bitmap.close();
        })
        .catch(() => {})
        .finally(acknowledge);
    };

    // Between asking for the connection and opening its socket: Try now waits for it.
    let connecting = false;
    const schedule = (delay: number) => {
      if (disposed) return;
      retry = setTimeout(connect, delay);
    };

    const connect = async () => {
      if (disposed) return;
      connecting = true;
      setStatus((current) => (current === "live" ? "connecting" : current));
      let url: string;
      try {
        url = (await aldoBrowserConnection(environmentId)).url;
      } catch (cause) {
        connecting = false;
        if (cause instanceof AldoApiError && cause.status === 409) {
          setStatus("asleep");
          // Listed asleep: again once the directory has it up. Otherwise it's coming up.
          if (aldoMachineIsAsleep(environmentId) && !disposed) {
            stopWaiting = whenAldoMachineUp(environmentId, () => void connect());
          } else {
            schedule(3000);
          }
        } else {
          setStatus("error");
          setError(cause instanceof Error ? cause.message : String(cause));
          schedule(Math.min(15_000, 1000 * 2 ** attempt++));
        }
        return;
      }
      // The page as H.264 video where this browser decodes it (a newer machine sends it).
      const video = await aldoCanDecodeH264();
      connecting = false;
      if (disposed) return;
      const socket = new WebSocket(
        aldoLiveViewUrl(url, { ...viewportSize(), paused: pausedRef.current, video }),
      );
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      const tell = (message: Record<string, unknown>) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
      };
      // Input coordinates are in the page's CSS pixels, which the video's configuration gives.
      let videoMeta: FrameMeta | null = null;
      const player = video
        ? new AldoVideoPlayer(
            (picture) => {
              if (videoMeta) {
                paint(
                  ++frameSeq.current,
                  picture,
                  picture.displayWidth,
                  picture.displayHeight,
                  videoMeta,
                );
              }
            },
            () => tell({ type: "videoAck" }),
            () => tell({ type: "keyframe" }),
          )
        : null;
      socket.onopen = () => {
        attempt = 0;
        setConnected(true);
        setStatus("live");
        setError(null);
        sendViewport();
        // Answers given while the connection was down.
        for (const [id, saved] of loginAnswersRef.current) {
          socket.send(JSON.stringify({ type: "loginOffer", id, saved }));
        }
      };
      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) return drawBinary(socket, event.data, player);
        const message = JSON.parse(String(event.data)) as Record<string, unknown> & {
          type: string;
        };
        switch (message.type) {
          case "frame":
            draw(String(message.data), message.metadata as FrameMeta);
            break;
          case "tabs":
            setTabs(message.tabs as Tab[]);
            setActiveTab((message.active as string | null) ?? null);
            setFollow(Boolean(message.follow));
            break;
          case "nav":
            setNav(message as unknown as Nav);
            break;
          case "control":
            setControl(message as unknown as Control);
            break;
          case "dialog":
            setDialog((message.dialog as Dialog | null) ?? null);
            break;
          case "loginOfferPassword": {
            const wait = passwordWaits.current.get(String(message.id));
            wait?.(
              typeof message.password === "string" && message.password ? message.password : null,
            );
            break;
          }
          case "teach":
            setTeach(parseAldoTeach(message));
            break;
          case "teachSteps":
            teachStepsWait.current?.(
              parseAldoTeachSteps(message.steps),
              typeof message.id === "string" ? message.id : undefined,
            );
            break;
          case "loginOffers": {
            const offers = parseAldoLoginOffers(message.offers);
            loginAnswersRef.current = pendingAldoLoginAnswers(loginAnswersRef.current, offers);
            setLoginAnswers(loginAnswersRef.current);
            setLoginOffers(offers);
            break;
          }
          case "device":
            setPhone(message.mode === "phone");
            break;
          case "focus":
            setReportsFocus(true);
            setFocus({ field: aldoFieldOf(message.field), at: Date.now() });
            break;
          case "video": {
            // The page as video from here on, or (codec null) as JPEG frames again.
            const page = player?.configure(message) ? player.config?.page : null;
            videoMeta = page ? { deviceWidth: page.width, deviceHeight: page.height } : null;
            break;
          }
          case "error":
            setError(String(message.message));
            // Before any picture, the machine has no browser to show (Chrome didn't
            // start): reconnecting tries again, whether or not the machine closes first.
            if (!picturedRef.current) socket.close();
            break;
        }
      };
      socket.onclose = () => {
        player?.close();
        if (socketRef.current === socket) socketRef.current = null;
        if (disposed) return;
        setConnected(false);
        schedule(Math.min(15_000, 1000 * 2 ** attempt++));
      };
    };

    retryNow.current = () => {
      if (disposed || connecting || socketRef.current) return;
      if (retry) clearTimeout(retry);
      stopWaiting?.();
      attempt = 0;
      setStatus((current) => (current === "error" ? "connecting" : current));
      void connect();
    };
    void connect();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      stopWaiting?.();
      socketRef.current?.close();
      socketRef.current = null;
      setConnected(false);
    };
  }, [environmentId, sendViewport, viewportSize]);

  useEffect(() => {
    if (status === "live") send({ type: "pause", paused });
  }, [send, status, paused]);

  // An older machine says nothing of focus: a phone gets a keyboard button instead.
  useEffect(() => {
    if (!connected || reportsFocus !== null) return;
    const timer = setTimeout(() => setReportsFocus((known) => known ?? false), 2500);
    return () => clearTimeout(timer);
  }, [connected, reportsFocus]);

  // Full screen: the browser's own too, where it has one (not iPhone's); leaving it leaves ours.
  useEffect(() => {
    if (!full) return;
    const root = document.documentElement;
    let entered = false;
    if (root.requestFullscreen && !document.fullscreenElement) {
      root.requestFullscreen({ navigationUI: "hide" }).then(
        () => (entered = true),
        () => {},
      );
    }
    const onChange = () => {
      if (entered && !document.fullscreenElement) setFull(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      if (entered && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, [full]);

  // "Your agent is browsing" and "You're using the page" last a few seconds after the last step.
  useEffect(() => {
    const until = Math.max(control.agentActiveAt + AGENT_ACTIVE_MS, usedAt + USE_HOLD_MS);
    if (Date.now() > until) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() > until) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [control.agentActiveAt, usedAt]);

  /** The user used the page: agents wait a moment, and the line under the address says so. */
  const noteUse = () => {
    const at = Date.now();
    if (at - usedAtRef.current < 1000) return;
    usedAtRef.current = at;
    setUsedAt(at);
  };

  // Open requests from the Previews menu.
  const request = useAldoBrowserRequests((state) => state.request);
  useEffect(() => {
    if (!request || request.environmentId !== environmentId || status !== "live") return;
    send({ type: "newTab", url: request.url });
    useAldoBrowserRequests.getState().consume(request.id);
  }, [environmentId, request, send, status]);

  const shownUrl = tabs.find((tab) => tab.id === activeTab)?.url ?? nav.url;

  /** With a mouse, keys go to the page from here on; a phone's keyboard opens only for a field. */
  const focusKeyboard = () => {
    if (!coarse) keysRef.current?.focus(aldoKeyboardFor(null));
  };

  const navigate = (address: string) => {
    send({ type: "navigate", url: address });
    focusKeyboard();
  };

  const environments = useSyncExternalStore(
    subscribeAldoEnvironments,
    getAldoEnvironments,
    () => null,
  );
  const environment = environments?.find((e) => e.environmentId === environmentId);
  // The Desktop view offers the Windows computer's screen while it runs.
  const { computer, stopping: stoppingComputer } = useAldoComputer(environmentId, "windows");
  const windowsRunning = computer?.kind === "windows" && computer.status === "running";
  const screen = aldoDesktopScreen(chosenScreen, computer);
  useEffect(() => {
    // Back to this machine's screen once it stops, and not straight to Windows when it next runs.
    if (!windowsRunning) setChosenScreen("machine");
  }, [windowsRunning]);
  const loginOffer = nextAldoLoginOffer(loginOffers, neverSave.origins, loginAnswers);
  /** An offer's password: the machine sends it only when asked, once the user chose Save. */
  const loginOfferPassword = (id: string) =>
    new Promise<string>((resolve, reject) => {
      const unreachable = "Couldn't reach its computer's browser. Try again in a moment.";
      const finish = (password: string | null, failure?: string) => {
        clearTimeout(timer);
        passwordWaits.current.delete(id);
        if (password) resolve(password);
        else
          reject(
            new Error(
              failure ?? "This sign-in isn't on offer anymore. Sign in again to be asked again.",
            ),
          );
      };
      const timer = setTimeout(() => finish(null, unreachable), 15_000);
      passwordWaits.current.set(id, finish);
      if (socketRef.current?.readyState === WebSocket.OPEN)
        send({ type: "loginOfferPassword", id });
      else finish(null, unreachable);
    });
  /** Hides the offer at once; the machine drops it (on every device) once it has the answer. */
  const answerLoginOffer = (id: string, saved: boolean) => {
    loginAnswersRef.current = new Map(loginAnswersRef.current).set(id, saved);
    setLoginAnswers(loginAnswersRef.current);
    send({ type: "loginOffer", id, saved });
  };

  const canTeach = teach?.state === "off" && Boolean(teachThread) && connected;
  const teaching = teach?.state === "recording" || teach?.state === "recorded";
  useEffect(() => onTeaching?.(teaching), [onTeaching, teaching]);
  useEffect(() => {
    if (!teaching) setTeachFrom(null);
  }, [teaching]);
  // One started elsewhere (another panel, another device) goes to the conversation on screen.
  const lessonThread = (teaching && teachFrom) || teachThread;
  /** It records the browser, so that's what shows, not the Desktop's apps. */
  const startTeaching = () => {
    setView("browser");
    setTeachFrom(teachThread ?? null);
    send({ type: "teach", action: "start" });
  };
  /**
   * Puts the lesson in the conversation's message box, for the user to read
   * over and send. The machine gives the steps to this panel: steps that come
   * after the form gave up waiting still go in, and only once they're in (kept
   * on this device) is the machine told it may forget them (an older machine
   * forgot them as it gave them).
   */
  const teachIt = (sentence: string) =>
    new Promise<void>((resolve, reject) => {
      if (!lessonThread) return reject(new Error("Open the conversation to teach its agent."));
      const unreachable = new Error(
        "Couldn't reach its computer's browser. Try again in a moment.",
      );
      if (socketRef.current?.readyState !== WebSocket.OPEN) return reject(unreachable);
      const target = scopeThreadRef(environmentId as EnvironmentId, lessonThread as ThreadId);
      const timer = setTimeout(() => reject(unreachable), 15_000);
      teachStepsWait.current = (steps, id) => {
        clearTimeout(timer);
        teachStepsWait.current = null;
        if (!steps) {
          return reject(new Error("That recording is gone from its computer. Teach this again."));
        }
        useComposerDraftStore
          .getState()
          .setPrompt(
            target,
            promptWith(readComposerThreadPrompt(target), aldoTeachMessage(sentence, steps)),
          );
        // Those steps, by their id, may go now; a machine that forgot them as it gave them ignores this.
        send({ type: "teach", action: "taken", ...(id ? { id } : {}) });
        toastManager.add({
          type: "success",
          title: "Your lesson is in the message box",
          description: inTakeover
            ? "Send it to your agent once you're done here."
            : "Read it over, then send it to your agent.",
          timeout: 8000,
        });
        if (!inTakeover) {
          window.setTimeout(
            () => document.querySelector<HTMLElement>('[data-testid="composer-editor"]')?.focus(),
            50,
          );
        }
        resolve();
      };
      send({ type: "teach", action: "take" });
    });
  const discardTeaching = () => {
    teachStepsWait.current = null;
    send({ type: "teach", action: "discard" });
  };

  const agentActive = now - control.agentActiveAt < AGENT_ACTIVE_MS && !control.human;
  const port = localPort(shownUrl);
  const openExternally = () => {
    const target = port ? aldoPreviewUrl(environmentId, port) : shownUrl;
    if (target) window.open(target, "_blank", "noopener");
  };
  // An agent waiting on the user here; full screen, the takeover says what to do itself.
  const home = useAldoHomeFeed((s) => s.home);
  const handoff = inTakeover ? null : aldoHandoffOn(home, environmentId);
  const state = aldoBrowserState({
    recording: teach?.state === "recording",
    handoff: handoff !== null,
    explicit: control.explicit,
    agentActive,
    using: now - usedAt < USE_HOLD_MS,
  });
  const onWindows = view === "desktop" && screen === "windows";
  // What the user has to act on (Stop, I'm done, Hand back) shows wherever they are, picture
  // or not. Who's browsing, once there's a page to share or the desktop; agents don't use the
  // Windows computer. Full screen, the takeover says the rest itself.
  const actionable = state === "recording" || state === "handoff" || state === "yours";
  const showStatus = inTakeover
    ? state === "recording" || state === "yours"
    : actionable || ((pictured || view === "desktop") && !onWindows);
  const blank =
    view === "browser" && status === "live" && pictured && !dialog && aldoBlankPage(shownUrl);
  // Full screen, who's browsing gives way to the page; what the user has to act on stays.
  const statusShown = showStatus && (!full || actionable);
  const density = compact ? "touch" : "default";
  const exitFull = full ? (
    <NavButton
      label="Exit full screen"
      size={compact ? "icon-xl" : "icon-xs"}
      onClick={() => setFull(false)}
    >
      <Minimize2Icon />
    </NavButton>
  ) : null;

  const more = (
    <Menu>
      <MenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size={compact ? "icon-xl" : "icon-xs"}
            aria-label="More"
          />
        }
      >
        <EllipsisIcon />
      </MenuTrigger>
      <MenuPopup align="end" className="min-w-64">
        {compact ? (
          // One row on a phone: the rest of a browser's controls are here.
          <>
            <MenuItem
              density={density}
              disabled={!nav.canGoForward}
              onClick={() => send({ type: "forward" })}
            >
              <ArrowRightIcon className="size-3.5" /> Forward
            </MenuItem>
            <MenuItem
              density={density}
              onClick={() => send({ type: nav.loading ? "stop" : "reload" })}
            >
              {nav.loading ? <XIcon className="size-3.5" /> : <RotateCwIcon className="size-3.5" />}
              {nav.loading ? "Stop loading" : "Reload"}
            </MenuItem>
            <MenuItem
              density={density}
              disabled={!connected}
              onClick={() => send({ type: "newTab" })}
            >
              <PlusIcon className="size-3.5" /> New tab
            </MenuItem>
            <MenuItem density={density} onClick={() => setView("desktop")}>
              <MonitorIcon className="size-3.5" />
              <MenuLines label="Desktop view" hint="Its whole screen, with desktop apps" />
            </MenuItem>
            <MenuSeparator />
          </>
        ) : null}
        <MenuItem
          density={density}
          onClick={openExternally}
          disabled={!shownUrl || aldoBlankPage(shownUrl) || shownUrl.startsWith("chrome://")}
        >
          <ExternalLinkIcon className="size-3.5" />
          {port ? "Open this preview in a new tab" : "Open in a new tab"}
        </MenuItem>
        {inTakeover ? null : (
          <MenuItem density={density} onClick={() => setFull(!full)}>
            {full ? <Minimize2Icon className="size-3.5" /> : <Maximize2Icon className="size-3.5" />}
            {full ? "Exit full screen" : "Full screen"}
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuCheckboxItem
          checked={phone}
          onCheckedChange={(checked) =>
            send({ type: "device", mode: checked ? "phone" : "desktop" })
          }
        >
          <MenuLines label="Phone view" hint="The page at a phone's size, with touch" />
        </MenuCheckboxItem>
        <MenuCheckboxItem
          checked={follow}
          onCheckedChange={(checked) => send({ type: "follow", enabled: checked })}
        >
          <MenuLines label="Follow the agent's tab" hint="Show whichever tab it's using" />
        </MenuCheckboxItem>
        {canTeach && !inTakeover ? (
          <>
            <MenuSeparator />
            <MenuItem density={density} onClick={startTeaching}>
              <GraduationCapIcon className="size-3.5" />
              <MenuLines
                label="Teach this"
                hint="Do a task while it records, for your agent to learn"
              />
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );

  return (
    <div
      className={cn(
        "@container flex min-h-0 flex-1 flex-col bg-background",
        full && "fixed inset-0 z-50 pt-safe pb-safe",
      )}
    >
      {view === "browser" ? (
        compact ? null : (
          <AldoBrowserTabs
            tabs={tabs}
            active={activeTab}
            loading={nav.loading}
            onActivate={(tabId) => send({ type: "activate", tabId })}
            onClose={(tabId) => send({ type: "closeTab", tabId })}
            onNew={() => send({ type: "newTab" })}
            connected={connected}
          >
            <AldoBrowserViewSwitch view={view} onChange={setView} />
          </AldoBrowserTabs>
        )
      ) : (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 bg-muted/60 px-1.5 dark:bg-white/[0.03] pointer-coarse:h-12">
          {windowsRunning ? (
            <AldoDesktopScreenSwitch
              screen={screen}
              onChange={setChosenScreen}
              stopping={stoppingComputer}
              onStop={() =>
                void stopAldoThreadComputer(environmentId, "windows").then((stopped) => {
                  if (stopped) setChosenScreen("machine");
                })
              }
            />
          ) : null}
          <span className="min-w-0 flex-1 truncate px-1 text-xs text-muted-foreground">
            {screen === "windows"
              ? "Your Windows computer, with desktop Office. Sign in to Office here once."
              : "The agent's whole desktop: Chrome, desktop apps and the taskbar."}
          </span>
          {exitFull}
          <AldoBrowserViewSwitch view={view} onChange={setView} />
        </div>
      )}

      {view === "browser" ? (
        <div className="relative flex h-10 shrink-0 items-center gap-1 border-b border-border/60 bg-background px-1.5 pointer-coarse:h-12">
          {compact ? (
            <NavButton
              label="Back"
              size="icon-xl"
              disabled={!nav.canGoBack}
              onClick={() => send({ type: "back" })}
            >
              <ArrowLeftIcon />
            </NavButton>
          ) : (
            <div
              className="flex shrink-0 items-center gap-0.5"
              role="group"
              aria-label="Navigation"
            >
              <NavButton
                label="Back"
                disabled={!nav.canGoBack}
                onClick={() => send({ type: "back" })}
              >
                <ArrowLeftIcon />
              </NavButton>
              <NavButton
                label="Forward"
                disabled={!nav.canGoForward}
                onClick={() => send({ type: "forward" })}
              >
                <ArrowRightIcon />
              </NavButton>
              <NavButton
                label={nav.loading ? "Stop loading" : "Reload"}
                onClick={() => send({ type: nav.loading ? "stop" : "reload" })}
              >
                {nav.loading ? <XIcon /> : <RotateCwIcon />}
              </NavButton>
            </div>
          )}
          <AldoAddressBar url={shownUrl} onSubmit={navigate} />
          {inTakeover && canTeach ? (
            <Button type="button" size="compact" variant="outline" onClick={startTeaching}>
              <GraduationCapIcon /> Teach this
            </Button>
          ) : null}
          {compact && tabs.length > 1 ? (
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xl"
                    aria-label={`Tabs: ${tabs.length} open`}
                  />
                }
              >
                <span className="flex size-[18px] items-center justify-center rounded-[4px] border-[1.5px] border-current font-semibold text-[10px] tabular-nums">
                  {tabs.length}
                </span>
              </MenuTrigger>
              <MenuPopup align="end" className="w-72 max-w-[calc(100vw-1.5rem)]">
                <MenuRadioGroup
                  value={activeTab ?? ""}
                  onValueChange={(tabId) => send({ type: "activate", tabId })}
                >
                  {tabs.map((tab) => (
                    <MenuRadioItem key={tab.id} value={tab.id} className="min-h-10 sm:min-h-10">
                      <span className="block truncate">{aldoTabTitle(tab)}</span>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
                <MenuSeparator />
                <MenuItem
                  density="touch"
                  disabled={!activeTab}
                  onClick={() => activeTab && send({ type: "closeTab", tabId: activeTab })}
                >
                  <XIcon className="size-3.5" /> Close this tab
                </MenuItem>
              </MenuPopup>
            </Menu>
          ) : null}
          {exitFull}
          {more}
          <div
            aria-hidden
            data-loading={nav.loading}
            className="preview-loading-progress pointer-events-none absolute bottom-0 left-0 z-10 h-0.5 w-full origin-left rounded-r-full bg-primary"
          />
        </div>
      ) : null}

      {statusShown ? (
        <AldoBrowserStatus
          state={state}
          surface={view}
          teach={teach}
          handoff={handoff}
          teaching={teaching}
          connected={connected}
          onTake={() => send({ type: "control", take: true })}
          onHandBack={() => send({ type: "control", take: false })}
          onStopRecording={() => send({ type: "teach", action: "stop" })}
        />
      ) : null}

      {teach?.state === "recorded" ? (
        // Over the top of the page, until it's taught or discarded (on any device).
        <div className="relative z-20 h-0 shrink-0">
          <div className="absolute top-3 left-1/2 w-[min(26rem,calc(100%-1.5rem))] -translate-x-1/2">
            <AldoTeachForm
              teach={teach}
              connected={connected}
              onTeach={teachIt}
              onDiscard={discardTeaching}
            />
          </div>
        </div>
      ) : loginOffer ? (
        // Over the top corner of the page or the desktop, which stay usable around it.
        <div className="relative z-20 h-0 shrink-0">
          <div className="absolute top-3 right-3 w-[min(22rem,calc(100%-1.5rem))]">
            <AldoLoginOfferCard
              key={loginOffer.id}
              offer={loginOffer}
              repos={environment ? (environment.repos ?? [environment.repo]) : []}
              password={() => loginOfferPassword(loginOffer.id)}
              onDone={(saved) => answerLoginOffer(loginOffer.id, saved)}
              onNever={() => {
                void neverSaveLoginsFor(loginOffer.origin);
                answerLoginOffer(loginOffer.id, false);
              }}
            />
          </div>
        </div>
      ) : null}

      {view === "desktop" ? (
        <AldoDesktopView
          environmentId={environmentId}
          screen={screen}
          onUse={screen === "machine" ? noteUse : undefined}
        />
      ) : null}
      <AldoLivePage
        canvasRef={canvasRef}
        keysRef={keysRef}
        page={page}
        frameWidth={frameWidth}
        phone={phone}
        live={status === "live"}
        pictured={pictured}
        canType={connected && pictured && view === "browser"}
        hidden={view === "desktop"}
        field={focus.field}
        fieldAt={focus.at}
        reportsFocus={reportsFocus}
        send={send}
        onUse={noteUse}
        onShownSize={(size) => {
          shownRef.current = size;
          sendViewport();
        }}
        onPhoneView={() => send({ type: "device", mode: "phone" })}
      >
        {blank ? <AldoBrowserStart environmentId={environmentId} onOpen={navigate} /> : null}
        {status !== "live" || !pictured ? (
          <AldoScreenState
            status={
              status === "error" || (status === "live" && error)
                ? "error"
                : status === "live"
                  ? "starting"
                  : status
            }
            environmentId={environmentId}
            what="the browser"
            error={error}
            over={pictured}
            onRetry={() => retryNow.current()}
          />
        ) : null}
        {dialog ? (
          <DialogPrompt
            dialog={dialog}
            from={aldoDialogFrom(shownUrl)}
            onAnswer={(accept, promptText) => send({ type: "dialog", accept, promptText })}
          />
        ) : null}
      </AldoLivePage>
    </div>
  );
}

/** Back, Forward and Reload: an icon, named in a tooltip. */
function NavButton(props: {
  label: string;
  disabled?: boolean;
  /** Bigger for a finger, on a phone. */
  size?: "icon-xs" | "icon-xl";
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size={props.size ?? "icon-xs"}
            aria-label={props.label}
            disabled={props.disabled}
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}

/** A menu item's name and, under it, what it does. */
function MenuLines(props: { label: string; hint: string }) {
  return (
    <span className="flex min-w-0 flex-col py-0.5">
      <span>{props.label}</span>
      <span className="text-muted-foreground text-xs">{props.hint}</span>
    </span>
  );
}

/** A page's alert, confirm or prompt, as Chrome asks it: "airbnb.com says". */
function DialogPrompt(props: {
  dialog: Dialog;
  from: string;
  onAnswer: (accept: boolean, promptText?: string) => void;
}) {
  const [text, setText] = useState(props.dialog.defaultPrompt ?? "");
  const cancellable = props.dialog.type !== "alert";
  return (
    <div className="absolute inset-0 z-10 flex items-start justify-center bg-black/25 p-4 pt-[min(12%,5rem)] dark:bg-black/45">
      <form
        role="alertdialog"
        aria-label={props.from}
        className="w-full max-w-sm rounded-2xl border border-border/70 bg-popover p-4 text-popover-foreground shadow-xl"
        onSubmit={(e) => {
          e.preventDefault();
          props.onAnswer(true, text);
        }}
      >
        <p className="font-medium text-[13px] text-foreground">{props.from}</p>
        <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-5 text-foreground/80">
          {props.dialog.message}
        </p>
        {props.dialog.type === "prompt" ? (
          <Input
            className="mt-3"
            autoFocus
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
          />
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          {cancellable ? (
            <Button type="button" variant="outline" size="sm" onClick={() => props.onAnswer(false)}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" size="sm" autoFocus={props.dialog.type !== "prompt"}>
            OK
          </Button>
        </div>
      </form>
    </div>
  );
}
