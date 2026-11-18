// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { type AldoHandoff } from "./homeApi";

const backend = vi.hoisted(() => ({ resolve: vi.fn(), toast: vi.fn() }));
vi.mock("./homeApi", () => ({
  resolveAldoHandoff: async (id: string, answer: unknown) => {
    backend.resolve(id, answer);
    return { outcome: "done", message: "Handed back: the agent carries on." };
  },
}));
vi.mock("./homeFeed", () => ({
  refreshAldoHome: async () => {},
  useAldoHomeFeed: () => null,
  useAldoHomeRead: () => ({ home: null, supported: true }),
}));
vi.mock("./morph", () => ({
  aldoMorph: (update: () => void) => update(),
  aldoMorphSource: () => null,
}));
vi.mock("../components/ui/toast", () => ({
  toastManager: { add: backend.toast, close: vi.fn() },
}));

import { AldoHandoffActions, useAldoHandoffTakeover } from "./AldoHandoffCard";

const idCheck = (over: Partial<AldoHandoff> = {}): AldoHandoff => ({
  id: "ho_1",
  kind: "identity",
  reason: "Fiverr needs an ID check",
  how: null,
  site: "fiverr.com",
  url: "https://www.fiverr.com",
  seconds: 120,
  thread: { environmentId: "aldo-t1", threadId: "c-1" },
  threadTitle: "Fiverr business",
  createdAt: "2026-10-20T08:00:00.000Z",
  expiresAt: "2026-10-20T10:00:00.000Z",
  ...over,
});

/** A screen that is (or isn't) a phone: narrow and touch. */
const screen = (phone: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: phone,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));

let root: Root | undefined;
let container: HTMLDivElement;
async function render(handoff: AldoHandoff) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root!.render(<AldoHandoffActions handoff={handoff} />));
}
const button = (name: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  useAldoHandoffTakeover.setState({ id: null });
  backend.resolve.mockReset();
  vi.unstubAllGlobals();
});

it("on a computer, offers Take control and a QR code for the phone, which opens the agent's browser in Aldo", async () => {
  screen(false);
  await render(idCheck());
  expect(button("Take control")).toBeDefined();
  const phone = button("Do it on my phone")!;
  expect(phone.getAttribute("aria-expanded")).toBe("false");
  expect(container.querySelector('svg[aria-label="QR code for your phone"]')).toBeNull();

  await act(() => phone.click());
  expect(phone.getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelector('svg[aria-label="QR code for your phone"]')).not.toBeNull();
  expect(container.textContent).toContain("It opens your agent's browser at this step");
  expect(button("Copy link")).toBeDefined();

  // Take control opens the agent's browser full screen.
  await act(() => button("Take control")!.click());
  expect(useAldoHandoffTakeover.getState().id).toBe("ho_1");

  // Done on the phone or not, it's handed back here too.
  await act(async () => button("I'm done")!.click());
  expect(backend.resolve).toHaveBeenCalledWith("ho_1", { decision: "done" });
});

it("on a computer, the QR code is the site's own link for a camera step", async () => {
  screen(false);
  await render(idCheck({ phoneUrl: "https://verify.fiverr.com/continue?session=7f3a" }));
  await act(() => button("Do it on my phone")!.click());
  expect(container.textContent).toContain(
    "It opens Fiverr's own page for this step, where your phone's camera works.",
  );
  // No link to the site's page on a computer: its camera is the phone's.
  expect(container.querySelector("a")).toBeNull();
});

it("on a phone, a camera step leads with the site's own page, then hands back", async () => {
  screen(true);
  const link = "https://verify.fiverr.com/continue?session=7f3a";
  await render(idCheck({ phoneUrl: link }));
  const site = container.querySelector("a")!;
  expect(site.getAttribute("href")).toBe(link);
  expect(site.getAttribute("target")).toBe("_blank");
  expect(site.getAttribute("rel")).toBe("noopener noreferrer");
  expect(site.textContent?.trim()).toBe("Open on Fiverr");
  expect(button("I'm done")).toBeDefined();
  expect(button("Take control")).toBeDefined();
  // Already on the phone: no QR code for one.
  expect(button("Do it on my phone")).toBeUndefined();
});

it("on a phone without the site's link, Take control is the way, as from an older Aldo", async () => {
  screen(true);
  await render(idCheck());
  expect(button("Take control")).toBeDefined();
  expect(button("Do it on my phone")).toBeUndefined();
  expect(container.querySelector("a")).toBeNull();
});
