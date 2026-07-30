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
    const { requiresManagedResume, shouldPromptManagedResume } = await import("./managedDevPc");
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
    expect(shouldPromptManagedResume({ ...base, status: "stopped" }, false)).toBe(true);
    expect(shouldPromptManagedResume({ ...base, status: "stopped" }, true)).toBe(false);
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
      sessionStorage: {
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
