// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import type { AldoNotificationsStatus, AldoTestState } from "./notifications.logic";

const device = vi.hoisted(() => ({
  status: null as unknown,
  permission: "granted" as NotificationPermission,
  report: null as null | ((state: unknown) => void),
  tests: 0,
}));

vi.mock("./notifications", () => ({
  aldoNotificationsStatus: async () => device.status,
  enableAldoNotifications: async () => device.permission,
  currentAldoBrowser: () => ({ name: "chrome", os: "mac", phone: false, standalone: false }),
  testAldoNotifications: (onChange: (state: unknown) => void) => {
    device.tests++;
    device.report = onChange;
    onChange({ phase: "sending" });
    return () => undefined;
  },
}));

import { AldoNotifyOffer } from "./AldoNotifyOffer";

const available = (
  over: Partial<Extract<AldoNotificationsStatus, { availability: "available" }>> = {},
) => ({
  availability: "available" as const,
  key: "B".repeat(87),
  on: false,
  blocked: false,
  test: true,
  ...over,
});

let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  device.status = available();
  device.permission = "granted";
  device.report = null;
  device.tests = 0;
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root!.render(<AldoNotifyOffer />));
}

const text = () => container.textContent ?? "";
const button = (label: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === label)!;
const report = (state: AldoTestState) => act(() => device.report!(state));

it("asks, turns them on, sends a test and says it arrived", async () => {
  await render();
  expect(text()).toBe("Get a notification on this computer when it’s done or needs you? Notify me");
  await act(() => button("Notify me").click());
  expect(text()).toBe("Notifications are on for this browser. Sending a test…");
  expect(device.tests).toBe(1);
  // Answered: other threads don't ask again.
  expect(window.localStorage.getItem("aldo:notify-offer")).not.toBeNull();
  await report({ phase: "arrived" });
  expect(text()).toBe(
    "Notifications are on for this browser. Sent a test. It arrived. Didn’t see it?",
  );
  await act(() => button("Didn’t see it?").click());
  expect(text()).toContain(
    "Check that Google Chrome can show notifications in System Settings → Notifications",
  );
});

it("says where to look when the test doesn't come, and sends another", async () => {
  await render();
  await act(() => button("Notify me").click());
  await report({ phase: "waiting" });
  await report({ phase: "not-seen" });
  expect(text()).toContain(
    "Sent a test. Didn’t see it? Check that Google Chrome can show notifications",
  );
  await act(() => button("Send another").click());
  expect(device.tests).toBe(2);
});

it("says they're on, without a test, where Aldo doesn't send one", async () => {
  device.status = available({ test: false });
  await render();
  await act(() => button("Notify me").click());
  expect(text()).toBe("Notifications are on for this browser.");
  expect(device.tests).toBe(0);
});

it("says how to allow them in this browser once it blocks them", async () => {
  device.permission = "denied";
  await render();
  await act(() => button("Notify me").click());
  expect(text()).toBe(
    "This browser blocks Aldo’s notifications. To allow them, click the icon at the left of the address bar, turn on Notifications, then reload the page.",
  );
  expect(window.localStorage.getItem("aldo:notify-offer")).toBeNull();
});

it("offers again when the prompt was closed without an answer", async () => {
  device.permission = "default";
  await render();
  await act(() => button("Notify me").click());
  expect(text()).toBe("Notifications aren’t on yet. Notify me");
});

it("says how to allow them when they were blocked before", async () => {
  device.status = available({ blocked: true });
  await render();
  expect(text()).toContain(
    "This browser blocks Aldo’s notifications. To allow them, click the icon",
  );
});

it("stays away once answered, and where they're on already", async () => {
  device.status = available({ on: true });
  await render();
  expect(text()).toBe("");
  await act(() => root!.unmount());
  window.localStorage.setItem("aldo:notify-offer", "2026-10-20T00:00:00.000Z");
  device.status = available();
  await render();
  expect(text()).toBe("");
});
