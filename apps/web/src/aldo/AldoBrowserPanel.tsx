import {
  ArrowLeftIcon,
  ArrowRightIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  GraduationCapIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent as ReactClipboardEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
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
  MenuSeparator,
  MenuTrigger,
} from "../components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { toastManager } from "../components/ui/toast";
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
import { AldoLoginOfferCard } from "./AldoLoginOfferCard";
import { AldoTeachForm } from "./AldoTeach";
import { aldoBlankPage, aldoBrowserState, aldoDialogFrom } from "./browserChrome.logic";
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

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
// How long the agent counts as browsing after its last step: long enough to
// span the pause while it thinks, so the line under the address holds still.
const AGENT_ACTIVE_MS = 15_000;
// How long agents wait after the user's last click or key (the machine's INPUT_HOLD_MS).
const USE_HOLD_MS = 10_000;

function modifiers(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
  let bits = (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
  // The remote Chrome runs on Linux: ⌘ shortcuts become Ctrl ones there.
  if (isMac && e.metaKey) bits = (bits & ~4) | 2;
  return bits;
}

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
  const [focused, setFocused] = useState(false);
  // Nothing streams while nobody can see it: the Desktop view is up, or the page is hidden.
  const pageVisible = useAldoPageVisible();
  // Nor while a handoff's takeover covers it: that one streams.
  const takenOver = useAldoHandoffTakeover((s) => s.id !== null) && !inTakeover;
  const paused = view === "desktop" || !pageVisible || takenOver;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const socketRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const keyboardRef = useRef<HTMLTextAreaElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const metaRef = useRef<FrameMeta | null>(null);
  const frameSeq = useRef(0);
  const touchRef = useRef<{ x: number; y: number; lastY: number; scrolled: boolean } | null>(null);
  const moveQueued = useRef<{ x: number; y: number; buttons: number; mods: number } | null>(null);

  const send = useCallback((message: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  /** The page area's size in device pixels: frames are never bigger than it shows them. */
  const viewportSize = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return { width: 0, height: 0 };
    return aldoLiveViewSize(stage.clientWidth, stage.clientHeight, window.devicePixelRatio);
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
      }
      context.drawImage(image, 0, 0);
      metaRef.current = metadata;
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

  // Keep the stream sized to the panel (sharp frames without wasting bandwidth),
  // once a resize settles: each new size restarts the stream with a whole frame.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(sendViewport, 150);
    });
    observer.observe(stage);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [sendViewport]);

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

  /** Where a pointer event lands on the page, in CSS pixels. */
  const pagePoint = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const meta = metaRef.current;
    if (!canvas || !meta || canvas.width === 0) return null;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
    const drawnWidth = canvas.width * scale;
    const drawnHeight = canvas.height * scale;
    const offsetX = (rect.width - drawnWidth) / 2;
    const offsetY = (rect.height - drawnHeight) / 2;
    const x = ((clientX - rect.left - offsetX) / drawnWidth) * meta.deviceWidth;
    const y = ((clientY - rect.top - offsetY) / drawnHeight) * meta.deviceHeight;
    if (x < 0 || y < 0 || x > meta.deviceWidth || y > meta.deviceHeight) return null;
    return { x, y };
  };

  const flushMove = () => {
    const move = moveQueued.current;
    moveQueued.current = null;
    if (!move) return;
    send({
      type: "mouse",
      event: "mouseMoved",
      x: move.x,
      y: move.y,
      button: move.buttons & 1 ? "left" : "none",
      buttons: move.buttons,
      modifiers: move.mods,
    });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    focusKeyboard();
    const point = pagePoint(e.clientX, e.clientY);
    if (!point) return;
    e.preventDefault();
    noteUse();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.pointerType === "touch" && !phone) {
      touchRef.current = { x: point.x, y: point.y, lastY: e.clientY, scrolled: false };
      return;
    }
    send({
      type: "mouse",
      event: "mousePressed",
      ...point,
      button: (["left", "middle", "right"] as const)[e.button] ?? "none",
      buttons: e.buttons,
      clickCount: e.detail || 1,
      modifiers: modifiers(e),
    });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const touch = touchRef.current;
    if (e.pointerType === "touch" && touch && !phone) {
      const dy = touch.lastY - e.clientY;
      if (Math.abs(e.clientY - touch.lastY) > 2) {
        touch.scrolled = true;
        touch.lastY = e.clientY;
        send({ type: "wheel", x: touch.x, y: touch.y, deltaX: 0, deltaY: dy * 2 });
      }
      return;
    }
    const point = pagePoint(e.clientX, e.clientY);
    if (!point) return;
    const pending = moveQueued.current;
    moveQueued.current = { ...point, buttons: e.buttons, mods: modifiers(e) };
    if (!pending) requestAnimationFrame(flushMove);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const touch = touchRef.current;
    if (e.pointerType === "touch" && !phone) {
      touchRef.current = null;
      if (touch && !touch.scrolled) {
        const tap = { x: touch.x, y: touch.y, button: "left", clickCount: 1, modifiers: 0 };
        send({ type: "mouse", event: "mousePressed", buttons: 1, ...tap });
        send({ type: "mouse", event: "mouseReleased", buttons: 0, ...tap });
      }
      return;
    }
    const point = pagePoint(e.clientX, e.clientY);
    if (!point) return;
    send({
      type: "mouse",
      event: "mouseReleased",
      ...point,
      button: (["left", "middle", "right"] as const)[e.button] ?? "none",
      buttons: e.buttons,
      clickCount: e.detail || 1,
      modifiers: modifiers(e),
    });
  };

  // Wheel needs a non-passive listener to stop the panel scrolling instead.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      const point = pagePoint(e.clientX, e.clientY);
      if (!point) return;
      e.preventDefault();
      noteUse();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
      send({
        type: "wheel",
        ...point,
        deltaX: e.deltaX * unit,
        deltaY: e.deltaY * unit,
        modifiers: modifiers(e),
      });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
    // pagePoint and noteUse read refs only.
  }, [send]);

  // Keyboard input goes through a hidden textarea: real keys are sent as key
  // events (pages see keydown/keyup), while text that arrives without them
  // (phone keyboards, IME composition, paste, dictation) is inserted as text.
  const onKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>, event: "down" | "up") => {
    if (e.nativeEvent.isComposing || e.key === "Process" || e.key === "Unidentified") return;
    if (event === "down") noteUse();
    // Let the browser fire `paste` so the user's own clipboard is what's pasted.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") return;
    e.preventDefault();
    const text = e.key === "Enter" ? "\r" : e.key.length === 1 ? e.key : "";
    send({
      type: "key",
      event,
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      text,
      modifiers: modifiers(e),
    });
  };

  const onPaste = (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    send({ type: "text", text });
  };

  const onInput = (e: FormEvent<HTMLTextAreaElement>) => {
    const native = e.nativeEvent as InputEvent;
    const target = e.currentTarget;
    if (native.isComposing) return;
    if (native.inputType === "deleteContentBackward") {
      for (const event of ["down", "up"]) {
        send({
          type: "key",
          event,
          key: "Backspace",
          code: "Backspace",
          keyCode: 8,
          text: "",
          modifiers: 0,
        });
      }
    } else if (target.value) {
      send({ type: "text", text: target.value });
    }
    target.value = "";
  };

  const focusKeyboard = () => keyboardRef.current?.focus({ preventScroll: true });

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

  return (
    <div className="@container flex min-h-0 flex-1 flex-col bg-background">
      {view === "browser" ? (
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
      ) : (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 bg-muted/60 px-1.5 dark:bg-white/[0.03]">
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
          <AldoBrowserViewSwitch view={view} onChange={setView} />
        </div>
      )}

      {view === "browser" ? (
        <div className="relative flex h-10 shrink-0 items-center gap-1 border-b border-border/60 bg-background px-1.5 pointer-coarse:h-12">
          <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="Navigation">
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
          <AldoAddressBar url={shownUrl} onSubmit={navigate} />
          {inTakeover && canTeach ? (
            <Button type="button" size="compact" variant="outline" onClick={startTeaching}>
              <GraduationCapIcon /> Teach this
            </Button>
          ) : null}
          <Menu>
            <MenuTrigger
              render={<Button type="button" variant="ghost" size="icon-xs" aria-label="More" />}
            >
              <EllipsisIcon />
            </MenuTrigger>
            <MenuPopup align="end" className="min-w-64">
              <MenuItem
                onClick={openExternally}
                disabled={!shownUrl || aldoBlankPage(shownUrl) || shownUrl.startsWith("chrome://")}
              >
                <ExternalLinkIcon className="size-3.5" />
                {port ? "Open this preview in a new tab" : "Open in a new tab"}
              </MenuItem>
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
                  <MenuItem onClick={startTeaching}>
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
          <div
            aria-hidden
            data-loading={nav.loading}
            className="preview-loading-progress pointer-events-none absolute bottom-0 left-0 z-10 h-0.5 w-full origin-left rounded-r-full bg-primary"
          />
        </div>
      ) : null}

      {showStatus ? (
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
      <div
        ref={stageRef}
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden bg-muted/50 dark:bg-black/25",
          view === "desktop" && "hidden",
        )}
      >
        <canvas
          ref={canvasRef}
          aria-label="Shared browser. Click to interact."
          className={cn(
            // The page at the top, as a browser shows one, as big as fits (never past its own
            // size, which is the panel's: aldoLiveViewSize), centered across when it's narrower.
            "absolute inset-x-0 top-0 mx-auto block max-h-full max-w-full touch-none bg-background shadow-[0_1px_0_0_var(--color-border),0_8px_24px_-12px_rgb(0_0_0/0.18)] outline-none transition-opacity",
            status !== "live" && "opacity-40",
            !pictured && "invisible",
            focused && "outline-2 -outline-offset-2 outline-ring/50",
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
        />
        <textarea
          ref={keyboardRef}
          aria-label="Type into the shared browser"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          className="pointer-events-none absolute bottom-0 left-0 size-px resize-none opacity-0"
          onKeyDown={(e) => onKey(e, "down")}
          onKeyUp={(e) => onKey(e, "up")}
          onPaste={onPaste}
          onInput={onInput}
          onCompositionEnd={(e) => {
            if (e.data) send({ type: "text", text: e.data });
            e.currentTarget.value = "";
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
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
      </div>
    </div>
  );
}

/** Back, Forward and Reload: an icon, named in a tooltip. */
function NavButton(props: {
  label: string;
  disabled?: boolean;
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
            size="icon-xs"
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
