import { afterEach, describe, expect, it, vi } from "vite-plus/test";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("managed DevPC preview URLs", () => {
  it("fills the managed port template and preserves the requested path", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    vi.stubGlobal("window", {
      location: { origin: "https://app.example.test" },
      __DEVPC_MANAGED_BOOTSTRAP__: {
        managed: true,
        state: "ready",
        ready: true,
        previewUrlTemplate: "https://{port}.preview.example.test/",
      },
    });

    const { resolveManagedPreviewUrl } = await import("./managedDevPc");
    expect(resolveManagedPreviewUrl(5173, "/assets/app.js?x=1")).toBe(
      "https://5173.preview.example.test/assets/app.js?x=1",
    );
  });
});

describe("managed DevPC paused bootstrap", () => {
  it("requires an explicit resume for every paused bootstrap representation", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const {
      isManagedBootstrapRunning,
      isManagedResumeTransition,
      requiresManagedResume,
      shouldPromptManagedResume,
    } = await import("./managedDevPc");
    const base = {
      managed: true as const,
      state: "ready" as const,
      ready: false,
      previewUrlTemplate: "https://{port}.preview.example.test/",
    };

    expect(requiresManagedResume({ ...base, requiresResume: true })).toBe(true);
    expect(requiresManagedResume({ ...base, status: "paused" })).toBe(true);
    expect(requiresManagedResume({ ...base, state: "paused" })).toBe(true);
    expect(requiresManagedResume({ ...base, status: "stopped" })).toBe(true);
    expect(requiresManagedResume({ ...base, state: "stopped" })).toBe(true);
    expect(requiresManagedResume({ ...base, status: "starting" })).toBe(false);
    expect(
      requiresManagedResume({
        ...base,
        state: "stopped",
        status: "restoring",
        requiresResume: true,
      }),
    ).toBe(false);
    expect(
      requiresManagedResume({
        ...base,
        state: "stopped",
        status: "attention",
        requiresResume: true,
      }),
    ).toBe(false);
    expect(shouldPromptManagedResume({ ...base, status: "stopped" }, false)).toBe(true);
    expect(shouldPromptManagedResume({ ...base, status: "stopped" }, true)).toBe(false);
    expect(isManagedBootstrapRunning({ ...base, ready: true, status: "starting" })).toBe(false);
    expect(isManagedBootstrapRunning({ ...base, ready: true, status: "running" })).toBe(true);
    expect(isManagedBootstrapRunning({ ...base, ready: true })).toBe(true);
    expect(isManagedResumeTransition({ ...base, state: "stopped", status: "starting" })).toBe(true);
    expect(isManagedResumeTransition({ ...base, state: "stopped", status: "restoring" })).toBe(
      true,
    );
    expect(isManagedResumeTransition({ ...base, state: "starting", status: "attention" })).toBe(
      false,
    );
  });

  it("maps live lifecycle snapshots to honest wake stages", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const { managedWakePhase } = await import("./managedDevPc");
    const base = {
      managed: true as const,
      state: "starting" as const,
      ready: false,
      previewUrlTemplate: "https://{port}.preview.example.test/",
    };

    expect(managedWakePhase({ ...base, status: "restoring", connected: false })).toBe("machine");
    expect(managedWakePhase({ ...base, status: "reconnecting", connected: false })).toBe(
      "connection",
    );
    expect(managedWakePhase({ ...base, status: "starting", connected: true })).toBe("connection");
    expect(
      managedWakePhase({
        ...base,
        state: "ready",
        status: "running",
        ready: true,
        connected: true,
      }),
    ).toBe("workspace");
  });

  it("sets expectations and acknowledges a delayed wake without inventing a percent", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const { managedWakePresentation } = await import("./managedDevPc");

    expect(managedWakePresentation("machine", 5_000)).toMatchObject({
      title: "Waking your workspace",
      timing: "Usually ready in about a minute",
      delayed: false,
    });
    expect(managedWakePresentation("connection", 24_900)).toMatchObject({
      title: "Connecting securely",
      timing: "Still working · 24s elapsed",
      delayed: false,
    });
    expect(managedWakePresentation("workspace", 76_200)).toMatchObject({
      title: "Opening your workspace",
      timing: "Taking longer than usual · 76s elapsed",
      delayed: true,
    });
  });

  it("re-prompts when an accepted resume remains ineffective", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const { shouldRepromptManagedResume } = await import("./managedDevPc");

    expect(shouldRepromptManagedResume(true, 39)).toBe(false);
    expect(shouldRepromptManagedResume(true, 40)).toBe(true);
    expect(shouldRepromptManagedResume(false, 40)).toBe(false);
  });

  it("clears a completed persisted pause before bootstrap resumes it", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const removeItem = vi.fn();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn(() => JSON.stringify({ action: "pause" })),
        removeItem,
      },
      dispatchEvent,
    });
    const { clearCompletedPauseAction } = await import("./managedDevPc");

    clearCompletedPauseAction({
      managed: true,
      state: "paused",
      status: "paused",
      ready: false,
      previewUrlTemplate: "https://{port}.preview.example.test/",
    });

    expect(removeItem).toHaveBeenCalledWith("devpc-managed-workspace-action");
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "devpc-managed-workspace-action-cleared",
        detail: { action: "pause" },
      }),
    );
  });

  it("clears a persisted restart after bootstrap observes progress and completion", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    let stored = JSON.stringify({
      action: "restart",
      phase: "pending",
      idempotencyKey: "restart-persisted-key",
      progressObserved: false,
      restartConfirmations: 0,
    });
    const removeItem = vi.fn(() => {
      stored = "";
    });
    const setItem = vi.fn((_key: string, value: string) => {
      stored = value;
    });
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn(() => stored || null),
        setItem,
        removeItem,
      },
      dispatchEvent,
    });
    const { reconcileBootstrapLifecycleAction } = await import("./managedDevPc");

    reconcileBootstrapLifecycleAction({
      managed: true,
      state: "restarting",
      status: "restarting",
      ready: false,
      previewUrlTemplate: "https://{port}.preview.example.test/",
    });
    expect(setItem).toHaveBeenCalledWith(
      "devpc-managed-workspace-action",
      expect.stringContaining('"progressObserved":true'),
    );

    reconcileBootstrapLifecycleAction({
      managed: true,
      state: "ready",
      status: "restarting",
      ready: true,
      previewUrlTemplate: "https://{port}.preview.example.test/",
    });
    expect(removeItem).not.toHaveBeenCalled();

    reconcileBootstrapLifecycleAction({
      managed: true,
      state: "ready",
      status: "running",
      ready: true,
      previewUrlTemplate: "https://{port}.preview.example.test/",
    });
    expect(removeItem).not.toHaveBeenCalled();

    reconcileBootstrapLifecycleAction({
      managed: true,
      state: "ready",
      status: "running",
      ready: true,
      previewUrlTemplate: "https://{port}.preview.example.test/",
    });
    expect(removeItem).toHaveBeenCalledWith("devpc-managed-workspace-action");
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { action: "restart" },
      }),
    );
  });

  it("retires persisted restart recovery when the workspace now requires resume", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const removeItem = vi.fn();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn(() =>
          JSON.stringify({
            action: "restart",
            phase: "uncertain",
            idempotencyKey: "restart-obsolete-key",
            progressObserved: true,
            restartConfirmations: 0,
          }),
        ),
        removeItem,
      },
      dispatchEvent,
    });
    const { reconcileBootstrapLifecycleAction } = await import("./managedDevPc");

    reconcileBootstrapLifecycleAction({
      managed: true,
      state: "ready",
      status: "paused",
      ready: false,
      requiresResume: true,
      previewUrlTemplate: "https://{port}.preview.example.test/",
    });

    expect(removeItem).toHaveBeenCalledWith("devpc-managed-workspace-action");
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { action: "restart" },
      }),
    );
  });

  it("hydrates bootstrap resume recovery from the persisted idempotency key", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn(() =>
          JSON.stringify({
            action: "resume",
            phase: "uncertain",
            idempotencyKey: "resume-persisted-key",
            progressObserved: false,
            restartConfirmations: 0,
          }),
        ),
      },
    });
    const { ownsPersistedManagedResume, readPersistedManagedResume } =
      await import("./managedDevPc");

    expect(readPersistedManagedResume()).toEqual({
      requestKey: "resume-persisted-key",
      accepted: false,
      uncertain: true,
    });
    expect(ownsPersistedManagedResume("resume-persisted-key")).toBe(true);
    expect(ownsPersistedManagedResume("resume-newer-key")).toBe(false);
  });

  it("does not reclaim a persisted resume after a newer shared action was cleared", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    let resolveStart!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveStart = resolve;
          }),
      ),
    );

    const { requestManagedResume } = await import("./managedDevPc");
    const resume = requestManagedResume("resume-old-key");
    await vi.waitFor(() => expect(storage.has("devpc-managed-workspace-action")).toBe(true));

    storage.set(
      "devpc-managed-workspace-action",
      JSON.stringify({ action: "pause", idempotencyKey: "pause-newer-key" }),
    );
    storage.delete("devpc-managed-workspace-action");
    resolveStart(Response.json({ state: "starting" }));

    await expect(resume).resolves.toBe("superseded");
    expect(storage.has("devpc-managed-workspace-action")).toBe(false);
  });

  it("keeps in-memory resume ownership when shared storage is unavailable from the outset", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(() => {
          throw new Error("storage unavailable");
        }),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ state: "starting" })),
    );

    const { ownsPersistedManagedResume, requestManagedResume } = await import("./managedDevPc");

    await expect(requestManagedResume("resume-private-key")).resolves.toBe("accepted");
    expect(ownsPersistedManagedResume("resume-private-key")).toBe(true);
  });

  it("preserves the persisted resume key while bootstrap reports transition progress", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const storage = new Map([
      [
        "devpc-managed-workspace-action",
        JSON.stringify({
          action: "resume",
          phase: "uncertain",
          idempotencyKey: "resume-transition-key",
          progressObserved: false,
          restartConfirmations: 0,
        }),
      ],
    ]);
    const observedKeys: Array<string | undefined> = [];
    vi.stubGlobal("document", {
      getElementById: vi.fn(() => null),
    });
    vi.stubGlobal("window", {
      location: { hash: "" },
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      dispatchEvent: vi.fn(),
      setTimeout: (callback: () => void) => {
        const stored = JSON.parse(storage.get("devpc-managed-workspace-action") ?? "null") as {
          idempotencyKey?: string;
        } | null;
        observedKeys.push(stored?.idempotencyKey);
        callback();
        return 1;
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          managed: true,
          state: "stopped",
          status: "starting",
          ready: false,
          previewUrlTemplate: "https://{port}.preview.example.test/",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          managed: true,
          state: "ready",
          status: "running",
          ready: true,
          previewUrlTemplate: "https://{port}.preview.example.test/",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { prepareManagedDevPc } = await import("./managedDevPc");
    await prepareManagedDevPc();

    expect(observedKeys[0]).toBe("resume-transition-key");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("continues polling when the resume surface has no root element to mount into", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    vi.stubGlobal("document", {
      getElementById: vi.fn(() => null),
    });
    vi.stubGlobal("window", {
      location: { hash: "" },
      setTimeout: (callback: () => void) => {
        callback();
        return 1;
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          managed: true,
          state: "stopped",
          status: "stopped",
          ready: false,
          previewUrlTemplate: "https://{port}.preview.example.test/",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          managed: true,
          state: "ready",
          status: "running",
          ready: true,
          previewUrlTemplate: "https://{port}.preview.example.test/",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { prepareManagedDevPc } = await import("./managedDevPc");
    await prepareManagedDevPc();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps polling while a resume prompt is open in another tab", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const makeElement = () => ({
      className: "",
      textContent: "",
      type: "",
      disabled: false,
      classList: { add: vi.fn(), remove: vi.fn() },
      append: vi.fn(),
      replaceChildren: vi.fn(),
      addEventListener: vi.fn(),
      focus: vi.fn(),
    });
    const root = makeElement();
    vi.stubGlobal("document", {
      getElementById: vi.fn(() => root),
      createElement: vi.fn(() => makeElement()),
    });
    vi.stubGlobal("window", {
      location: { hash: "" },
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      setTimeout: (callback: () => void) => {
        callback();
        return 1;
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          managed: true,
          state: "stopped",
          status: "stopped",
          ready: false,
          previewUrlTemplate: "https://{port}.preview.example.test/",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          managed: true,
          state: "ready",
          status: "running",
          ready: true,
          previewUrlTemplate: "https://{port}.preview.example.test/",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { prepareManagedDevPc } = await import("./managedDevPc");
    await prepareManagedDevPc();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("continues bootstrap polling when an accepted resume response may have been lost", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    type Listener = () => void;
    const makeElement = () => {
      let click: Listener | undefined;
      return {
        className: "",
        textContent: "",
        type: "",
        disabled: false,
        classList: { add: vi.fn(), remove: vi.fn() },
        append: vi.fn(),
        replaceChildren: vi.fn(),
        addEventListener: (_type: string, listener: Listener) => {
          click = listener;
        },
        focus: () => queueMicrotask(() => click?.()),
      };
    };
    const root = makeElement();
    vi.stubGlobal("document", {
      getElementById: vi.fn(() => root),
      createElement: vi.fn(() => makeElement()),
    });
    vi.stubGlobal("window", {
      location: { hash: "" },
      setTimeout: (callback: () => void) => {
        callback();
        return 1;
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          managed: true,
          state: "stopped",
          status: "stopped",
          ready: false,
          previewUrlTemplate: "https://{port}.preview.example.test/",
        }),
      )
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(
        Response.json({
          managed: true,
          state: "stopped",
          status: "stopped",
          ready: false,
          previewUrlTemplate: "https://{port}.preview.example.test/",
        }),
      )
      .mockResolvedValueOnce(Response.json({ state: "starting" }))
      .mockResolvedValueOnce(
        Response.json({
          managed: true,
          state: "ready",
          status: "running",
          ready: true,
          previewUrlTemplate: "https://{port}.preview.example.test/",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { prepareManagedDevPc } = await import("./managedDevPc");
    await prepareManagedDevPc();

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/_devpc/workspace/start");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/_devpc/workspace/start");
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.headers).toEqual(
      (fetchMock.mock.calls[3]?.[1] as RequestInit | undefined)?.headers,
    );
  });

  it("lets the user retry a definitively rejected resume with the same key", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    type Listener = () => void;
    let resumeClick: Listener | undefined;
    const makeElement = () => {
      return {
        className: "",
        textContent: "",
        type: "",
        disabled: false,
        classList: {
          add: vi.fn(),
          remove: vi.fn(() => queueMicrotask(() => resumeClick?.())),
        },
        append: vi.fn(),
        replaceChildren: vi.fn(),
        addEventListener: (_type: string, listener: Listener) => {
          resumeClick = listener;
        },
        focus: () => queueMicrotask(() => resumeClick?.()),
      };
    };
    const root = makeElement();
    vi.stubGlobal("document", {
      getElementById: vi.fn(() => root),
      createElement: vi.fn(() => makeElement()),
    });
    vi.stubGlobal("window", {
      location: { hash: "" },
      setTimeout: (callback: () => void) => {
        callback();
        return 1;
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          managed: true,
          state: "stopped",
          status: "stopped",
          ready: false,
          previewUrlTemplate: "https://{port}.preview.example.test/",
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ state: "starting" }))
      .mockResolvedValueOnce(
        Response.json({
          managed: true,
          state: "ready",
          status: "running",
          ready: true,
          previewUrlTemplate: "https://{port}.preview.example.test/",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { prepareManagedDevPc } = await import("./managedDevPc");
    await prepareManagedDevPc();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/_devpc/workspace/start");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/_devpc/workspace/start");
    const firstHeaders = (fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.headers as
      | Record<string, string>
      | undefined;
    const retryHeaders = (fetchMock.mock.calls[2]?.[1] as RequestInit | undefined)?.headers as
      | Record<string, string>
      | undefined;
    expect(firstHeaders?.["idempotency-key"]).toMatch(/^resume-/);
    expect(retryHeaders?.["idempotency-key"]).toBe(firstHeaders?.["idempotency-key"]);
  });
});

describe("managed DevPC WebSocket authorization", () => {
  it("replaces a T3 ticket with a fresh same-origin gateway ticket", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    vi.stubGlobal("window", {
      location: { origin: "https://app.example.test" },
    });
    const fetchMock = vi.fn(async () =>
      Response.json({ ticket: "gateway-ticket-that-is-long-enough" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { prepareManagedWebSocketUrl } = await import("./managedDevPc");
    const resolved = await prepareManagedWebSocketUrl(
      "wss://app.example.test/ws?wsTicket=local-one-time-ticket",
    );

    expect(resolved).toBe(
      "wss://app.example.test/ws?gatewayTicket=gateway-ticket-that-is-long-enough",
    );
    expect(fetchMock).toHaveBeenCalledWith("/_devpc/ws-ticket", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: "{}",
    });
  });

  it("requests a new ticket for every connection attempt", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    vi.stubGlobal("window", {
      location: { origin: "https://app.example.test" },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ticket: "first-gateway-ticket-credential" }))
      .mockResolvedValueOnce(Response.json({ ticket: "second-gateway-ticket-credential" }));
    vi.stubGlobal("fetch", fetchMock);

    const { prepareManagedWebSocketUrl } = await import("./managedDevPc");
    const first = await prepareManagedWebSocketUrl("wss://app.example.test/ws");
    const second = await prepareManagedWebSocketUrl("wss://app.example.test/ws");

    expect(first).toContain("gatewayTicket=first-gateway-ticket-credential");
    expect(second).toContain("gatewayTicket=second-gateway-ticket-credential");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses an authorized direct relay URL when the managed gateway provides one", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    vi.stubGlobal("window", {
      location: { origin: "https://app.example.test" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ticket: "t3-websocket-ticket-that-is-long-enough",
          websocketUrl: "wss://relay.example.test/v1/t3/ws",
        }),
      ),
    );

    const { prepareManagedWebSocketUrl } = await import("./managedDevPc");
    await expect(prepareManagedWebSocketUrl("wss://app.example.test/ws")).resolves.toBe(
      "wss://relay.example.test/v1/t3/ws?wsTicket=t3-websocket-ticket-that-is-long-enough",
    );
  });

  it("rejects a managed relay URL with a non-WebSocket protocol", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    vi.stubGlobal("window", {
      location: { origin: "https://app.example.test" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ticket: "t3-websocket-ticket-that-is-long-enough",
          websocketUrl: "https://relay.example.test/v1/t3/ws",
        }),
      ),
    );

    const { prepareManagedWebSocketUrl } = await import("./managedDevPc");
    await expect(prepareManagedWebSocketUrl("wss://app.example.test/ws")).rejects.toThrow(
      "invalid WebSocket URL",
    );
  });

  it.each([401, 403])(
    "reloads once when a %i response requires the managed browser session to be paired again",
    async (status) => {
      vi.stubEnv("VITE_DEVPC_MANAGED", "1");
      vi.resetModules();
      const reload = vi.fn();
      const storage = new Map<string, string>();
      vi.stubGlobal("window", {
        location: { origin: "https://app.example.test", reload },
        sessionStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => storage.set(key, value),
          removeItem: (key: string) => storage.delete(key),
        },
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status })),
      );

      let { prepareManagedWebSocketUrl } = await import("./managedDevPc");
      await expect(prepareManagedWebSocketUrl("wss://app.example.test/ws")).rejects.toThrow(
        "Refreshing the managed workspace connection.",
      );
      expect(reload).toHaveBeenCalledOnce();
      expect(storage.has("devpc-managed-session-recovery-at")).toBe(true);

      vi.resetModules();
      ({ prepareManagedWebSocketUrl } = await import("./managedDevPc"));
      await expect(prepareManagedWebSocketUrl("wss://app.example.test/ws")).rejects.toThrow(
        "could not be authorized",
      );
      expect(reload).toHaveBeenCalledOnce();
    },
  );

  it("clears the managed session recovery cooldown after authorization succeeds", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const storage = new Map([["devpc-managed-session-recovery-at", String(Date.now())]]);
    vi.stubGlobal("window", {
      location: { origin: "https://app.example.test" },
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ticket: "gateway-ticket-that-is-long-enough" })),
    );

    const { prepareManagedWebSocketUrl } = await import("./managedDevPc");
    await prepareManagedWebSocketUrl("wss://app.example.test/ws");
    expect(storage.size).toBe(0);
  });

  it("keeps the managed session recovery cooldown after an invalid success response", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    const recoveryKey = "devpc-managed-session-recovery-at";
    const storage = new Map([[recoveryKey, String(Date.now())]]);
    vi.stubGlobal("window", {
      location: { origin: "https://app.example.test" },
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ticket: "invalid" })),
    );

    const { prepareManagedWebSocketUrl } = await import("./managedDevPc");
    await expect(prepareManagedWebSocketUrl("wss://app.example.test/ws")).rejects.toThrow(
      "invalid connection credential",
    );
    expect(storage.has(recoveryKey)).toBe(true);
  });
});

describe("shared workspace browser", () => {
  const stubBootstrap = (previewUrls: Record<string, string>) => {
    vi.stubGlobal("window", {
      location: { origin: "https://app.example.test" },
      __DEVPC_MANAGED_BOOTSTRAP__: {
        managed: true,
        state: "ready",
        ready: true,
        previewUrlTemplate: "https://{port}--devpc.example.test/",
        previewUrls,
      },
    });
  };

  it("offers the granted browser URL when the deployment has one", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    stubBootstrap({
      "6080": "https://6080--devpc.example.test/vnc.html?resize=remote&grant=g",
    });

    const { managedWorkspaceBrowserUrl } = await import("./managedDevPc");

    // Returned untouched: the host already points it at the noVNC client with the
    // viewer options, because the port's own root serves a directory listing.
    expect(managedWorkspaceBrowserUrl()).toBe(
      "https://6080--devpc.example.test/vnc.html?resize=remote&grant=g",
    );
  });

  it("offers nothing when the workspace has no browser grant", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "1");
    vi.resetModules();
    stubBootstrap({ "5173": "https://5173--devpc.example.test/?grant=g" });

    const { managedWorkspaceBrowserUrl } = await import("./managedDevPc");

    expect(managedWorkspaceBrowserUrl()).toBeNull();
  });

  it("offers nothing outside a managed deployment", async () => {
    vi.stubEnv("VITE_DEVPC_MANAGED", "0");
    vi.resetModules();
    stubBootstrap({ "6080": "https://6080--devpc.example.test/vnc.html" });

    const { managedWorkspaceBrowserUrl } = await import("./managedDevPc");

    expect(managedWorkspaceBrowserUrl()).toBeNull();
  });
});
