import { expect, it, vi } from "vite-plus/test";
import { isLandingDemo, isWorkReplay } from "./mode";

it("selects local transports only with an explicit demo flag", () => {
  for (const path of [
    "/",
    "/aldo-example/thread",
    "/?aldoReplay=0",
    "/?next=aldoReplay%3D1",
    "/#/?aldoReplay=1",
  ]) {
    const url = new URL(path, "https://aldo.computer");
    expect(isLandingDemo(url)).toBe(false);
    expect(isWorkReplay(url)).toBe(false);
  }
  expect(isLandingDemo(new URL("https://aldo.computer/?aldoDemo=1"))).toBe(true);
  expect(isWorkReplay(new URL("https://aldo.computer/?aldoDemo=1"))).toBe(false);
  const replay = new URL("https://aldo.computer/replay.html?aldoReplay=1");
  expect(isLandingDemo(replay)).toBe(true);
  expect(isWorkReplay(replay)).toBe(true);
});

it("keeps partial browser bridges out of replay mode", () => {
  vi.stubGlobal("window", { localStorage: {} });
  try {
    expect(isWorkReplay()).toBe(false);
    expect(isLandingDemo()).toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }
});
