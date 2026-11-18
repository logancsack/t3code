// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const save = vi.hoisted(() => vi.fn(async () => true));
vi.mock("./onboarding", () => ({ saveAldoOnboarding: save }));
vi.mock("./AldoAccountMenu", () => ({
  useAldoProfile: () => ({ id: "user_1", email: "maya@example.com", name: "Maya Ortiz" }),
}));
vi.mock("./AldoFrame", () => ({ AldoFrame: () => null }));
const org = vi.hoisted(() => ({ data: null as { name: string } | null }));
vi.mock("./settingsData", () => ({ settingsOrg: {} }));
vi.mock("./settingsResource", () => ({ useSettingsResource: () => org }));

const { AldoWelcome } = await import("./AldoWelcome");

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  save.mockClear();
  org.data = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const button = (name: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === name)!;

describe("the welcome", () => {
  it("greets them by first name and asks one question", async () => {
    await act(async () => root.render(<AldoWelcome />));
    expect(container.querySelector("h1")?.textContent).toBe("Welcome to Aldo, Maya.");
    expect(container.textContent).toContain("What will you hand it first? Pick any.");
    expect(container.querySelector("[role=dialog]")).not.toBeNull();
    expect(container.textContent).not.toContain("You’re in");
  });

  it("tells someone who came in on an organization's invite that they're in it", async () => {
    org.data = { name: "Linden Partners" };
    await act(async () => root.render(<AldoWelcome />));
    expect(container.querySelector("#aldo-welcome-lead")?.textContent).toMatch(
      /^You’re in Linden Partners\. Hand it real work/,
    );
  });

  it("keeps what they picked, in the welcome's order", async () => {
    await act(async () => root.render(<AldoWelcome />));
    await act(async () => button("Video and design").click());
    await act(async () => button("Running a business").click());
    expect(button("Running a business").getAttribute("aria-pressed")).toBe("true");
    expect(button("Research").getAttribute("aria-pressed")).toBe("false");
    await act(async () => button("Continue").click());
    expect(save).toHaveBeenCalledWith(["business", "media"]);
  });

  it("a tap again unpicks, and Skip saves nothing picked", async () => {
    await act(async () => root.render(<AldoWelcome />));
    await act(async () => button("Code and apps").click());
    await act(async () => button("Code and apps").click());
    expect(button("Code and apps").getAttribute("aria-pressed")).toBe("false");
    await act(async () => button("Skip").click());
    expect(save).toHaveBeenCalledWith([]);
  });
});
