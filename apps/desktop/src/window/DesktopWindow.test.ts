import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import { DesktopSnapShotId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import * as Electron from "electron";
import { vi } from "vite-plus/test";

vi.mock("electron", async (importOriginal) => ({
  ...(await importOriginal<typeof import("electron")>()),
  session: {
    fromPartition: vi.fn(() => ({
      getUserAgent: vi.fn(() => "Mozilla/5.0 Electron/41.5.0 t3code/1.2.3"),
      setPermissionRequestHandler: vi.fn(),
      setUserAgent: vi.fn(),
    })),
  },
  screen: {
    getAllDisplays: vi.fn(() => [
      {
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      },
    ]),
  },
}));

import * as DesktopAssets from "../app/DesktopAssets.ts";
import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronMenu from "../electron/ElectronMenu.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as ElectronTheme from "../electron/ElectronTheme.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import { MENU_ACTION_CHANNEL, SNAP_SHOT_EVENT_CHANNEL } from "../ipc/channels.ts";
import * as DesktopServerExposure from "../backend/DesktopServerExposure.ts";
import * as DesktopWindow from "./DesktopWindow.ts";
import * as PreviewManager from "../preview/Manager.ts";

const environmentInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "1.2.3",
  appPath: "/repo",
  isPackaged: false,
  resourcesPath: "/repo/resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

function makeFakeBrowserWindow() {
  const windowListeners = new Map<string, (...args: readonly unknown[]) => void>();
  const webContentsListeners = new Map<string, (...args: readonly unknown[]) => void>();
  let zoomLevel = 0;
  const webContents = {
    copyImageAt: vi.fn(),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    getURL: vi.fn(() => "t3code-dev://app/"),
    getZoomLevel: vi.fn(() => zoomLevel),
    getZoomFactor: vi.fn(() => 1.2 ** zoomLevel),
    setZoomLevel: vi.fn((level: number) => {
      zoomLevel = level;
    }),
    isLoadingMainFrame: vi.fn(() => false),
    on: vi.fn((eventName: string, listener: (...args: readonly unknown[]) => void) => {
      webContentsListeners.set(eventName, listener);
    }),
    once: vi.fn<(eventName: string, listener: (...args: readonly unknown[]) => void) => void>(),
    openDevTools: vi.fn(),
    reload: vi.fn(),
    replaceMisspelling: vi.fn(),
    send: vi.fn(),
    setBackgroundThrottling: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  };

  const window = {
    close: vi.fn(),
    focus: vi.fn(),
    getBounds: vi.fn(() => ({ x: 0, y: 0, width: 1100, height: 780 })),
    getNormalBounds: vi.fn(() => ({ x: 0, y: 0, width: 1100, height: 780 })),
    isDestroyed: vi.fn(() => false),
    isFullScreen: vi.fn(() => false),
    isMaximized: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    loadURL: vi.fn(() => Promise.resolve()),
    maximize: vi.fn(),
    on: vi.fn((eventName: string, listener: (...args: readonly unknown[]) => void) => {
      windowListeners.set(eventName, listener);
    }),
    once: vi.fn((eventName: string, listener: (...args: readonly unknown[]) => void) => {
      windowListeners.set(eventName, listener);
    }),
    restore: vi.fn(),
    setBackgroundColor: vi.fn(),
    setAutoHideCursor: vi.fn(),
    setFullScreen: vi.fn(),
    setOpacity: vi.fn(),
    setTitle: vi.fn(),
    setTitleBarOverlay: vi.fn(),
    setWindowButtonPosition: vi.fn(),
    show: vi.fn(),
    webContents,
  };

  return {
    window: window as unknown as Electron.BrowserWindow,
    getBounds: window.getBounds,
    getNormalBounds: window.getNormalBounds,
    isDestroyed: window.isDestroyed,
    isFullScreen: window.isFullScreen,
    isMaximized: window.isMaximized,
    isMinimized: window.isMinimized,
    loadURL: window.loadURL,
    maximize: window.maximize,
    openDevTools: webContents.openDevTools,
    reload: webContents.reload,
    send: webContents.send,
    setZoomLevel: webContents.setZoomLevel,
    setWindowButtonPosition: window.setWindowButtonPosition,
    setBackgroundThrottling: webContents.setBackgroundThrottling,
    setAutoHideCursor: window.setAutoHideCursor,
    setFullScreen: window.setFullScreen,
    setOpacity: window.setOpacity,
    webContentsListeners,
    webContentsOnce: webContents.once,
    windowListeners,
  };
}

const desktopClientSettingsLayer = Layer.mock(DesktopClientSettings.DesktopClientSettings)({
  get: Effect.succeedNone,
});

const electronAppLayer = Layer.mock(ElectronApp.ElectronApp)({
  quit: Effect.void,
});

const desktopAssetsLayer = Layer.succeed(DesktopAssets.DesktopAssets, {
  iconPaths: Effect.succeed({
    ico: Option.none<string>(),
    icns: Option.none<string>(),
    png: Option.none<string>(),
  }),
  resolveResourcePath: () => Effect.succeed(Option.none<string>()),
} satisfies DesktopAssets.DesktopAssets["Service"]);

const desktopServerExposureLayer = Layer.succeed(DesktopServerExposure.DesktopServerExposure, {
  getState: Effect.die("unexpected getState"),
  backendConfig: Effect.succeed({
    port: 3773,
    bindHost: "127.0.0.1",
    httpBaseUrl: new URL("http://127.0.0.1:3773"),
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
  }),
  configureFromSettings: () => Effect.die("unexpected configureFromSettings"),
  setMode: () => Effect.die("unexpected setMode"),
  setTailscaleServeEnabled: () => Effect.die("unexpected setTailscaleServeEnabled"),
  getAdvertisedEndpoints: Effect.die("unexpected getAdvertisedEndpoints"),
} satisfies DesktopServerExposure.DesktopServerExposure["Service"]);

const electronMenuLayer = Layer.succeed(ElectronMenu.ElectronMenu, {
  setApplicationMenu: () => Effect.void,
  popupTemplate: () => Effect.void,
  showContextMenu: () => Effect.succeedNone,
} satisfies ElectronMenu.ElectronMenu["Service"]);

const electronThemeLayer = Layer.succeed(ElectronTheme.ElectronTheme, {
  shouldUseDarkColors: Effect.succeed(false),
  setSource: () => Effect.void,
  onUpdated: () => Effect.void,
} satisfies ElectronTheme.ElectronTheme["Service"]);

const desktopEnvironmentLayer = DesktopEnvironment.layer(environmentInput).pipe(
  Layer.provide(
    Layer.mergeAll(
      NodeServices.layer,
      DesktopConfig.layerTest({
        T3CODE_PORT: "3773",
        VITE_DEV_SERVER_URL: "http://127.0.0.1:5733",
      }),
    ),
  ),
);

const desktopWindowBoundsEquivalence = Schema.toEquivalence(
  DesktopAppSettings.DesktopWindowBoundsSchema,
);

function makeTestLayer(input: {
  readonly window: Electron.BrowserWindow;
  readonly createCount: Ref.Ref<number>;
  readonly mainWindow: Ref.Ref<Option.Option<Electron.BrowserWindow>>;
  readonly createdWindowOptions?: Electron.BrowserWindowConstructorOptions[];
  readonly desktopSettings?: DesktopAppSettings.DesktopSettings;
  readonly mainWindowBoundsUpdates?: DesktopAppSettings.DesktopWindowBounds[];
  readonly mainWindowMaximizedUpdates?: boolean[];
  readonly beforeMainWindowBoundsUpdate?: (
    bounds: DesktopAppSettings.DesktopWindowBounds,
  ) => Effect.Effect<void>;
  readonly openedExternalUrls?: unknown[];
  readonly copiedTexts?: string[];
  readonly onPopupTemplate?: (input: ElectronMenu.ElectronMenuTemplateInput) => Effect.Effect<void>;
  readonly previewZoomReapplies?: number[];
  readonly onReveal?: (window: Electron.BrowserWindow) => void;
}) {
  let desktopSettings = input.desktopSettings ?? DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS;
  const desktopAppSettingsLayer = Layer.succeed(DesktopAppSettings.DesktopAppSettings, {
    get: Effect.sync(() => desktopSettings),
    load: Effect.sync(() => desktopSettings),
    setMainWindowBounds: (bounds, isMaximized) =>
      Effect.gen(function* () {
        if (input.beforeMainWindowBoundsUpdate) {
          yield* input.beforeMainWindowBoundsUpdate(bounds);
        }
        const changed =
          desktopSettings.mainWindowBounds === null ||
          !desktopWindowBoundsEquivalence(desktopSettings.mainWindowBounds, bounds) ||
          desktopSettings.mainWindowMaximized !== isMaximized;
        if (changed) {
          desktopSettings = {
            ...desktopSettings,
            mainWindowBounds: bounds,
            mainWindowMaximized: isMaximized,
          };
          input.mainWindowBoundsUpdates?.push(bounds);
          input.mainWindowMaximizedUpdates?.push(isMaximized);
        }
        return { settings: desktopSettings, changed };
      }),
    setServerExposureMode: () => Effect.die("unexpected server exposure update"),
    setTailscaleServe: () => Effect.die("unexpected Tailscale Serve update"),
    setUpdateChannel: () => Effect.die("unexpected update channel change"),
    setWslBackendEnabled: () => Effect.die("unexpected WSL backend toggle"),
    setWslDistro: () => Effect.die("unexpected WSL distro change"),
    setWslOnly: () => Effect.die("unexpected WSL-only toggle"),
    setLocalEnvironmentEnabled: () => Effect.die("unexpected local environment toggle"),
    applyWslWindowsFallback: Effect.die("unexpected WSL Windows fallback"),
    applyWslWindowsFallbackInMemory: Effect.die("unexpected WSL Windows fallback"),
  } satisfies DesktopAppSettings.DesktopAppSettings["Service"]);

  const electronWindowLayer = Layer.succeed(ElectronWindow.ElectronWindow, {
    create: (options) =>
      Effect.sync(() => {
        input.createdWindowOptions?.push(options);
      }).pipe(
        Effect.andThen(Ref.update(input.createCount, (count) => count + 1)),
        Effect.as(input.window),
      ),
    main: Ref.get(input.mainWindow),
    currentMainOrFirst: Ref.get(input.mainWindow),
    focusedMainOrFirst: Ref.get(input.mainWindow),
    setMain: (window) => Ref.set(input.mainWindow, Option.some(window)),
    clearMain: () => Ref.set(input.mainWindow, Option.none()),
    prepareReveal: () => Effect.succeed(false),
    reveal: (window) => Effect.sync(() => input.onReveal?.(window)),
    sendAll: () => Effect.void,
    destroyAll: Effect.void,
    syncAllAppearance: (sync) => sync(input.window),
  } satisfies ElectronWindow.ElectronWindow["Service"]);

  return DesktopWindow.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        desktopAssetsLayer,
        desktopEnvironmentLayer,
        desktopAppSettingsLayer,
        desktopClientSettingsLayer,
        desktopServerExposureLayer,
        DesktopState.layer,
        electronAppLayer,
        Layer.succeed(ElectronMenu.ElectronMenu, {
          setApplicationMenu: () => Effect.void,
          showContextMenu: () => Effect.succeedNone,
          popupTemplate: input.onPopupTemplate ?? (() => Effect.void),
        }),
        Layer.succeed(ElectronShell.ElectronShell, {
          openExternal: (url) =>
            Effect.sync(() => {
              input.openedExternalUrls?.push(url);
              return true;
            }),
          openSystemSettings: () => Effect.succeed(true),
          copyText: (text) =>
            Effect.sync(() => {
              input.copiedTexts?.push(text);
            }),
        } satisfies ElectronShell.ElectronShell["Service"]),
        electronThemeLayer,
        electronWindowLayer,
        Layer.mock(PreviewManager.PreviewManager)({
          getBrowserSession: () => Effect.succeed({} as Electron.Session),
          setMainWindow: () => Effect.void,
          isBrowserPartition: (partition) => partition.startsWith("persist:t3code-preview-"),
          getBrowserPartition: () => Effect.succeed("persist:t3code-preview-test"),
          reapplyZoom: () =>
            Effect.sync(() => {
              input.previewZoomReapplies?.push(input.window.webContents.getZoomLevel());
            }),
        }),
      ),
    ),
  );
}

// Builds a DesktopWindow over a fake ElectronWindow whose `create` returns the
// given outcomes in order (null => simulated open failure), and whose
// currentMainOrFirst mirrors the real fallback to the first live window (the
// splash, before any main is registered). Reveal targets are recorded so tests
// can assert what activation actually surfaced.
const makeSplashScenario = (createOutcomes: readonly (Electron.BrowserWindow | null)[]) =>
  Effect.gen(function* () {
    const createdWindows = yield* Ref.make<Electron.BrowserWindow[]>([]);
    const createCalls = yield* Ref.make(0);
    const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
    const revealedWindows = yield* Ref.make<Electron.BrowserWindow[]>([]);
    const fallbackWindow = createOutcomes.find(
      (window): window is Electron.BrowserWindow => window !== null,
    );

    const currentMainOrFirst = Effect.gen(function* () {
      const registered = yield* Ref.get(mainWindow);
      if (Option.isSome(registered)) {
        return registered;
      }
      const created = yield* Ref.get(createdWindows);
      return Option.fromNullishOr(created[0] ?? null);
    });

    const electronWindowShape = {
      create: () =>
        Effect.gen(function* () {
          const index = yield* Ref.getAndUpdate(createCalls, (count) => count + 1);
          const outcome = createOutcomes[index] ?? null;
          if (outcome === null) {
            return yield* new ElectronWindow.ElectronWindowCreateError({
              options: {
                title: null,
                width: null,
                height: null,
                minWidth: null,
                minHeight: null,
                show: null,
                modal: null,
                frame: null,
                transparent: null,
                backgroundColor: null,
                webPreferences: {
                  preload: null,
                  partition: null,
                  backgroundThrottling: null,
                  sandbox: null,
                  contextIsolation: null,
                  nodeIntegration: null,
                  webviewTag: null,
                },
              },
              cause: new Error("simulated window-open failure"),
            });
          }
          yield* Ref.update(createdWindows, (windows) => [...windows, outcome]);
          return outcome;
        }),
      main: Ref.get(mainWindow),
      currentMainOrFirst,
      focusedMainOrFirst: currentMainOrFirst,
      setMain: (window) => Ref.set(mainWindow, Option.some(window)),
      clearMain: () => Ref.set(mainWindow, Option.none()),
      prepareReveal: () => Effect.succeed(false),
      reveal: (window) => Ref.update(revealedWindows, (windows) => [...windows, window]),
      sendAll: () => Effect.void,
      destroyAll: Effect.void,
      syncAllAppearance: (sync) => (fallbackWindow ? sync(fallbackWindow) : Effect.void),
    } satisfies ElectronWindow.ElectronWindow["Service"];

    const layer = DesktopWindow.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          desktopAssetsLayer,
          desktopEnvironmentLayer,
          DesktopAppSettings.layerTest(),
          desktopClientSettingsLayer,
          desktopServerExposureLayer,
          electronAppLayer,
          electronMenuLayer,
          Layer.succeed(ElectronShell.ElectronShell, {
            openExternal: () => Effect.succeed(true),
            openSystemSettings: () => Effect.succeed(true),
            copyText: () => Effect.void,
          } satisfies ElectronShell.ElectronShell["Service"]),
          electronThemeLayer,
          Layer.succeed(ElectronWindow.ElectronWindow, electronWindowShape),
          Layer.mock(PreviewManager.PreviewManager)({
            getBrowserSession: () => Effect.succeed({} as Electron.Session),
            setMainWindow: () => Effect.void,
            isBrowserPartition: (partition) => partition.startsWith("persist:t3code-preview-"),
            getBrowserPartition: () => Effect.succeed("persist:t3code-preview-test"),
          }),
        ),
      ),
    );

    return { layer, createCalls, mainWindow, revealedWindows } as const;
  });

const captureOne = DesktopSnapShotId.make("11111111-1111-4111-8111-111111111111");
const captureTwo = DesktopSnapShotId.make("22222222-2222-4222-8222-222222222222");

describe("DesktopWindow", () => {
  it("leaves fullscreen before concealing a pending quit", () => {
    const fakeWindow = makeFakeBrowserWindow();

    DesktopWindow.concealPendingQuitWindow(fakeWindow.window);
    assert.deepEqual(fakeWindow.setOpacity.mock.calls, [[0]]);

    fakeWindow.setOpacity.mockClear();
    fakeWindow.isFullScreen.mockReturnValue(true);
    DesktopWindow.concealPendingQuitWindow(fakeWindow.window);
    assert.deepEqual(fakeWindow.setFullScreen.mock.calls, [[false]]);
    assert.deepEqual(fakeWindow.setOpacity.mock.calls, [[0]]);

    fakeWindow.setOpacity.mockClear();
    fakeWindow.isFullScreen.mockReturnValue(false);
    fakeWindow.isDestroyed.mockReturnValue(true);
    DesktopWindow.concealPendingQuitWindow(fakeWindow.window);
    assert.equal(fakeWindow.setOpacity.mock.calls.length, 0);
  });

  it("restores bounds only when the window fits within a connected display", () => {
    const persistedBounds = { x: 2040, y: 80, width: 1320, height: 880 };
    const displays = [
      { x: 0, y: 0, width: 1920, height: 1080 },
      { x: 1920, y: 0, width: 2560, height: 1440 },
    ];

    assert.deepEqual(
      DesktopWindow.resolveInitialMainWindowBounds(persistedBounds, displays),
      persistedBounds,
    );
    assert.deepEqual(
      DesktopWindow.resolveInitialMainWindowBounds(persistedBounds, [displays[0]!]),
      DesktopAppSettings.DEFAULT_MAIN_WINDOW_SIZE,
    );
  });

  it("recognizes only same-origin renderer navigations", () => {
    assert.isTrue(
      DesktopWindow.isSameOriginRendererNavigation({
        applicationUrl: "t3code://app/",
        navigationUrl: "t3code://app/settings/connections",
      }),
    );
    assert.isFalse(
      DesktopWindow.isSameOriginRendererNavigation({
        applicationUrl: "t3code://app/",
        navigationUrl: "https://accounts.microsoft.com/oauth",
      }),
    );
    assert.isFalse(
      DesktopWindow.isSameOriginRendererNavigation({
        applicationUrl: "t3code://app/",
        navigationUrl: "not a url",
      }),
    );
  });

  it.effect("does not open a development window until the backend is ready", () =>
    Effect.gen(function* () {
      const fakeWindow = makeFakeBrowserWindow();
      const createCount = yield* Ref.make(0);
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
      const createdWindowOptions: Electron.BrowserWindowConstructorOptions[] = [];
      const layer = makeTestLayer({
        window: fakeWindow.window,
        createCount,
        mainWindow,
        createdWindowOptions,
      });

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        yield* desktopWindow.activate;
        assert.equal(yield* Ref.get(createCount), 0);

        yield* desktopWindow.handleBackendReady(new URL("http://127.0.0.1:3773"));
        assert.equal(yield* Ref.get(createCount), 1);
        assert.equal(createdWindowOptions[0]?.width, 1100);
        assert.equal(createdWindowOptions[0]?.height, 780);
        assert.isUndefined(createdWindowOptions[0]?.x);
        assert.isUndefined(createdWindowOptions[0]?.y);
        assert.isTrue(createdWindowOptions[0]?.disableAutoHideCursor);
        assert.isFalse(createdWindowOptions[0]?.webPreferences?.backgroundThrottling);
        assert.deepEqual(fakeWindow.setAutoHideCursor.mock.calls, [[false]]);
        assert.deepEqual(fakeWindow.loadURL.mock.calls[0], ["t3code-dev://app/"]);
        assert.equal(fakeWindow.openDevTools.mock.calls.length, 1);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect(
    "opens and reopens the window without backend readiness when local execution is disabled",
    () =>
      Effect.gen(function* () {
        const fakeWindow = makeFakeBrowserWindow();
        const createCount = yield* Ref.make(0);
        const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
        const layer = makeTestLayer({
          window: fakeWindow.window,
          createCount,
          mainWindow,
          createdWindowOptions: [],
          desktopSettings: {
            ...DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS,
            localEnvironmentEnabled: false,
          },
        });
        yield* Effect.gen(function* () {
          const desktopWindow = yield* DesktopWindow.DesktopWindow;
          yield* desktopWindow.createMainIfBackendReady;
          assert.equal(yield* Ref.get(createCount), 1);
          yield* Ref.set(mainWindow, Option.none());
          yield* desktopWindow.activate;
          assert.equal(yield* Ref.get(createCount), 2);
          yield* Ref.set(mainWindow, Option.none());
          yield* desktopWindow.dispatchMenuAction("new-thread");
          assert.equal(yield* Ref.get(createCount), 3);
        }).pipe(Effect.provide(layer));
      }),
  );

  it.effect("blocks only repeated Cmd+W input before it reaches the native window menu", () =>
    Effect.gen(function* () {
      const fakeWindow = makeFakeBrowserWindow();
      const createCount = yield* Ref.make(0);
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
      const layer = makeTestLayer({
        window: fakeWindow.window,
        createCount,
        mainWindow,
      });

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        yield* desktopWindow.handleBackendReady(new URL("http://127.0.0.1:3773"));

        const beforeInput = fakeWindow.webContentsListeners.get("before-input-event");
        if (!beforeInput) {
          return yield* Effect.die("before-input-event listener was not registered");
        }

        let prevented = false;
        const event = { preventDefault: () => (prevented = true) };
        const input = {
          type: "keyDown",
          isAutoRepeat: true,
          key: "W",
          meta: true,
          control: false,
          alt: false,
          shift: false,
        };
        beforeInput(event, input);
        assert.isTrue(prevented);

        prevented = false;
        beforeInput(event, { ...input, isAutoRepeat: false });
        assert.isFalse(prevented);

        prevented = false;
        beforeInput(event, { ...input, meta: false });
        assert.isFalse(prevented);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("persists the current main window bounds before the window closes", () =>
    Effect.gen(function* () {
      const fakeWindow = makeFakeBrowserWindow();
      fakeWindow.getBounds.mockReturnValue({ x: 240, y: 160, width: 1410, height: 930 });
      const createCount = yield* Ref.make(0);
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
      const mainWindowBoundsUpdates: DesktopAppSettings.DesktopWindowBounds[] = [];
      const writeStarted = yield* Deferred.make<void>();
      const allowWrite = yield* Deferred.make<void>();
      const flushCompleted = yield* Deferred.make<void>();
      const layer = makeTestLayer({
        window: fakeWindow.window,
        createCount,
        mainWindow,
        mainWindowBoundsUpdates,
        beforeMainWindowBoundsUpdate: () =>
          Deferred.succeed(writeStarted, undefined).pipe(
            Effect.andThen(Deferred.await(allowWrite)),
            Effect.asVoid,
          ),
      });

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        yield* desktopWindow.handleBackendReady(new URL("http://127.0.0.1:3773"));

        const close = fakeWindow.windowListeners.get("close");
        if (!close) {
          return yield* Effect.die("window close listener was not registered");
        }
        close();
        yield* Deferred.await(writeStarted);
        fakeWindow.isDestroyed.mockReturnValue(true);

        const flushFiber = yield* desktopWindow.flushMainWindowBounds.pipe(
          Effect.andThen(Deferred.succeed(flushCompleted, undefined)),
          Effect.forkChild({ startImmediately: true }),
        );
        yield* Effect.yieldNow;
        assert.isFalse(yield* Deferred.isDone(flushCompleted));

        yield* Deferred.succeed(allowWrite, undefined);
        yield* Fiber.join(flushFiber);
        assert.isTrue(yield* Deferred.isDone(flushCompleted));

        assert.deepEqual(mainWindowBoundsUpdates, [
          {
            x: 240,
            y: 160,
            width: 1410,
            height: 930,
          },
        ]);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("recovers when the development renderer is temporarily unreachable", () =>
    Effect.gen(function* () {
      const fakeWindow = makeFakeBrowserWindow();
      const createCount = yield* Ref.make(0);
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
      const layer = makeTestLayer({
        window: fakeWindow.window,
        createCount,
        mainWindow,
      });

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        yield* desktopWindow.handleBackendReady(new URL("http://127.0.0.1:3773"));

        const didFailLoad = fakeWindow.webContentsListeners.get("did-fail-load");
        const didFinishLoad = fakeWindow.webContentsListeners.get("did-finish-load");
        if (!didFailLoad || !didFinishLoad) {
          return yield* Effect.die("renderer load listeners were not registered");
        }

        didFailLoad({}, -9, "ERR_UNEXPECTED", "t3code-dev://app/", true);
        assert.equal(fakeWindow.loadURL.mock.calls.length, 1);

        yield* TestClock.adjust(100);
        assert.deepEqual(fakeWindow.loadURL.mock.calls, [
          ["t3code-dev://app/"],
          ["t3code-dev://app/"],
        ]);
        assert.equal(fakeWindow.reload.mock.calls.length, 0);

        didFailLoad({}, -9, "ERR_UNEXPECTED", "t3code-dev://app/", true);
        didFinishLoad();
        yield* TestClock.adjust(250);
        assert.equal(fakeWindow.loadURL.mock.calls.length, 2);
        assert.equal(fakeWindow.reload.mock.calls.length, 0);
      }).pipe(Effect.provide(layer));
    }),
  );

  it("retries only transient failures for the development renderer", () => {
    assert.isTrue(
      DesktopWindow.isRetryableDevelopmentRendererLoadFailure({
        applicationUrl: "t3code-dev://app/",
        errorCode: -102,
        isMainFrame: true,
        validatedUrl: "t3code-dev://app/",
      }),
    );
    assert.isFalse(
      DesktopWindow.isRetryableDevelopmentRendererLoadFailure({
        applicationUrl: "t3code-dev://app/",
        errorCode: -3,
        isMainFrame: true,
        validatedUrl: "t3code-dev://app/",
      }),
    );
    assert.isFalse(
      DesktopWindow.isRetryableDevelopmentRendererLoadFailure({
        applicationUrl: "t3code-dev://app/",
        errorCode: -102,
        isMainFrame: true,
        validatedUrl: "https://example.com/",
      }),
    );
  });

  it.effect("opens safe off-origin renderer navigations in the system browser", () =>
    Effect.gen(function* () {
      const fakeWindow = makeFakeBrowserWindow();
      const createCount = yield* Ref.make(0);
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
      const openedExternalUrls: unknown[] = [];
      const layer = makeTestLayer({
        window: fakeWindow.window,
        createCount,
        mainWindow,
        openedExternalUrls,
      });

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        yield* desktopWindow.handleBackendReady(new URL("http://127.0.0.1:3773"));

        const willNavigate = fakeWindow.webContentsListeners.get("will-navigate");
        if (!willNavigate) {
          return yield* Effect.die("will-navigate listener was not registered");
        }
        let prevented = false;
        willNavigate(
          {
            preventDefault: () => {
              prevented = true;
            },
          },
          "https://accounts.microsoft.com/oauth",
        );
        yield* Effect.promise(() => Promise.resolve());

        assert.isTrue(prevented);
        assert.deepEqual(openedExternalUrls, ["https://accounts.microsoft.com/oauth"]);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect(
    "retries opening the real main on activate when a failed post-readiness open left only the splash",
    () =>
      Effect.gen(function* () {
        const splash = makeFakeBrowserWindow();
        const main = makeFakeBrowserWindow();
        // create #1 -> splash, #2 -> fails (the pool swallows this post-readiness
        // window-open error), #3 -> the real main on activate's retry.
        const scenario = yield* makeSplashScenario([splash.window, null, main.window]);

        yield* Effect.gen(function* () {
          const desktopWindow = yield* DesktopWindow.DesktopWindow;

          // 1. WSL-only boot shows the connecting splash.
          yield* desktopWindow.showConnectingSplash;
          assert.equal(yield* Ref.get(scenario.createCalls), 1);

          // 2. Backend reports ready, but opening the real main fails. The pool
          //    swallows that error in production, so handleBackendReady fails
          //    here without a registered main window -- only the splash is open.
          const readyExit = yield* Effect.exit(
            desktopWindow.handleBackendReady(new URL("http://127.0.0.1:3773")),
          );
          assert.equal(readyExit._tag, "Failure");
          assert.equal(yield* Ref.get(scenario.createCalls), 2);
          assert.isTrue(Option.isNone(yield* Ref.get(scenario.mainWindow)));

          // 3. Activating must not mistake the splash for the main window: it
          //    retries the open and brings up the real main instead of leaving
          //    the user stranded on "Connecting to WSL".
          yield* desktopWindow.activate;
          assert.equal(yield* Ref.get(scenario.createCalls), 3);
          const registeredMain = yield* Ref.get(scenario.mainWindow);
          assert.isTrue(Option.isSome(registeredMain));
          assert.equal(Option.getOrThrow(registeredMain), main.window);
        }).pipe(Effect.provide(scenario.layer));
      }),
  );

  it.effect(
    "re-reveals the connecting splash on activate while the backend is still cold-booting",
    () =>
      Effect.gen(function* () {
        const splash = makeFakeBrowserWindow();
        // Only the splash is ever created; the backend never reports ready.
        const scenario = yield* makeSplashScenario([splash.window]);

        yield* Effect.gen(function* () {
          const desktopWindow = yield* DesktopWindow.DesktopWindow;

          yield* desktopWindow.showConnectingSplash;
          assert.equal(yield* Ref.get(scenario.createCalls), 1);

          // Taskbar/dock activation during cold boot must bring the splash back
          // rather than no-op and leave it hidden until the backend finishes.
          yield* desktopWindow.activate;
          assert.equal(yield* Ref.get(scenario.createCalls), 1);
          assert.deepEqual(yield* Ref.get(scenario.revealedWindows), [splash.window]);
        }).pipe(Effect.provide(scenario.layer));
      }),
  );

  it.effect("does not dispatch menu actions to the splash before the backend is ready", () =>
    Effect.gen(function* () {
      const splash = makeFakeBrowserWindow();
      const main = makeFakeBrowserWindow();
      const scenario = yield* makeSplashScenario([splash.window, main.window]);

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;

        yield* desktopWindow.showConnectingSplash;
        yield* desktopWindow.dispatchMenuAction("open-settings");

        assert.equal(yield* Ref.get(scenario.createCalls), 1);
        assert.equal(splash.send.mock.calls.length, 0);
        assert.equal(main.send.mock.calls.length, 0);
      }).pipe(Effect.provide(scenario.layer));
    }),
  );

  it.effect("dispatches menu actions after backend readiness when no main window exists", () =>
    Effect.gen(function* () {
      const splash = makeFakeBrowserWindow();
      const main = makeFakeBrowserWindow();
      const scenario = yield* makeSplashScenario([splash.window, null, main.window]);

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;

        yield* desktopWindow.showConnectingSplash;
        const readyExit = yield* Effect.exit(
          desktopWindow.handleBackendReady(new URL("http://127.0.0.1:3773")),
        );
        assert.equal(readyExit._tag, "Failure");

        yield* desktopWindow.dispatchMenuAction("open-settings");

        assert.equal(yield* Ref.get(scenario.createCalls), 3);
        assert.deepEqual(main.send.mock.calls, [[MENU_ACTION_CHANNEL, "open-settings"]]);
      }).pipe(Effect.provide(scenario.layer));
    }),
  );

  it.effect("delivers capture completion and late errors without taking focus back", () =>
    Effect.gen(function* () {
      const operations: Array<string> = [];
      let foreground = "Discord";
      const fakeWindow = makeFakeBrowserWindow();
      fakeWindow.send.mockImplementation(() => {
        operations.push("send");
      });
      const createCount = yield* Ref.make(0);
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
      const layer = makeTestLayer({
        window: fakeWindow.window,
        createCount,
        mainWindow,
        onReveal: () => {
          foreground = "T3 Code";
          operations.push("reveal");
        },
      });

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        yield* desktopWindow.handleBackendReady(new URL("http://127.0.0.1:3773"));
        yield* desktopWindow.dispatchSnapShotEvent({ type: "started", id: captureOne });
        assert.equal(foreground, "T3 Code");
        foreground = "Explorer";
        yield* desktopWindow.dispatchSnapShotEvent({ type: "ready", id: captureOne });
        yield* desktopWindow.dispatchSnapShotEvent({ type: "failed", id: captureTwo });

        assert.equal(foreground, "Explorer");
        assert.deepEqual(operations, ["send", "reveal", "send", "send"]);
        assert.deepEqual(fakeWindow.send.mock.calls, [
          [SNAP_SHOT_EVENT_CHANNEL, { type: "started", id: captureOne }],
          [SNAP_SHOT_EVENT_CHANNEL, { type: "ready", id: captureOne }],
          [SNAP_SHOT_EVENT_CHANNEL, { type: "failed", id: captureTwo }],
        ]);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("delivers the renderer event even when the reveal fails", () =>
    Effect.gen(function* () {
      const fakeWindow = makeFakeBrowserWindow();
      const createCount = yield* Ref.make(0);
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
      const layer = makeTestLayer({
        window: fakeWindow.window,
        createCount,
        mainWindow,
        onReveal: () => {
          throw new Error("another process kept the foreground");
        },
      });

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        yield* desktopWindow.handleBackendReady(new URL("http://127.0.0.1:3773"));
        yield* Effect.exit(
          desktopWindow.dispatchSnapShotEvent({ type: "started", id: captureOne }),
        );

        assert.deepEqual(fakeWindow.send.mock.calls, [
          [SNAP_SHOT_EVENT_CHANNEL, { type: "started", id: captureOne }],
        ]);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("leaves a completed capture pending while only the connecting splash exists", () =>
    Effect.gen(function* () {
      const splash = makeFakeBrowserWindow();
      const scenario = yield* makeSplashScenario([splash.window]);

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        yield* desktopWindow.showConnectingSplash;
        yield* desktopWindow.dispatchSnapShotEvent({ type: "ready", id: captureOne });

        assert.equal(yield* Ref.get(scenario.createCalls), 1);
        assert.equal(splash.send.mock.calls.length, 0);
        assert.deepEqual(yield* Ref.get(scenario.revealedWindows), []);
      }).pipe(Effect.provide(scenario.layer));
    }),
  );

  it.effect("does not reopen a closed main window for a completed capture", () =>
    Effect.gen(function* () {
      const fakeWindow = makeFakeBrowserWindow();
      const createCount = yield* Ref.make(0);
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
      const onReveal = vi.fn();
      const layer = makeTestLayer({ window: fakeWindow.window, createCount, mainWindow, onReveal });

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        yield* desktopWindow.handleBackendReady(new URL("http://127.0.0.1:3773"));
        fakeWindow.isDestroyed.mockReturnValue(true);
        yield* Ref.set(mainWindow, Option.none());
        yield* desktopWindow.dispatchSnapShotEvent({ type: "ready", id: captureOne });

        assert.equal(yield* Ref.get(createCount), 1);
        assert.equal(fakeWindow.send.mock.calls.length, 0);
        assert.equal(onReveal.mock.calls.length, 0);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("waits for a loading renderer without foregrounding it when capture is ready", () =>
    Effect.gen(function* () {
      const fakeWindow = makeFakeBrowserWindow();
      const createCount = yield* Ref.make(0);
      const mainWindow = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(
        Option.some(fakeWindow.window),
      );
      const onReveal = vi.fn();
      const layer = makeTestLayer({ window: fakeWindow.window, createCount, mainWindow, onReveal });
      vi.mocked(fakeWindow.window.webContents.isLoadingMainFrame).mockReturnValue(true);

      yield* Effect.gen(function* () {
        const desktopWindow = yield* DesktopWindow.DesktopWindow;
        yield* desktopWindow.dispatchSnapShotEvent({ type: "ready", id: captureOne });
        assert.equal(fakeWindow.send.mock.calls.length, 0);
        const onLoad = fakeWindow.webContentsOnce.mock.calls.find(
          ([event]) => event === "did-finish-load",
        )?.[1];
        assert.isDefined(onLoad);
        onLoad?.();

        assert.deepEqual(fakeWindow.send.mock.calls, [
          [SNAP_SHOT_EVENT_CHANNEL, { type: "ready", id: captureOne }],
        ]);
        assert.equal(onReveal.mock.calls.length, 0);
        assert.equal(yield* Ref.get(createCount), 0);
      }).pipe(Effect.provide(layer));
    }),
  );
});
