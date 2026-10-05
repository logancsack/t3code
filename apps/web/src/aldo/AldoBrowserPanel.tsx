import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BotIcon,
  ChevronDownIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  GlobeIcon,
  HandIcon,
  LoaderIcon,
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
  type ClipboardEvent as ReactClipboardEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

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
import { cn } from "../lib/utils";
import { useAldoBrowserRequests } from "./browserStore";
import { stopAldoThreadComputer, useAldoComputer } from "./AldoComputer";
import { AldoDesktopScreenSwitch, AldoDesktopView } from "./AldoDesktopView";
import { AldoLoginOfferCard } from "./AldoLoginOfferCard";
import {
  AldoApiError,
  aldoBrowserConnection,
  aldoPreviewUrl,
  aldoOfflineMessage,
  getAldoEnvironments,
  subscribeAldoEnvironments,
} from "./cloud";
import { aldoDesktopScreen, type AldoDesktopScreen } from "./computer.logic";
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

type Tab = { id: string; url: string; title: string };
type Nav = { url: string; canGoBack: boolean; canGoForward: boolean; loading: boolean };
type Control = { human: boolean; explicit: boolean; agentActiveAt: number };
type Dialog = { message: string; type: string; defaultPrompt?: string };
type FrameMeta = { deviceWidth: number; deviceHeight: number };
type Status = "connecting" | "live" | "asleep" | "error";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const AGENT_ACTIVE_MS = 4000;

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
export function AldoBrowserPanel({ environmentId }: { environmentId: string }) {
  const [status, setStatus] = useState<Status>("connecting");
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
  const [address, setAddress] = useState("");
  const [editingAddress, setEditingAddress] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [focused, setFocused] = useState(false);
  // Nothing streams while nobody can see it: the Desktop view is up, or the page is hidden.
  const pageVisible = useAldoPageVisible();
  const paused = view === "desktop" || !pageVisible;
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
    // stream to this panel rather than queueing frames on a slow link).
    const drawBinary = (socket: WebSocket, data: ArrayBuffer) => {
      const frame = parseAldoLiveFrame(data);
      const acknowledge = () => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "frameAck" }));
      };
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

    const schedule = (delay: number) => {
      if (disposed) return;
      retry = setTimeout(connect, delay);
    };

    const connect = async () => {
      if (disposed) return;
      setStatus((current) => (current === "live" ? "connecting" : current));
      let url: string;
      try {
        url = (await aldoBrowserConnection(environmentId)).url;
      } catch (cause) {
        if (cause instanceof AldoApiError && cause.status === 409) {
          setStatus("asleep");
          schedule(3000);
        } else {
          setStatus("error");
          setError(cause instanceof Error ? cause.message : String(cause));
          schedule(Math.min(15_000, 1000 * 2 ** attempt++));
        }
        return;
      }
      if (disposed) return;
      const socket = new WebSocket(
        aldoLiveViewUrl(url, { ...viewportSize(), paused: pausedRef.current }),
      );
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      socket.onopen = () => {
        attempt = 0;
        setStatus("live");
        setError(null);
        sendViewport();
        // Answers given while the connection was down.
        for (const [id, saved] of loginAnswersRef.current) {
          socket.send(JSON.stringify({ type: "loginOffer", id, saved }));
        }
      };
      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) return drawBinary(socket, event.data);
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
          case "error":
            setError(String(message.message));
            break;
        }
      };
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        if (!disposed) schedule(Math.min(15_000, 1000 * 2 ** attempt++));
      };
    };

    void connect();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      socketRef.current?.close();
      socketRef.current = null;
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

  // "Agent is using the browser" fades after a few seconds without agent input.
  useEffect(() => {
    if (Date.now() - control.agentActiveAt > AGENT_ACTIVE_MS) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [control.agentActiveAt]);

  // Open requests from the Previews menu.
  const request = useAldoBrowserRequests((state) => state.request);
  useEffect(() => {
    if (!request || request.environmentId !== environmentId || status !== "live") return;
    send({ type: "newTab", url: request.url });
    useAldoBrowserRequests.getState().consume(request.id);
  }, [environmentId, request, send, status]);

  const shownUrl = tabs.find((tab) => tab.id === activeTab)?.url ?? nav.url;
  useEffect(() => {
    if (!editingAddress) {
      setAddress(shownUrl === "about:blank" || shownUrl.startsWith("chrome://") ? "" : shownUrl);
    }
  }, [shownUrl, editingAddress]);

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
    // pagePoint reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send]);

  // Keyboard input goes through a hidden textarea: real keys are sent as key
  // events (pages see keydown/keyup), while text that arrives without them
  // (phone keyboards, IME composition, paste, dictation) is inserted as text.
  const onKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>, event: "down" | "up") => {
    if (e.nativeEvent.isComposing || e.key === "Process" || e.key === "Unidentified") return;
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

  const submitAddress = (e: FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return;
    send({ type: "navigate", url: address.trim() });
    setEditingAddress(false);
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
      const unreachable = "Couldn't reach the cloud agent's browser. Try again in a moment.";
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

  const active = tabs.find((tab) => tab.id === activeTab) ?? null;
  const agentActive = now - control.agentActiveAt < AGENT_ACTIVE_MS && !control.human;
  const port = localPort(shownUrl);
  const openExternally = () => {
    const target = port ? aldoPreviewUrl(environmentId, port) : shownUrl;
    if (target) window.open(target, "_blank", "noopener");
  };

  return (
    <div className="@container flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-1.5 py-1">
        <div
          className="flex shrink-0 items-center rounded-md bg-muted/60 p-0.5"
          role="tablist"
          aria-label="View"
        >
          {(
            [
              ["browser", GlobeIcon, "Browser"],
              ["desktop", MonitorIcon, "Desktop"],
            ] as const
          ).map(([value, Icon, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              aria-label={label}
              onClick={() => setView(value)}
              className={cn(
                "inline-flex h-6 items-center gap-1 rounded px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
                view === value
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              <span className="hidden @lg:inline">{label}</span>
            </button>
          ))}
        </div>
        {view === "desktop" && windowsRunning ? (
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
        {view === "desktop" ? (
          <span className="min-w-0 flex-1 truncate px-1 text-xs text-muted-foreground">
            {screen === "windows"
              ? "Your Windows computer, with desktop Office. Sign in to Office here once."
              : "The agent's whole desktop: Chrome, desktop apps and the taskbar."}
          </span>
        ) : null}
        <div className={cn("contents", view === "desktop" && "hidden")}>
          <Menu>
            <MenuTrigger
              aria-label="Browser tabs"
              className="inline-flex h-7 max-w-36 min-w-0 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <GlobeIcon className="size-3.5 shrink-0" />
              <span className="truncate">{active?.title || "New tab"}</span>
              {tabs.length > 1 ? (
                <span className="shrink-0 tabular-nums opacity-70">{tabs.length}</span>
              ) : null}
              <ChevronDownIcon className="size-3 shrink-0 opacity-70" />
            </MenuTrigger>
            <MenuPopup align="start" className="max-w-80 min-w-56">
              {tabs.map((tab) => (
                <MenuItem key={tab.id} onClick={() => send({ type: "activate", tabId: tab.id })}>
                  <span
                    className={cn("min-w-0 flex-1 truncate", tab.id === activeTab && "font-medium")}
                  >
                    {tab.title || tab.url || "New tab"}
                  </span>
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem onClick={() => send({ type: "newTab" })}>
                <PlusIcon className="size-3.5" /> New tab
              </MenuItem>
              {active ? (
                <MenuItem onClick={() => send({ type: "closeTab", tabId: active.id })}>
                  <XIcon className="size-3.5" /> Close this tab
                </MenuItem>
              ) : null}
            </MenuPopup>
          </Menu>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Back"
            disabled={!nav.canGoBack}
            onClick={() => send({ type: "back" })}
          >
            <ArrowLeftIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Forward"
            disabled={!nav.canGoForward}
            onClick={() => send({ type: "forward" })}
          >
            <ArrowRightIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={nav.loading ? "Stop loading" : "Reload"}
            onClick={() => send({ type: nav.loading ? "stop" : "reload" })}
          >
            {nav.loading ? <XIcon /> : <RotateCwIcon />}
          </Button>
          <form
            className="order-last min-w-0 basis-full @md:order-none @md:flex-1 @md:basis-auto"
            onSubmit={submitAddress}
          >
            <Input
              size="compact"
              aria-label="Address"
              placeholder="Search or enter an address, e.g. localhost:3000"
              value={address}
              onFocus={(e) => {
                setEditingAddress(true);
                e.currentTarget.select();
              }}
              onBlur={() => setEditingAddress(false)}
              onChange={(e) => setAddress(e.currentTarget.value)}
              className="text-xs"
            />
          </form>
        </div>
        <Button
          type="button"
          variant={control.explicit ? "default" : "ghost"}
          size="icon-xs"
          aria-label={
            control.explicit ? "Hand control back to the agent" : "Take control (agents wait)"
          }
          onClick={() => send({ type: "control", take: !control.explicit })}
        >
          <HandIcon />
        </Button>
        <Menu>
          <MenuTrigger
            aria-label="More browser actions"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:size-6"
          >
            <EllipsisIcon className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="end" className="min-w-56">
            <MenuItem
              onClick={openExternally}
              disabled={!shownUrl || shownUrl.startsWith("chrome://")}
            >
              <ExternalLinkIcon className="size-3.5" />
              {port ? "Open this preview in a new tab" : "Open in a new tab"}
            </MenuItem>
            <MenuCheckboxItem
              checked={phone}
              onCheckedChange={(checked) =>
                send({ type: "device", mode: checked ? "phone" : "desktop" })
              }
            >
              Phone view
            </MenuCheckboxItem>
            <MenuCheckboxItem
              checked={follow}
              onCheckedChange={(checked) => send({ type: "follow", enabled: checked })}
            >
              Follow the agent's tab
            </MenuCheckboxItem>
          </MenuPopup>
        </Menu>
      </div>

      {control.explicit ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-primary/8 px-3 py-1.5 text-xs">
          <HandIcon className="size-3.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            You have control. Agents wait until you hand it back.
          </span>
          <Button
            type="button"
            size="compact"
            variant="outline"
            onClick={() => send({ type: "control", take: false })}
          >
            Hand back
          </Button>
        </div>
      ) : agentActive && !(view === "desktop" && screen === "windows") ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
          <BotIcon className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            The agent is using the {view === "desktop" ? "desktop" : "browser"}.
          </span>
          <Button
            type="button"
            size="compact"
            variant="ghost"
            onClick={() => send({ type: "control", take: true })}
          >
            Take control
          </Button>
        </div>
      ) : null}

      {loginOffer ? (
        // Over the top corner of the page or the desktop, which stay usable around it.
        <div className="relative z-20 h-0 shrink-0">
          <div className="absolute top-2 right-2 w-[min(22rem,calc(100%-1rem))]">
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
        <AldoDesktopView environmentId={environmentId} screen={screen} />
      ) : null}
      <div
        ref={stageRef}
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden bg-muted/30",
          view === "desktop" && "hidden",
        )}
      >
        <canvas
          ref={canvasRef}
          aria-label="Shared browser. Click to interact."
          className={cn(
            "size-full touch-none object-contain outline-none",
            status !== "live" && "opacity-40",
            focused && "ring-2 ring-ring/40 ring-inset",
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
        {status !== "live" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
            {status === "asleep" ? (
              aldoOfflineMessage(environmentId)
            ) : status === "error" ? (
              <span className="max-w-sm">
                Couldn't reach the browser{error ? `: ${error}` : ""}. Retrying…
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <LoaderIcon className="size-4 animate-spin" /> Connecting to the browser…
              </span>
            )}
          </div>
        ) : null}
        {dialog ? (
          <DialogPrompt
            dialog={dialog}
            onAnswer={(accept, promptText) => send({ type: "dialog", accept, promptText })}
          />
        ) : null}
      </div>
    </div>
  );
}

function DialogPrompt(props: {
  dialog: Dialog;
  onAnswer: (accept: boolean, promptText?: string) => void;
}) {
  const [text, setText] = useState(props.dialog.defaultPrompt ?? "");
  const cancellable = props.dialog.type !== "alert";
  return (
    <div className="absolute inset-0 flex items-start justify-center bg-black/20 p-6">
      <form
        className="w-full max-w-sm space-y-3 rounded-xl border border-border bg-popover p-4 text-sm shadow-lg"
        onSubmit={(e) => {
          e.preventDefault();
          props.onAnswer(true, text);
        }}
      >
        <p className="text-xs text-muted-foreground">This page says</p>
        <p className="whitespace-pre-wrap break-words">{props.dialog.message}</p>
        {props.dialog.type === "prompt" ? (
          <Input autoFocus value={text} onChange={(e) => setText(e.currentTarget.value)} />
        ) : null}
        <div className="flex justify-end gap-2">
          {cancellable ? (
            <Button
              type="button"
              variant="ghost"
              size="compact"
              onClick={() => props.onAnswer(false)}
            >
              Cancel
            </Button>
          ) : null}
          <Button type="submit" size="compact" autoFocus={props.dialog.type !== "prompt"}>
            OK
          </Button>
        </div>
      </form>
    </div>
  );
}
