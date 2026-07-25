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
