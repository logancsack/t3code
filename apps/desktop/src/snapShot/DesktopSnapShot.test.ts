import * as MacPermissions from "../permissions/MacPermissions.ts";
import { assert, it } from "@effect/vitest";
import {
  DEFAULT_CLIENT_SETTINGS,
  type ClientSettings,
  type DesktopSnapShotEvent,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as TestClock from "effect/testing/TestClock";
import type * as Electron from "electron";
import type { PortalShortcutState } from "./PortalCaptureShortcut.ts";
import { beforeEach, vi } from "vite-plus/test";

beforeEach(() => {
  portalShortcutInstances.length = 0;
  nextPortalState.value = undefined;
  vi.stubEnv("NIRI_SOCKET", "");
  vi.stubEnv("XDG_CURRENT_DESKTOP", "test-desktop");
  transitionCapturePageMock.mockReset().mockResolvedValue(undefined);
  transitionSnapshotMock.mockReset().mockResolvedValue(undefined);
  prepareCaptureRevealMock.mockReset();
  accessibilityListMock.mockReset().mockResolvedValue([]);
});

const {
  activeWindowMock,
  animationSettingsMock,
  accessibilityProcessWarmMock,
  accessibilityProcessCloseMock,
  accessibilityProcessCoolMock,
  accessibilityProcessReadMock,
  accessibilityByPidMock,
  accessibilityListMock,
  accessibilityForegroundMock,
  accessibilityTrustedMock,
  allWindowsMock,
  flashWindows,
  focusedWindowMock,
  getFileIconMock,
  getSourcesMock,
  macCaptureMock,
  linuxCaptureMock,
  linuxBackendMock,
  niriShortcutMock,
  niriShortcutStopMock,
  mediaAccessStatusMock,
  openExternalMock,
  registerShortcutMock,
  unregisterShortcutMock,
  portalShortcutInstances,
  prepareCaptureRevealMock,
  nextPortalState,
  regionCaptureMock,
  screenToDipRectMock,
  shortcutForkArgs,
  shortcutForkOptions,
  shortcutProcesses,
  spawnedPollers,
  thumbnailFromPathMock,
  transitionCapturePageMock,
  transitionScriptState,
  transitionShowMock,
  transitionSnapshotMock,
} = vi.hoisted(() => ({
  activeWindowMock: vi.fn(),
  animationSettingsMock: vi.fn(() => ({
    prefersReducedMotion: true,
    shouldRenderRichAnimation: false,
  })),
  accessibilityProcessWarmMock: vi.fn(),
  accessibilityProcessCloseMock: vi.fn(),
  accessibilityProcessCoolMock: vi.fn(),
  accessibilityProcessReadMock: vi.fn<
    (request: import("./SnapShotAccessibility.ts").SnapShotAccessibilityRequest) => {
      started: Promise<void>;
      result: Promise<
        import("./SnapShotAccessibility.ts").CapturedWindowAccessibilityContext | undefined
      >;
    }
  >(),
  accessibilityByPidMock: vi.fn(),
  accessibilityListMock: vi.fn(),
  accessibilityForegroundMock: vi.fn(),
  accessibilityTrustedMock: vi.fn((_prompt = false) => true),
  allWindowsMock: vi.fn(
    () =>
      [] as Array<{
        getBounds: () => Electron.Rectangle;
        isDestroyed: () => boolean;
      }>,
  ),
  flashWindows: [] as Array<{
    bounds: Electron.Rectangle | null;
    destroyed: boolean;
    kind: "base" | "browser";
    loadCount: number;
    loadedUrls: Array<string>;
    opacities: Array<number>;
    options: Electron.BrowserWindowConstructorOptions;
    scripts: Array<string>;
    capturedRegions: Array<Electron.Rectangle>;
    showCount: number;
    resizeCount: number;
    alwaysOnTopCalls: Array<[boolean, string | undefined]>;
  }>,
  focusedWindowMock: vi.fn(),
  getFileIconMock: vi.fn(),
  getSourcesMock: vi.fn(),
  macCaptureMock: vi.fn(),
  linuxCaptureMock: vi.fn<
    () => Promise<import("./LinuxSnapShot.ts").LinuxWindowSnapshot | undefined>
  >(async () => undefined),
  linuxBackendMock: vi.fn(async () => "picker"),
  niriShortcutStopMock: vi.fn(),
  niriShortcutMock:
    vi.fn<(appId: string, trigger: () => void, fail: () => void) => Promise<() => void>>(),
  mediaAccessStatusMock: vi.fn(() => "not-determined"),
  openExternalMock: vi.fn(() => Promise.resolve()),
  registerShortcutMock: vi.fn(),
  unregisterShortcutMock: vi.fn(),
  nextPortalState: { value: undefined as PortalShortcutState | undefined },
  portalShortcutInstances: [] as Array<{
    state: PortalShortcutState;
    onCapture: () => Promise<void>;
    onStateChanged: () => void;
    close: ReturnType<typeof vi.fn>;
    configure: ReturnType<typeof vi.fn>;
    hasSession: boolean;
  }>,
  prepareCaptureRevealMock: vi.fn(),
  regionCaptureMock:
    vi.fn<
      (region: Electron.Rectangle) => Promise<{ width: number; height: number; png: Buffer }>
    >(),
  screenToDipRectMock: vi.fn((_window: unknown, bounds: Electron.Rectangle) => bounds),
  shortcutForkArgs: [] as Array<ReadonlyArray<string>>,
  shortcutForkOptions: [] as Array<{ env?: NodeJS.ProcessEnv }>,
  shortcutProcesses: [] as Array<{
    emit: (event: string, value?: unknown) => void;
    kill: ReturnType<typeof vi.fn>;
    on: (event: string, listener: (value: unknown) => void) => unknown;
    once: (event: string, listener: (value: unknown) => void) => unknown;
  }>,
  spawnedPollers: [] as Array<{
    args: ReadonlyArray<string>;
    kill: ReturnType<typeof vi.fn>;
    emitStderr: (text: string) => void;
    emitExit: (code: number) => void;
  }>,
  thumbnailFromPathMock: vi.fn(),
  transitionCapturePageMock: vi.fn<() => Promise<void>>(),
  transitionScriptState: {
    rejectFlight: false,
    heldFlights: null as Array<() => void> | null,
  },
  transitionShowMock: vi.fn(),
  transitionSnapshotMock: vi.fn<() => Promise<void>>(),
}));

vi.mock("./SnapShotAccessibilityProcess.ts", () => ({
  makeSnapShotAccessibilityProcessPool: () => ({
    warm: accessibilityProcessWarmMock,
    cool: accessibilityProcessCoolMock,
    read: accessibilityProcessReadMock,
    close: accessibilityProcessCloseMock,
  }),
}));
vi.mock("./ActiveWindow.ts", () => ({ activeWindow: activeWindowMock }));
vi.mock("./RegionSnapShot.ts", async (original) => ({
  ...(await original<typeof import("./RegionSnapShot.ts")>()),
  makeRegionSnapShotPool: () => ({
    warm: vi.fn(),
    cool: vi.fn(),
    close: vi.fn(),
    capture: regionCaptureMock,
  }),
}));
vi.mock("./WindowsCaptureFeedback.ts", () => ({
  showWindowsCaptureOverlay: (window: Electron.BaseWindow) => window.showInactive(),
}));
vi.mock("./MacSnapShot.ts", () => ({ captureMacWindowSnapshot: macCaptureMock }));
vi.mock("./LinuxSnapShot.ts", () => ({
  captureLinuxWindow: linuxCaptureMock,
  getLinuxCaptureSupport: async () => ({
    linuxBackend: await linuxBackendMock(),
    linuxFeedbackAvailable: false,
  }),
}));
vi.mock("./NiriCaptureShortcut.ts", async (original) => ({
  ...(await original<typeof import("./NiriCaptureShortcut.ts")>()),
  startNiriCaptureShortcut: niriShortcutMock,
}));
vi.mock("./PortalCaptureShortcut.ts", async (original) => ({
  ...(await original<typeof import("./PortalCaptureShortcut.ts")>()),
  PortalCaptureShortcut: class {
    state: PortalShortcutState = nextPortalState.value ?? {
      shortcutRegistered: true,
      shortcutPending: false,
      shortcutLabel: "Ctrl+Shift+2",
      shortcutMessage: "Desktop shortcut: Ctrl+Shift+2",
    };
    close = vi.fn();
    configure = vi.fn(async () => {});
    hasSession = true;
    onCapture: () => Promise<void>;
    onStateChanged: () => void;
    constructor(
      _appId: string,
      _shortcut: unknown,
      onCapture: () => Promise<void>,
      onStateChanged: () => void,
    ) {
      this.onCapture = onCapture;
      this.onStateChanged = onStateChanged;
      portalShortcutInstances.push(this);
    }
  },
}));
vi.mock("node:child_process", () => ({
  spawn: (_command: string, args: ReadonlyArray<string>) => {
    const stderrListeners: Array<(chunk: Buffer) => void> = [];
    const onceListeners = new Map<string, Array<(value?: unknown) => void>>();
    const record = {
      args,
      kill: vi.fn(() => true),
      emitStderr: (text: string) => {
        for (const listener of stderrListeners) listener(Buffer.from(text));
      },
      emitExit: (code: number) => {
        for (const listener of onceListeners.get("exit") ?? []) listener(code);
      },
    };
    spawnedPollers.push(record);
    const child = {
      stderr: {
        on: (_event: "data", listener: (chunk: Buffer) => void) => {
          stderrListeners.push(listener);
          return child;
        },
      },
      once: (event: string, listener: (value?: unknown) => void) => {
        onceListeners.set(event, [...(onceListeners.get(event) ?? []), listener]);
        return child;
      },
      kill: record.kill,
    };
    queueMicrotask(() => record.emitStderr("ready\n"));
    return child;
  },
  fork: (_path: string, args: ReadonlyArray<string>, options: { env?: NodeJS.ProcessEnv }) => {
    const listeners = new Map<string, Array<(value: unknown) => void>>();
    const process = {
      emit: (event: string, value?: unknown) => {
        for (const listener of listeners.get(event) ?? []) listener(value);
      },
      kill: vi.fn(() => true),
      on: (event: string, listener: (value: unknown) => void) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        return process;
      },
      once: (event: string, listener: (value: unknown) => void) => {
        const wrapped = (value: unknown) => {
          listeners.set(
            event,
            (listeners.get(event) ?? []).filter((candidate) => candidate !== wrapped),
          );
          listener(value);
        };
        listeners.set(event, [...(listeners.get(event) ?? []), wrapped]);
        return process;
      },
    };
    shortcutForkArgs.push(args);
    shortcutForkOptions.push(options);
    shortcutProcesses.push(process);
    queueMicrotask(() => process.emit("message", "ready"));
    return process;
  },
}));
vi.mock("electron", () => {
  class BaseWindow {
    protected readonly state: (typeof flashWindows)[number];

    constructor(options: Electron.BrowserWindowConstructorOptions) {
      this.state = {
        bounds:
          options.x === undefined ||
          options.y === undefined ||
          options.width === undefined ||
          options.height === undefined
            ? null
            : { x: options.x, y: options.y, width: options.width, height: options.height },
        destroyed: false,
        kind: "base",
        loadCount: 0,
        loadedUrls: [],
        opacities: options.opacity === undefined ? [] : [options.opacity],
        options,
        scripts: [],
        capturedRegions: [],
        showCount: 0,
        resizeCount: 0,
        alwaysOnTopCalls: [],
      };
      flashWindows.push(this.state);
    }

    destroy() {
      this.state.destroyed = true;
    }

    getBounds() {
      return this.state.bounds;
    }

    isDestroyed() {
      return this.state.destroyed;
    }

    setBounds(bounds: Electron.Rectangle) {
      this.state.resizeCount++;
      this.state.bounds = bounds;
    }

    setIgnoreMouseEvents() {}

    setOpacity(opacity: number) {
      this.state.opacities.push(opacity);
    }

    setAlwaysOnTop(flag: boolean, level?: string) {
      this.state.alwaysOnTopCalls.push([flag, level]);
    }

    showInactive() {
      const shownBounds = transitionShowMock(this.state.bounds);
      if (shownBounds !== undefined) this.state.bounds = shownBounds;
      this.state.showCount += 1;
    }
  }

  class BrowserWindow extends BaseWindow {
    static getFocusedWindow() {
      return focusedWindowMock();
    }

    static getAllWindows() {
      return allWindowsMock();
    }

    readonly webContents;

    constructor(options: Electron.BrowserWindowConstructorOptions) {
      super(options);
      this.state.kind = "browser";
      this.webContents = {
        executeJavaScript: async (script: string) => {
          this.state.scripts.push(script);
          if (script.startsWith("window.setCaptureSnapshot")) {
            await transitionSnapshotMock();
          }
          if (script !== "window.playCaptureTransition()") return;
          if (transitionScriptState.rejectFlight) {
            transitionScriptState.rejectFlight = false;
            throw new Error("transition failed");
          }
          const held = transitionScriptState.heldFlights;
          if (held) await new Promise<void>((resolve) => held.push(resolve));
        },
        capturePage: async (bounds: Electron.Rectangle) => {
          this.state.capturedRegions.push(bounds);
          await transitionCapturePageMock();
        },
      };
    }

    loadURL(url: string) {
      this.state.loadCount += 1;
      this.state.loadedUrls.push(url);
      return Promise.resolve();
    }
  }

  return {
    BaseWindow,
    BrowserWindow,
    app: { getFileIcon: getFileIconMock },
    desktopCapturer: { getSources: getSourcesMock },
    nativeImage: { createThumbnailFromPath: thumbnailFromPathMock },
    globalShortcut: { register: registerShortcutMock, unregister: unregisterShortcutMock },
    screen: {
      getDisplayMatching: (bounds: Electron.Rectangle) =>
        bounds.x < 0
          ? { id: 1, bounds: { x: -1_920, y: 0, width: 1_920, height: 1_080 } }
          : { id: 2, bounds: { x: 0, y: -200, width: 1_440, height: 900 } },
      getAllDisplays: () => [
        { id: 1, bounds: { x: -1_920, y: 0, width: 1_920, height: 1_080 } },
        { id: 2, bounds: { x: 0, y: -200, width: 1_440, height: 900 } },
      ],
      getCursorScreenPoint: () => ({ x: 500, y: 500 }),
      getDisplayNearestPoint: () => ({
        bounds: { x: 100, y: 100, width: 800, height: 600 },
      }),
      getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1_440, height: 900 } }),
      screenToDipRect: screenToDipRectMock,
    },
    shell: { openExternal: openExternalMock },
    systemPreferences: {
      getAnimationSettings: () => animationSettingsMock(),
      getMediaAccessStatus: () => mediaAccessStatusMock(),
      isTrustedAccessibilityClient: (prompt: boolean) => accessibilityTrustedMock(prompt),
    },
  };
});

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as DesktopSnapShot from "./DesktopSnapShot.ts";
import * as SnapShotAccessibility from "./SnapShotAccessibility.ts";

// The accessibility reader normally runs in a worker with the real xa11y `App`.
// Tests hand it this stand-in so the mocks above drive window lookups.
const accessibilityApp = {
  byPid: accessibilityByPidMock,
  list: accessibilityListMock,
  foreground: accessibilityForegroundMock,
} as unknown as Parameters<typeof SnapShotAccessibility.readAccessibleWindowContextWithApp>[0];
const readAccessibleWindowContext = (
  active: SnapShotAccessibility.AccessibleWindowIdentity,
  platform: NodeJS.Platform,
  sourceTitle: string,
  imageSize: Electron.Size = {
    width: Math.max(1, Math.round(active.bounds.width)),
    height: Math.max(1, Math.round(active.bounds.height)),
  },
) =>
  SnapShotAccessibility.readAccessibleWindowContextWithApp(accessibilityApp, {
    active,
    platform,
    sourceTitle,
    imageSize,
  });
const readAccessibleWindowText = async (
  active: SnapShotAccessibility.AccessibleWindowIdentity,
  platform: NodeJS.Platform,
  sourceTitle: string,
) => (await readAccessibleWindowContext(active, platform, sourceTitle))?.accessibleText;
accessibilityProcessReadMock.mockImplementation((request) => ({
  started: Promise.resolve(),
  result: readAccessibleWindowContext(
    request.active,
    request.platform,
    request.sourceTitle,
    request.imageSize,
  ),
}));
vi.mock("./GnomeCaptureSetup.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./GnomeCaptureSetup.ts")>()),
  GnomeCaptureSetup: class {
    state = async () => ({ status: "enabled" as const, message: "Extension running" });
    perform = async () => undefined;
    close = () => undefined;
  },
}));

const testLayer = (
  platform: NodeJS.Platform,
  fileSystemOverrides: Parameters<typeof FileSystem.layerNoop>[0] = {},
  initialSettings: Option.Option<ClientSettings> = Option.none(),
  settingsGet: Effect.Effect<
    Option.Option<ClientSettings>,
    DesktopClientSettings.DesktopClientSettingsReadError
  > = Effect.succeed(initialSettings),
) =>
  MacPermissions.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(
          DesktopEnvironment.DesktopEnvironment,
          DesktopEnvironment.DesktopEnvironment.of({
            platform,
            stateDir: "/state",
            linuxDesktopEntryName: "com.t3tools.T3Code.desktop",
            appRoot: "/repo",
            linuxApplicationsDir: "/test-data/applications",
          } as DesktopEnvironment.DesktopEnvironment["Service"]),
        ),
        Layer.succeed(
          DesktopClientSettings.DesktopClientSettings,
          DesktopClientSettings.DesktopClientSettings.of({
            get: settingsGet,
            set: () => Effect.void,
          }),
        ),
        Layer.succeed(
          DesktopWindow.DesktopWindow,
          DesktopWindow.DesktopWindow.of({
            activate: Effect.void,
            prepareCaptureReveal: Effect.sync(prepareCaptureRevealMock),
            dispatchMenuAction: () => Effect.void,
            dispatchSnapShotEvent: () => Effect.void,
          } as unknown as DesktopWindow.DesktopWindow["Service"]),
        ),
        FileSystem.layerNoop(fileSystemOverrides),
        Path.layer,
        Layer.succeed(
          Crypto.Crypto,
          Crypto.make({
            randomBytes: (size) => new Uint8Array(size),
            digest: (_algorithm, data) => Effect.succeed(data),
          }),
        ),
      ),
    ),
  );

const enabledSettings = (overrides: Partial<ClientSettings> = {}): ClientSettings => ({
  ...DEFAULT_CLIENT_SETTINGS,
  snapShotEnabled: true,
  ...overrides,
});

function concurrentCaptureFixture(platform: NodeJS.Platform, animations: boolean) {
  vi.stubEnv("XDG_SESSION_TYPE", "wayland");
  focusedWindowMock.mockReturnValue(undefined);
  allWindowsMock.mockReturnValue([]);
  registerShortcutMock.mockReset().mockReturnValue(true);
  mediaAccessStatusMock.mockReturnValue("granted");
  animationSettingsMock.mockReturnValue({
    prefersReducedMotion: false,
    shouldRenderRichAnimation: true,
  });
  flashWindows.length = 0;
  const captures = ["Discord", "File Explorer", "Terminal"].map((title, index) => ({
    title,
    id: index + 42,
    processId: index + 100,
    png: Buffer.from([index, index + 1, index + 2]),
    started: Promise.withResolvers<void>(),
    pixels: Promise.withResolvers<void>(),
    handoff: Promise.withResolvers<void>(),
    context: Promise.withResolvers<SnapShotAccessibility.CapturedWindowAccessibilityContext>(),
    oldOverlaysCleared: false,
    oldNativeFeedbackClosed: false,
    feedback: {
      animationStarted: animations,
      activate: async () => undefined,
      animateTo: async () => undefined,
      complete: vi.fn(async () => undefined),
      close: vi.fn(),
    },
  }));
  const [first, second, extra] = captures;
  extra!.pixels.resolve();
  extra!.context.resolve({ accessibleText: extra!.title });
  const state = {
    snapshots: 0,
    handoffs: 0,
    preparations: 0,
    preparedWithoutOverlay: true,
    failFirstPersistence: false,
  };
  const images = new Map<string, Uint8Array>();
  const metadata = new Map<string, string>();
  const readyIds: string[] = [];
  const requestedIds: string[] = [];
  const bounds = { x: 10, y: 20, width: 800, height: 600 };
  const takeSnapshot = async () => {
    const index = state.snapshots++;
    const capture = captures[Math.min(index, captures.length - 1)]!;
    capture.oldOverlaysCleared = flashWindows.every((window) => window.destroyed);
    capture.oldNativeFeedbackClosed = captures
      .slice(0, index)
      .every((previous) => previous.feedback.close.mock.calls.length > 0);
    capture.started.resolve();
    await capture.pixels.promise;
    return capture;
  };
  activeWindowMock.mockReset().mockImplementation(async () => {
    const capture = captures[Math.min(state.snapshots, captures.length - 1)]!;
    return {
      platform: platform === "darwin" ? "macos" : "windows",
      id: capture.id,
      title: capture.title,
      owner: { name: capture.title, processId: capture.processId },
      bounds,
    };
  });
  regionCaptureMock.mockReset().mockImplementation(async () => {
    const capture = await takeSnapshot();
    return { width: bounds.width, height: bounds.height, png: capture.png };
  });
  macCaptureMock.mockReset().mockImplementation(async (_active: unknown, imagePath: string) => {
    const capture = await takeSnapshot();
    images.set(imagePath, capture.png);
    return { source: { name: capture.title }, png: capture.png };
  });
  linuxCaptureMock.mockReset().mockImplementation(async () => {
    const capture = await takeSnapshot();
    return {
      png: capture.png,
      window: {
        title: capture.title,
        appName: capture.title,
        appIdentifier: `test.capture.${capture.id}`,
        processId: capture.processId,
        bounds,
      },
      feedback: capture.feedback,
    };
  });
  const readAccessibility = accessibilityProcessReadMock.getMockImplementation()!;
  accessibilityProcessReadMock.mockImplementation(({ active }) => ({
    started: Promise.resolve(),
    result: captures.find((capture) => capture.processId === active.owner.processId)!.context
      .promise,
  }));
  const handoff = Effect.sync(() => captures[state.handoffs++]!.handoff.resolve());
  let randomByte = 0;
  const layer = Layer.mergeAll(
    testLayer(platform, {
      makeDirectory: () => Effect.void,
      writeFile: (path, bytes) =>
        Effect.sync(() => {
          images.set(path, bytes);
        }),
      writeFileString: (path, text) => {
        const pending = JSON.parse(text) as { source: { windowTitle: string } };
        return state.failFirstPersistence && pending.source.windowTitle === first!.title
          ? Effect.fail(
              PlatformError.systemError({
                _tag: "PermissionDenied",
                module: "FileSystem",
                method: "writeFileString",
              }),
            )
          : Effect.sync(() => {
              metadata.set(path, text);
            });
      },
      rename: (from, to) =>
        Effect.sync(() => {
          const image = images.get(from);
          if (image) {
            images.set(to, image);
            images.delete(from);
          }
          const text = metadata.get(from);
          if (text) {
            metadata.set(to, text);
            metadata.delete(from);
          }
        }),
      remove: (path) =>
        Effect.sync(() => {
          images.delete(path);
          metadata.delete(path);
        }),
      readFile: (path) => Effect.sync(() => images.get(path)!),
      readFileString: (path) => Effect.sync(() => metadata.get(path)!),
    }),
    Layer.succeed(
      Crypto.Crypto,
      Crypto.make({
        randomBytes: (size) => new Uint8Array(size).fill(++randomByte),
        digest: (_algorithm, data) => Effect.succeed(data),
      }),
    ),
    Layer.succeed(
      DesktopWindow.DesktopWindow,
      DesktopWindow.DesktopWindow.of({
        activate: handoff,
        prepareCaptureReveal: Effect.sync(() => {
          state.preparations++;
          state.preparedWithoutOverlay &&= flashWindows.every((window) => window.destroyed);
        }),
        dispatchMenuAction: () => Effect.void,
        dispatchSnapShotEvent: (event: DesktopSnapShotEvent) => {
          switch (event.type) {
            case "requested":
              return Effect.sync(() => {
                requestedIds.push(event.id);
              });
            case "started":
              return handoff;
            case "ready":
              return Effect.sync(() => {
                readyIds.push(event.id);
              });
            default:
              return Effect.void;
          }
        },
      } as unknown as DesktopWindow.DesktopWindow["Service"]),
    ),
  );
  return {
    first: first!,
    second: second!,
    state,
    readyIds,
    requestedIds,
    layer,
    settings: {
      ...DEFAULT_CLIENT_SETTINGS,
      snapShotEnabled: true,
      snapShotIncludeAccessibility: true,
      snapShotAnimations: animations,
      snapShotFlash: true,
      snapShotShortcut: {
        key: "2",
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
        metaKey: false,
        modKey: false,
      },
    },
    trigger: () =>
      platform === "linux"
        ? portalShortcutInstances.at(-1)!.onCapture()
        : (registerShortcutMock.mock.calls.at(-1)![1] as () => Promise<void>)(),
    releaseAll: () => {
      for (const capture of captures) {
        capture.pixels.resolve();
        capture.context.resolve({ accessibleText: capture.title });
      }
    },
    reset: () => {
      focusedWindowMock.mockReset();
      linuxCaptureMock.mockReset().mockResolvedValue(undefined);
      accessibilityProcessReadMock.mockReset().mockImplementation(readAccessibility);
      mediaAccessStatusMock.mockReturnValue("not-determined");
      animationSettingsMock.mockReturnValue({
        prefersReducedMotion: true,
        shouldRenderRichAnimation: false,
      });
      vi.unstubAllEnvs();
    },
  };
}

it.effect("rejects desktop config changes outside Niri or Hyprland", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopSnapShot.make;
      const previewError = yield* service
        .previewConfig({ operation: "install", chooseFile: false })
        .pipe(Effect.flip);
      const applyError = yield* service.applyConfig("unapproved-preview").pipe(Effect.flip);
      assert.equal(previewError.action, "preview-config");
      assert.equal(applyError.action, "apply-config");
      for (const error of [previewError, applyError]) {
        assert.equal(error.reason, "unsupported-session");
        assert.equal(error.message, "Config setup requires a Niri or Hyprland session.");
      }
    }),
  ).pipe(Effect.provide(testLayer("win32"))),
);

it.effect.each(["succeeds", "fails"] as const)(
  "keeps the newer snapshot exclusive when older persistence %s",
  (outcome) => {
    const fixture = concurrentCaptureFixture("win32", true);
    fixture.state.failFirstPersistence = outcome === "fails";
    return Effect.scoped(
      Effect.gen(function* () {
        const service = yield* DesktopSnapShot.make;
        yield* service.configure(fixture.settings);
        fixture.first.pixels.resolve();
        const first = yield* Effect.promise(fixture.trigger).pipe(
          Effect.forkChild({ startImmediately: true }),
        );
        yield* Effect.promise(() => fixture.first.handoff.promise);
        yield* TestClock.adjust("200 millis");
        const second = yield* Effect.promise(fixture.trigger).pipe(
          Effect.forkChild({ startImmediately: true }),
        );
        yield* Effect.promise(() => fixture.second.started.promise);

        yield* TestClock.adjust("200 millis");
        yield* Effect.promise(fixture.trigger);
        assert.equal(fixture.state.snapshots, 2);
        fixture.first.context.resolve({ accessibleText: "Discord accessibility" });
        yield* Fiber.join(first);
        assert.lengthOf(fixture.readyIds, outcome === "succeeds" ? 1 : 0);
        yield* TestClock.adjust("200 millis");
        yield* Effect.promise(fixture.trigger);
        assert.equal(fixture.state.snapshots, 2);

        fixture.second.pixels.resolve();
        yield* Effect.promise(() => fixture.second.handoff.promise);
        fixture.second.context.resolve({ accessibleText: "Explorer accessibility" });
        yield* Fiber.join(second);
        assert.equal(fixture.state.handoffs, 2);
        const newer = yield* service.read(fixture.readyIds.at(-1)!);
        assert.equal(newer.source.windowTitle, fixture.second.title);
        assert.equal(newer.source.accessibleText, "Explorer accessibility");
      }).pipe(Effect.ensuring(Effect.sync(fixture.releaseAll))),
    ).pipe(Effect.provide(fixture.layer), Effect.ensuring(Effect.sync(fixture.reset)));
  },
);

it.effect("keeps newer native feedback when older accessibility persistence fails", () => {
  const fixture = concurrentCaptureFixture("linux", true);
  fixture.state.failFirstPersistence = true;
  return Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopSnapShot.make;
      yield* service.configure(fixture.settings);
      fixture.first.pixels.resolve();
      const first = yield* Effect.promise(fixture.trigger).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Effect.promise(() => fixture.first.handoff.promise);
      yield* TestClock.adjust("200 millis");
      fixture.second.pixels.resolve();
      const second = yield* Effect.promise(fixture.trigger).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Effect.promise(() => fixture.second.handoff.promise);
      fixture.first.context.resolve({ accessibleText: "Discord accessibility" });
      yield* Fiber.join(first);

      assert.lengthOf(fixture.readyIds, 0);
      assert.lengthOf(fixture.second.feedback.close.mock.calls, 0);
      assert.lengthOf(fixture.second.feedback.complete.mock.calls, 0);
      fixture.second.context.resolve({ accessibleText: "Explorer accessibility" });
      yield* Fiber.join(second);
      assert.lengthOf(fixture.readyIds, 1);
      const newer = yield* service.read(fixture.readyIds[0]!);
      assert.equal(newer.source.windowTitle, fixture.second.title);
      yield* service.acknowledge(fixture.readyIds[0]!);
      assert.lengthOf(fixture.second.feedback.complete.mock.calls, 1);
    }).pipe(Effect.ensuring(Effect.sync(fixture.releaseAll))),
  ).pipe(Effect.provide(fixture.layer), Effect.ensuring(Effect.sync(fixture.reset)));
});

it.effect("rejects X11 capture without registering shortcuts or loading capture backends", () => {
  vi.stubEnv("XDG_SESSION_TYPE", "x11");
  vi.stubEnv("WAYLAND_DISPLAY", "");
  linuxCaptureMock.mockClear();
  activeWindowMock.mockClear();
  registerShortcutMock.mockClear();
  shortcutProcesses.length = 0;
  return Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopSnapShot.make;
      yield* service.configure({ ...DEFAULT_CLIENT_SETTINGS, snapShotEnabled: true });
      const state = yield* service.state;
      assert.equal(state.mode, "unavailable");
      assert.include(state.message, "Wayland");
      const result = yield* Effect.flip(service.capture);
      assert.equal(result.operation, "unsupported");
      assert.lengthOf(registerShortcutMock.mock.calls, 0);
      assert.lengthOf(shortcutProcesses, 0);
      assert.lengthOf(linuxCaptureMock.mock.calls, 0);
      assert.lengthOf(activeWindowMock.mock.calls, 0);
    }),
  ).pipe(
    Effect.provide(testLayer("linux")),
    Effect.ensuring(Effect.sync(() => vi.unstubAllEnvs())),
  );
});

it.effect("does not fall back to the picker when an automatic Wayland capture fails", () => {
  vi.stubEnv("XDG_SESSION_TYPE", "wayland");
  linuxCaptureMock.mockRejectedValueOnce(new Error("Capture denied"));
  getSourcesMock.mockClear();
  return Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopSnapShot.make;
      yield* service.configure(enabledSettings());
      const failure = yield* Effect.flip(service.capture);
      assert.equal(failure.operation, "capture");
      assert.lengthOf(getSourcesMock.mock.calls, 0);
    }),
  ).pipe(
    Effect.provide(
      testLayer("linux", {
        makeDirectory: () => Effect.void,
        remove: () => Effect.void,
      }),
    ),
    Effect.ensuring(Effect.sync(() => vi.unstubAllEnvs())),
  );
});

it.effect("does not read unverified accessibility context for a Wayland portal capture", () => {
  vi.stubEnv("XDG_SESSION_TYPE", "wayland");
  const png = Buffer.from([1, 2, 3]);
  accessibilityForegroundMock.mockReset();
  getSourcesMock.mockReset().mockResolvedValue([
    {
      id: "window:42:0",
      name: "Untitled",
      thumbnail: { isEmpty: () => false, toPNG: () => png },
    },
  ]);
  const layer = testLayer("linux", {
    makeDirectory: () => Effect.void,
    rename: () => Effect.void,
    writeFile: () => Effect.void,
    writeFileString: () => Effect.void,
  });

  return Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopSnapShot.make;
      yield* service.configure(enabledSettings());
      yield* service.capture;

      assert.lengthOf(accessibilityForegroundMock.mock.calls, 0);
    }),
  ).pipe(Effect.provide(layer), Effect.ensuring(Effect.sync(() => vi.unstubAllEnvs())));
});

it("does not guess GTK4 app text when two unnamed PID windows share the captured size", async () => {
  vi.stubEnv("XDG_SESSION_TYPE", "wayland");
  const bounds = { x: 0, y: 0, width: 1_920, height: 1_048 };
  const tree = vi.fn(async () => ({ value: "Wrong window", children: [] }));
  accessibilityByPidMock.mockReset().mockResolvedValue({
    children: async () => [
      { role: "group", name: null, bounds, tree },
      { role: "group", name: null, bounds: { ...bounds, x: 12 }, tree },
    ],
  });
  accessibilityListMock.mockReset().mockResolvedValue([
    {
      pid: 99,
      children: async () => [{ role: "window", name: "System Monitor", bounds, tree }],
    },
  ]);
  try {
    assert.isUndefined(
      await readAccessibleWindowText(
        {
          title: "System Monitor",
          bounds: { x: 12, y: 48, width: 1_920, height: 1_048 },
          owner: { processId: 210600 },
        },
        "linux",
        "System Monitor",
      ),
    );
    assert.lengthOf(accessibilityListMock.mock.calls, 0);
    assert.lengthOf(tree.mock.calls, 0);
  } finally {
    accessibilityListMock.mockReset().mockResolvedValue([]);
    vi.unstubAllEnvs();
  }
});

it("times out after three seconds without overlapping the outstanding accessibility read", async () => {
  vi.useFakeTimers();
  accessibilityByPidMock.mockReset();
  const read = Promise.withResolvers<{ children: () => Promise<Array<never>> }>();
  const started = Promise.withResolvers<void>();
  accessibilityByPidMock.mockImplementationOnce(() => {
    started.resolve();
    return read.promise;
  });
  const active = {
    title: "main.ts",
    owner: { processId: 42 },
    bounds: { x: 0, y: 0, width: 800, height: 600 },
  } satisfies SnapShotAccessibility.AccessibleWindowIdentity;

  try {
    const first = readAccessibleWindowText(active, "darwin", "main.ts");
    let settled = false;
    void first.then(() => {
      settled = true;
    });
    await started.promise;
    await vi.advanceTimersByTimeAsync(2_999);
    assert.isFalse(settled);
    await vi.advanceTimersByTimeAsync(1);
    assert.isUndefined(await first);
    assert.strictEqual(vi.getTimerCount(), 0);
    assert.isUndefined(await readAccessibleWindowText(active, "darwin", "main.ts"));
    assert.strictEqual(accessibilityByPidMock.mock.calls.length, 1);

    read.resolve({ children: async () => [] });
    await vi.advanceTimersByTimeAsync(0);
    accessibilityByPidMock.mockResolvedValueOnce({ children: async () => [] });
    assert.isUndefined(await readAccessibleWindowText(active, "darwin", "main.ts"));
    assert.strictEqual(accessibilityByPidMock.mock.calls.length, 2);
  } finally {
    read.resolve({ children: async () => [] });
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
  }
});

it.effect("does not request permissions or create the flash during desktop startup", () => {
  flashWindows.length = 0;
  accessibilityTrustedMock.mockReset().mockReturnValue(false);
  mediaAccessStatusMock.mockReset().mockReturnValue("not-determined");
  getSourcesMock.mockReset().mockResolvedValue([]);
  openExternalMock.mockClear();
  const settings = {
    ...DEFAULT_CLIENT_SETTINGS,
    snapShotEnabled: true,
    snapShotFlash: true,
  };

  return Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopSnapShot.make;
      yield* service.initialize;
      assert.lengthOf(flashWindows, 0);
      assert.deepEqual(accessibilityTrustedMock.mock.calls, [[false]]);
      assert.lengthOf(getSourcesMock.mock.calls, 0);
      assert.lengthOf(openExternalMock.mock.calls, 0);
    }),
  ).pipe(Effect.provide(testLayer("darwin", {}, Option.some(settings))));
});

it.effect("keeps snapshots disabled when client settings cannot be read at startup", () => {
  const readError = new DesktopClientSettings.DesktopClientSettingsReadError({
    operation: "read-file",
    path: "/state/client-settings.json",
    cause: new Error("unavailable"),
  });

  return Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopSnapShot.make;
      yield* service.initialize;
      assert.isFalse((yield* service.state).shortcutRegistered);
    }),
  ).pipe(Effect.provide(testLayer("win32", {}, Option.none(), Effect.fail(readError))));
});

it.effect("does not request macOS permissions while synchronizing enabled settings", () => {
  accessibilityTrustedMock.mockReset().mockReturnValue(false);
  mediaAccessStatusMock.mockReset().mockReturnValue("not-determined");
  getSourcesMock.mockReset().mockResolvedValue([]);
  openExternalMock.mockClear();
  const settings = { ...DEFAULT_CLIENT_SETTINGS, snapShotEnabled: true };

  return Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopSnapShot.make;
      yield* service.configure(settings);

      assert.deepEqual(accessibilityTrustedMock.mock.calls, [[false]]);
      assert.lengthOf(getSourcesMock.mock.calls, 0);
      assert.lengthOf(openExternalMock.mock.calls, 0);
    }),
  ).pipe(Effect.provide(testLayer("darwin")));
});

it.effect("requests macOS permissions only for an explicit enable action", () => {
  accessibilityTrustedMock.mockReset().mockReturnValue(false);
  mediaAccessStatusMock.mockReset().mockReturnValue("not-determined");
  getSourcesMock.mockReset().mockResolvedValue([]);
  openExternalMock.mockClear();

  return Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopSnapShot.make;
      yield* service.requestPermissions(true);

      assert.deepEqual(accessibilityTrustedMock.mock.calls, [[true]]);
      assert.lengthOf(getSourcesMock.mock.calls, 1);
      assert.lengthOf(openExternalMock.mock.calls, 1);
    }),
  ).pipe(Effect.provide(testLayer("darwin")));
});

it.effect("does not request macOS accessibility permission when capture data is disabled", () => {
  accessibilityTrustedMock.mockReset().mockReturnValue(false);
  mediaAccessStatusMock.mockReset().mockReturnValue("not-determined");
  getSourcesMock.mockReset().mockResolvedValue([]);
  openExternalMock.mockClear();

  return Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopSnapShot.make;
      yield* service.requestPermissions(false);

      assert.lengthOf(accessibilityTrustedMock.mock.calls, 0);
      assert.lengthOf(getSourcesMock.mock.calls, 1);
      assert.lengthOf(openExternalMock.mock.calls, 1);
    }),
  ).pipe(Effect.provide(testLayer("darwin")));
});

it.effect("reports macOS permission status and requests each permission on its own", () => {
  accessibilityTrustedMock.mockReset().mockReturnValue(false);
  mediaAccessStatusMock.mockReset().mockReturnValue("granted");
  getSourcesMock.mockReset().mockResolvedValue([]);
  openExternalMock.mockClear();

  return Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopSnapShot.make;
      const state = yield* service.state;
      assert.deepEqual(state.macPermissions, { screenRecording: true, accessibility: false });

      yield* service.setup("allow-accessibility");
      assert.deepEqual(accessibilityTrustedMock.mock.calls.at(-1), [true]);
      assert.lengthOf(getSourcesMock.mock.calls, 0);

      mediaAccessStatusMock.mockReturnValue("not-determined");
      yield* service.setup("allow-screen-recording");
      assert.lengthOf(getSourcesMock.mock.calls, 1);
      assert.lengthOf(openExternalMock.mock.calls, 1);
    }),
  ).pipe(Effect.provide(testLayer("darwin")));
});

it.effect("flags revoked macOS permissions on read and re-registers once they return", () => {
  accessibilityTrustedMock.mockReset().mockReturnValue(true);
  mediaAccessStatusMock.mockReset().mockReturnValue("granted");
  registerShortcutMock.mockReset().mockReturnValue(true);

  return Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopSnapShot.make;
      yield* service.configure({ ...DEFAULT_CLIENT_SETTINGS, snapShotEnabled: true });
      assert.isNull((yield* service.state).message);

      mediaAccessStatusMock.mockReturnValue("denied");
      const revoked = yield* service.state;
      assert.equal(
        revoked.message,
        "Allow Screen Recording in System Settings, then restart T3 Code.",
      );
      assert.deepEqual(revoked.macPermissions, { screenRecording: false, accessibility: true });

      accessibilityTrustedMock.mockReturnValue(false);
      yield* service.configure({
        ...DEFAULT_CLIENT_SETTINGS,
        snapShotEnabled: true,
        snapShotIncludeAccessibility: false,
      });
      const blocked = yield* service.state;
      assert.equal(
        blocked.message,
        "Allow Screen Recording in System Settings, then restart T3 Code.",
      );
      assert.isFalse(blocked.shortcutRegistered);

      mediaAccessStatusMock.mockReturnValue("granted");
      const recovered = yield* service.state;
      assert.isNull(recovered.message);
      assert.isTrue(recovered.shortcutRegistered);
    }),
  ).pipe(Effect.provide(testLayer("darwin")));
});

it.effect("rejects macOS permission actions off macOS and omits macPermissions there", () => {
  return Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopSnapShot.make;
      const state = yield* service.state;
      assert.isUndefined(state.macPermissions);
      assert.isTrue(state.windows);
      const error = yield* service.setup("allow-screen-recording").pipe(Effect.flip);
      assert.equal(error.reason, "unsupported-session");
    }),
  ).pipe(Effect.provide(testLayer("win32")));
});

it.effect("registers macOS capture without accessibility permission when data is disabled", () => {
  accessibilityTrustedMock.mockReset().mockReturnValue(false);
  mediaAccessStatusMock.mockReset().mockReturnValue("granted");
  registerShortcutMock.mockReset().mockReturnValue(true);

  return Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopSnapShot.make;
      yield* service.configure({
        ...DEFAULT_CLIENT_SETTINGS,
        snapShotEnabled: true,
        snapShotIncludeAccessibility: false,
      });

      assert.lengthOf(accessibilityTrustedMock.mock.calls, 0);
      assert.isTrue((yield* service.state).shortcutRegistered);
    }),
  ).pipe(Effect.provide(testLayer("darwin")));
});

it.effect("capture fails closed while snapshots are disabled", () => {
  activeWindowMock.mockClear();
  getSourcesMock.mockClear();
  regionCaptureMock.mockClear();

  return Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopSnapShot.make;
      yield* service.configure({ ...DEFAULT_CLIENT_SETTINGS, snapShotEnabled: false });
      const failure = yield* Effect.flip(service.capture);
      assert.equal(failure.operation, "disabled");
      assert.lengthOf(activeWindowMock.mock.calls, 0);
      assert.lengthOf(getSourcesMock.mock.calls, 0);
      assert.lengthOf(regionCaptureMock.mock.calls, 0);
    }),
  ).pipe(Effect.provide(testLayer("win32")));
});

it.effect.each(["GNOME", "KDE", "niri", "Hyprland"] as const)(
  "identifies %s in setup even when its capability check fails",
  (desktop) => {
    vi.stubEnv("XDG_SESSION_TYPE", "wayland");
    vi.stubEnv("XDG_CURRENT_DESKTOP", desktop);
    linuxBackendMock.mockRejectedValueOnce(new Error("Capability check failed"));
    return Effect.scoped(
      Effect.gen(function* () {
        const service = yield* DesktopSnapShot.make;
        const state = yield* service.state;
        assert.equal(state.linuxDesktop, desktop.toLowerCase());
        assert.equal(state.message, "Capability check failed");
        assert.isFalse(state.shortcutVerified);
      }),
    ).pipe(
      Effect.provide(testLayer("linux")),
      Effect.ensuring(Effect.sync(() => vi.unstubAllEnvs())),
    );
  },
);

it.effect(
  "keeps saved preferences but rechecks access and shortcut delivery after changing desktops",
  () => {
    vi.stubEnv("XDG_SESSION_TYPE", "wayland");
    vi.stubEnv("NIRI_SOCKET", "/test/niri.sock");
    vi.stubEnv("FLATPAK_ID", "");
    vi.stubEnv("SNAP", "");
    registerShortcutMock.mockReset().mockReturnValue(true);
    niriShortcutMock.mockReset().mockResolvedValue(niriShortcutStopMock);
    const settings: ClientSettings = {
      ...DEFAULT_CLIENT_SETTINGS,
      snapShotEnabled: true,
      snapShotShortcut: {
        key: "2",
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
        metaKey: false,
        modKey: false,
      },
      snapShotPlaySound: false,
      snapShotAnimations: false,
    };
    return Effect.gen(function* () {
      for (const [desktop, backend] of [
        ["GNOME", "gnome-extension"],
        ["niri", "niri"],
        ["KDE", "kde"],
        ["Hyprland", "hyprland"],
        ["GNOME", "gnome-extension"],
      ] as const) {
        vi.stubEnv("XDG_CURRENT_DESKTOP", desktop);
        linuxBackendMock.mockResolvedValue(backend);
        yield* Effect.scoped(
          Effect.gen(function* () {
            const service = yield* DesktopSnapShot.make;
            yield* service.initialize;
            const state = yield* service.state;
            assert.equal(state.linuxDesktop, desktop.toLowerCase());
            assert.equal(state.linuxBackend, backend);
            assert.deepEqual(state.shortcut, settings.snapShotShortcut);
            assert.isFalse(state.shortcutVerified);
            assert.equal(state.gnomeExtension?.status, desktop === "GNOME" ? "enabled" : undefined);
            assert.equal(state.kdeHelper?.status, desktop === "KDE" ? "not-installed" : undefined);
            assert.equal(
              state.hyprlandHelper?.status,
              desktop === "Hyprland" ? "not-installed" : undefined,
            );
            assert.equal(
              Boolean(state.shortcutBinding),
              desktop === "niri" || desktop === "Hyprland",
            );
            const trigger =
              desktop === "niri"
                ? niriShortcutMock.mock.calls.at(-1)![1]
                : portalShortcutInstances.at(-1)!.onCapture;
            yield* Effect.promise(async () => {
              await trigger();
            });
            assert.isTrue((yield* service.state).shortcutVerified);
          }),
        ).pipe(Effect.provide(testLayer("linux", {}, Option.some(settings))));
      }
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          linuxBackendMock.mockResolvedValue("picker");
          vi.unstubAllEnvs();
        }),
      ),
    );
  },
);

it.effect("does not register a Wayland modifier-pair shortcut when enabled", () => {
  vi.stubEnv("XDG_SESSION_TYPE", "wayland");
  registerShortcutMock.mockReset().mockReturnValue(true);
  const settings = { ...DEFAULT_CLIENT_SETTINGS, snapShotEnabled: true };

  return Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopSnapShot.make;
      yield* service.configure(settings);

      const state = yield* service.state;
      assert.lengthOf(registerShortcutMock.mock.calls, 0);
      assert.isFalse(state.shortcutRegistered);
      assert.deepEqual(state.shortcut, DEFAULT_CLIENT_SETTINGS.snapShotShortcut);
      assert.match(state.shortcutMessage ?? "", /Modifier-pair shortcuts aren't available/);
    }),
  ).pipe(
    Effect.provide(testLayer("linux")),
    Effect.ensuring(Effect.sync(() => vi.unstubAllEnvs())),
  );
});

it.effect(
  "preserves an approved portal session for cosmetic changes and retires it when keys change",
  () => {
    vi.stubEnv("XDG_SESSION_TYPE", "wayland");
    const settings = {
      ...DEFAULT_CLIENT_SETTINGS,
      snapShotEnabled: true,
      snapShotShortcut: {
        key: "2",
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
        metaKey: false,
        modKey: false,
      },
    };
    return Effect.scoped(
      Effect.gen(function* () {
        const service = yield* DesktopSnapShot.make;
        yield* service.configure(settings);
        const first = portalShortcutInstances[0]!;
        yield* Effect.promise(first.onCapture);
        yield* service.configure({
          ...settings,
          snapShotPlaySound: false,
          snapShotFlash: false,
        });
        assert.equal(portalShortcutInstances.length, 1);
        assert.equal(first.close.mock.calls.length, 0);
        assert.isTrue((yield* service.state).shortcutVerified);
        yield* service.configure({
          ...settings,
          snapShotShortcut: { ...settings.snapShotShortcut, key: "8" },
        });
        assert.equal(first.close.mock.calls.length, 1);
        assert.equal(portalShortcutInstances.length, 2);
        assert.isFalse((yield* service.state).shortcutVerified);
        yield* Effect.promise(first.onCapture);
        assert.isFalse((yield* service.state).shortcutVerified);
        const current = portalShortcutInstances[1]!;
        yield* Effect.promise(current.onCapture);
        assert.isTrue((yield* service.state).shortcutVerified);
        yield* service.configure({ ...settings, snapShotEnabled: false });
        assert.equal(current.close.mock.calls.length, 1);
        yield* Effect.promise(current.onCapture);
        assert.isFalse((yield* service.state).shortcutVerified);
        assert.isFalse((yield* service.state).shortcutRegistered);
      }),
    ).pipe(
      Effect.provide(testLayer("linux")),
      Effect.ensuring(Effect.sync(() => vi.unstubAllEnvs())),
    );
  },
);

for (const fails of [false, true]) {
  it.effect(`tests macOS capture without publishing it and cleans up, failure=${fails}`, () => {
    const active = {
      platform: "macos",
      id: 42,
      title: "Setup",
      owner: { name: "T3 Code", processId: 123, path: "/Applications/T3 Code.app" },
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    };
    activeWindowMock.mockReset().mockResolvedValue(active);
    macCaptureMock.mockReset();
    if (fails) macCaptureMock.mockRejectedValue(new Error("Capture denied"));
    else macCaptureMock.mockResolvedValue({ source: { name: "Setup" }, png: Buffer.from("png") });
    accessibilityProcessReadMock.mockClear();
    const cleanup = vi.fn();
    return Effect.scoped(
      Effect.gen(function* () {
        const service = yield* DesktopSnapShot.make;
        if (fails) {
          const error = yield* service.setup("test-mac-capture").pipe(Effect.flip);
          assert.equal(error.reason, "setup-failed");
        } else yield* service.setup("test-mac-capture");
        assert.equal(macCaptureMock.mock.calls.length, 1);
        assert.equal(macCaptureMock.mock.calls[0]?.[0], active);
        assert.equal(macCaptureMock.mock.calls[0]?.[1], "/tmp/setup-test/test.png");
        assert.equal(cleanup.mock.calls.length, 1);
        assert.equal(accessibilityProcessReadMock.mock.calls.length, 0);
        assert.deepEqual(yield* service.listPending, []);
      }),
    ).pipe(
      Effect.provide(
        testLayer("darwin", {
          makeTempDirectoryScoped: () =>
            Effect.acquireRelease(Effect.succeed("/tmp/setup-test"), () =>
              Effect.sync(() => {
                cleanup();
              }),
            ),
          readDirectory: () => Effect.succeed([]),
        }),
      ),
    );
  });
}

it.effect("rejects macOS test capture on other platforms", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const service = yield* DesktopSnapShot.make;
      const error = yield* service.setup("test-mac-capture").pipe(Effect.flip);
      assert.equal(error.reason, "unsupported-session");
    }),
  ).pipe(Effect.provide(testLayer("win32"))),
);
