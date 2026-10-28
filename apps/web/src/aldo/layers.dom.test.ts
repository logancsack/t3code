// @vitest-environment jsdom

import { createBrowserHistory, type RouterHistory } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";

const HOME = "/";
const THREAD_A = "/aldo-a1/11111111-1111-4111-8111-111111111111";
const THREAD_B = "/aldo-b2/22222222-2222-4222-8222-222222222222";

type Layers = typeof import("./layers");
let layers: Layers;
let history: RouterHistory;

/** The history writes to the page a tick after a push, as the router does. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const here = () => history.location.pathname;
const state = () => history.location.state as unknown as Record<string, unknown>;
const index = () => state().__TSR_index;
const drawer = () => Boolean(state().aldoDrawer);

/** A fresh page at `path`, with the layers installed the way main.tsx does. */
async function start(path: string) {
  vi.resetModules();
  layers = await import("./layers");
  window.history.replaceState(null, "", path);
  layers.seedAldoHome();
  history = createBrowserHistory();
  layers.installAldoLayers(history);
}

describe("the layers", () => {
  it("knows a thread from every other page", async () => {
    await start(HOME);
    expect(layers.isThreadPath(THREAD_A)).toBe(true);
    expect(layers.isThreadPath("/draft/abc")).toBe(true);
    expect(layers.isThreadPath(HOME)).toBe(false);
    expect(layers.isThreadPath("/settings/general")).toBe(false);
    expect(layers.isThreadPath("/pull-requests")).toBe(false);
  });

  it("puts a thread over Home, and Back takes it off", async () => {
    await start(HOME);
    history.push(THREAD_A);
    await tick();
    expect([here(), index()]).toEqual([THREAD_A, 1]);
    history.back();
    await vi.waitFor(() => expect(here()).toBe(HOME));
    expect(index()).toBe(0);
  });

  it("swaps a thread for another instead of stacking", async () => {
    await start(HOME);
    history.push(THREAD_A);
    await tick();
    history.push(THREAD_B);
    await tick();
    expect([here(), index()]).toEqual([THREAD_B, 1]);
    history.back();
    await vi.waitFor(() => expect(here()).toBe(HOME));
  });

  it("closes a thread when something goes Home from it", async () => {
    await start(HOME);
    history.push(THREAD_A);
    await tick();
    history.push(HOME);
    await tick();
    await vi.waitFor(() => expect(here()).toBe(HOME));
    expect(index()).toBe(0);
  });

  it("opens the sidebar as an entry and closes it with Back", async () => {
    await start(HOME);
    layers.openAldoDrawer();
    await tick();
    expect([drawer(), here(), index(), layers.aldoDrawerOnTop()]).toEqual([true, HOME, 1, true]);
    history.back();
    await vi.waitFor(() => expect(drawer()).toBe(false));
    expect([here(), index(), layers.aldoDrawerOnTop()]).toEqual([HOME, 0, false]);
  });

  it("closes the sidebar over a thread back to that thread", async () => {
    await start(HOME);
    history.push(THREAD_A);
    await tick();
    layers.openAldoDrawer();
    await tick();
    expect([here(), index(), drawer()]).toEqual([THREAD_A, 2, true]);
    layers.closeAldoDrawer();
    await vi.waitFor(() => expect(drawer()).toBe(false));
    expect([here(), index()]).toEqual([THREAD_A, 1]);
  });

  it("closes only the sidebar when it is open over a thread", async () => {
    await start(HOME);
    history.push(THREAD_A);
    await tick();
    layers.openAldoDrawer();
    await tick();
    layers.closeAldoThread();
    await vi.waitFor(() => expect(drawer()).toBe(false));
    expect(here()).toBe(THREAD_A);
    layers.closeAldoThread();
    await vi.waitFor(() => expect(here()).toBe(HOME));
  });

  it("takes the sidebar's entry for a thread chosen from it", async () => {
    await start(HOME);
    layers.openAldoDrawer();
    await tick();
    // A row closes the sidebar and then goes to the thread, in the same tick.
    layers.closeAldoDrawer();
    history.push(THREAD_A);
    await tick();
    expect([here(), index(), drawer()]).toEqual([THREAD_A, 1, false]);
    history.back();
    await vi.waitFor(() => expect(here()).toBe(HOME));
    expect(index()).toBe(0);
  });

  it("leaves one Back to Home after a thread is chosen over another", async () => {
    await start(HOME);
    history.push(THREAD_A);
    await tick();
    layers.openAldoDrawer();
    await tick();
    layers.closeAldoDrawer();
    history.push(THREAD_B);
    await tick();
    await vi.waitFor(() => expect([here(), index(), drawer()]).toEqual([THREAD_B, 1, false]));
    history.back();
    await vi.waitFor(() => expect(here()).toBe(HOME));
    expect(index()).toBe(0);
  });

  it("goes Home from the sidebar over a thread with the thread gone", async () => {
    await start(HOME);
    history.push(THREAD_A);
    await tick();
    layers.openAldoDrawer();
    await tick();
    history.push(HOME);
    await tick();
    await vi.waitFor(() => expect([here(), drawer(), index()]).toEqual([HOME, false, 0]));
  });

  it("only closes the sidebar for the place it is already over", async () => {
    await start(HOME);
    layers.openAldoDrawer();
    await tick();
    history.push(HOME);
    await vi.waitFor(() => expect(drawer()).toBe(false));
    expect([here(), index()]).toEqual([HOME, 0]);
  });

  it("keeps other pages as they are", async () => {
    await start(HOME);
    history.push("/settings/general");
    await tick();
    expect([here(), index()]).toEqual(["/settings/general", 1]);
    history.push(THREAD_A);
    await tick();
    expect([here(), index()]).toEqual([THREAD_A, 2]);
  });
});

describe("a page opened onto a thread", () => {
  it("has Home under it, so Back lands there", async () => {
    await start(THREAD_A);
    expect([here(), index()]).toEqual([THREAD_A, 1]);
    layers.closeAldoThread();
    await vi.waitFor(() => expect(here()).toBe(HOME));
    expect(index()).toBe(0);
  });

  it("leaves a page that opens on Home alone", async () => {
    await start(HOME);
    expect([here(), index()]).toEqual([HOME, 0]);
  });
});
