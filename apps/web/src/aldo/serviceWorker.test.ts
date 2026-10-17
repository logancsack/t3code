import { afterEach, expect, it, vi } from "vite-plus/test";

// The real worker sends a MessagePort; the page acknowledges before navigating.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("routes notification taps inside the app, keeping query and fragment", async () => {
  vi.stubEnv("VITE_ALDO_CLOUD", "1");
  let receive!: (event: MessageEvent) => void;
  const register = vi.fn(async () => undefined);
  const assign = vi.fn();
  vi.stubGlobal("navigator", {
    serviceWorker: {
      addEventListener: (_type: string, listener: typeof receive) => {
        receive = listener;
      },
      register,
    },
  });
  vi.stubGlobal("document", { readyState: "complete" });
  vi.stubGlobal("location", { origin: "https://aldo.test", assign });
  const { installAldoServiceWorker } = await import("./serviceWorker");
  const navigate = vi.fn(async () => undefined);
  installAldoServiceWorker(navigate);
  const postMessage = vi.fn();
  receive({
    data: { type: "aldo-open", url: "https://aldo.test/aldo-machine/thread?handoff=h1#approval" },
    ports: [{ postMessage }],
  } as unknown as MessageEvent);
  expect(postMessage).toHaveBeenCalledWith("opened");
  expect(navigate).toHaveBeenCalledWith("/aldo-machine/thread?handoff=h1#approval");
  receive({ data: { type: "aldo-open", url: "https://other.test/" } } as MessageEvent);
  expect(navigate).toHaveBeenCalledOnce();
  expect(assign).not.toHaveBeenCalled();
  expect(register).toHaveBeenCalledWith("/sw.js");
});
