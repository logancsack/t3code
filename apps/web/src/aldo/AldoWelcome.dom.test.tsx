// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const save = vi.hoisted(() => vi.fn(async () => true));
const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
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
  save.mockReset().mockResolvedValue(true);
  navigate.mockReset();
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
const setupButton = (name: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith(name))!;

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
    expect(save).not.toHaveBeenCalled();
    expect(container.textContent).toContain("A few choices, if you like.");
    await act(async () => button("Skip for now").click());
    expect(save).toHaveBeenCalledWith(["business", "media"], { revert: true, waitForSave: true });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("a tap again unpicks, and Skip saves nothing picked", async () => {
    await act(async () => root.render(<AldoWelcome />));
    await act(async () => button("Code and apps").click());
    await act(async () => button("Code and apps").click());
    expect(button("Code and apps").getAttribute("aria-pressed")).toBe("false");
    await act(async () => button("Skip").click());
    await act(async () => button("Skip for now").click());
    expect(save).toHaveBeenCalledWith([], { revert: true, waitForSave: true });
  });

  it("Back keeps the chosen interests without saving or granting permission", async () => {
    await act(async () => root.render(<AldoWelcome />));
    await act(async () => button("Research").click());
    await act(async () => button("Continue").click());
    await act(async () => button("Back").click());
    expect(button("Research").getAttribute("aria-pressed")).toBe("true");
    expect(save).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each([
    ["Set spending limit", { to: "/settings/permissions" }],
    ["Choose agents’ email", { to: "/settings/connections", hash: "aldo-agent-inbox" }],
    ["Connect my mail", { to: "/settings/connections" }],
  ])("opens %s only after the welcome is saved", async (label, destination) => {
    let finish!: (saved: boolean) => void;
    save.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await act(async () => root.render(<AldoWelcome />));
    await act(async () => button("Continue").click());
    await act(async () => setupButton(label).click());
    expect(navigate).not.toHaveBeenCalled();
    expect(button("Saving…").disabled).toBe(true);
    expect(setupButton(label).disabled).toBe(true);
    await act(async () => finish(true));
    expect(navigate).toHaveBeenCalledExactlyOnceWith(destination);
  });

  it("keeps the step and interests after a failed save, then retries the selected action", async () => {
    save.mockResolvedValueOnce(false);
    await act(async () => root.render(<AldoWelcome />));
    await act(async () => button("Video and design").click());
    await act(async () => button("Continue").click());
    await act(async () => setupButton("Connect my mail").click());
    expect(container.querySelector("[role=alert]")?.textContent).toContain("Try again");
    expect(navigate).not.toHaveBeenCalled();
    await act(async () => setupButton("Connect my mail").click());
    expect(save).toHaveBeenLastCalledWith(["media"], { revert: true, waitForSave: true });
    expect(navigate).toHaveBeenCalledExactlyOnceWith({ to: "/settings/connections" });
  });
});
