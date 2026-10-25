// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import AldoArtifacts from "./AldoArtifacts";
import type { AldoArtifact } from "./artifacts.logic";

const opened = vi.hoisted(() => [] as unknown[]);
vi.mock("./shareViewer", () => ({ openAldoShare: (share: unknown) => opened.push(share) }));

const SHARE = "/s/abcdefghijklmnop1234";
const PAGE = "/s/pagepagepagepage5678";
const RECORDING = "https://store-1.public.blob.vercel-storage.com/artifacts/thread_1/2048-x7.mp4";

const ARTIFACTS: AldoArtifact[] = [
  { kind: "file", url: SHARE, title: "Cat", contentType: "image/png", bytes: 2048 },
  { kind: "file", url: RECORDING, title: "Checkout fix", contentType: "video/mp4" },
  { kind: "file", url: PAGE, title: "Launch page", contentType: "text/html" },
  {
    kind: "chart",
    title: "Machine hours",
    type: "bar",
    labels: Array.from({ length: 12 }, (_, i) => `Day ${i + 1}`),
    series: [{ name: "Hours", values: Array.from({ length: 12 }, (_, i) => i) }],
    unit: "h",
  },
  {
    kind: "table",
    title: "Costs",
    columns: ["Thread", "Model", "Tokens", "Machine", "Total", "When"],
    rows: Array.from({ length: 9 }, (_, i) => [`Fix ${i}`, "Opus", "12,000", "1 h", "$4", "Today"]),
  },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  opened.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

const render = () => act(async () => root.render(<AldoArtifacts artifacts={ARTIFACTS} />));

it("never makes the conversation wider: each one fits the column", async () => {
  await render();
  const list = container.querySelector("[data-aldo-artifacts]")!;
  expect(list.classList).toContain("min-w-0");
  expect(list.classList).toContain("max-w-full");
  for (const child of list.children) expect(child.classList).toContain("min-w-0");
  // The table in place cuts its cells to the column rather than scroll: 4 columns and 6 rows.
  const table = list.querySelector("table")!;
  expect(table.classList).toContain("table-fixed");
  expect(table.classList).toContain("w-full");
  expect(table.querySelectorAll("th")).toHaveLength(4);
  expect(table.querySelectorAll("tbody tr")).toHaveLength(6);
  expect(container.textContent).toContain("All 6 columns · 9 rows");
});

it("runs a page only sandboxed, as a picture of itself that takes no taps", async () => {
  await render();
  const frame = container.querySelector("iframe")!;
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame.getAttribute("src")).toBe(`${PAGE}?in=chat`);
  expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(frame.getAttribute("loading")).toBe("lazy");
  expect(frame.classList).toContain("pointer-events-none");
  expect(frame.tabIndex).toBe(-1);
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[aria-label="Open Launch page"]')!.click();
  });
  expect(opened).toEqual([
    {
      id: "pagepagepagepage5678",
      url: PAGE,
      title: "Launch page",
      contentType: "text/html",
      share: null,
    },
  ]);
});

it("shows a picture from the page's origin and opens it whole on a tap; one that won't load says so", async () => {
  await render();
  const image = container.querySelector("img")!;
  expect(image.getAttribute("src")).toBe(`${SHARE}?in=chat`);
  expect(image.getAttribute("loading")).toBe("lazy");
  await act(async () => image.closest("button")!.click());
  expect(opened).toHaveLength(1);
  await act(async () => image.dispatchEvent(new Event("error")));
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain("Cat");
  expect(container.textContent).toContain("Picture · Unavailable right now");
});

it("says so, in a tile with a retry, for a sound that won't load, without scrolling sideways", async () => {
  const sound: AldoArtifact = {
    kind: "file",
    url: "/s/soundsoundsound9999",
    title: "Voice note",
    contentType: "audio/mpeg",
  };
  await act(async () => root.render(<AldoArtifacts artifacts={[sound]} />));
  await act(async () => container.querySelector("audio")!.dispatchEvent(new Event("error")));
  expect(container.querySelector("audio")).toBeNull();
  const note = container.querySelector('[role="status"]')!;
  expect(note.textContent).toBe("Voice noteAudio · Unavailable right nowRetry");
  expect(note.classList).toContain("min-w-0");
  // A file doesn't wait on its thread's machine, so it doesn't say that.
  expect(container.textContent).not.toMatch(/machine/i);
  await act(async () => note.querySelector("button")!.click());
  expect(container.querySelector("audio")).not.toBeNull();
});

it("plays a recording in place, with a way to save it", async () => {
  await render();
  const video = container.querySelector("video")!;
  expect(video.closest("figure")!.textContent).toContain("Checkout fix");
  expect(
    container.querySelector<HTMLAnchorElement>('a[aria-label="Save Checkout fix"]')!.href,
  ).toBe(`${RECORDING}?download=1`);
});

it("draws a chart from its data, a few bars in place and all of them full screen with the data to save", async () => {
  await render();
  const chart = container.querySelector('[role="img"][aria-label="Machine hours"]')!;
  expect(chart.textContent).toContain("Day 8");
  expect(chart.textContent).not.toContain("Day 9");
  expect(chart.textContent).toContain("7 h");
  expect(container.textContent).toContain("All 12 in full screen");
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Open Machine hours full screen"]')!
      .click();
  });
  const sheet = document.body.querySelector('[role="dialog"]')!;
  expect(sheet.textContent).toContain("Download CSV");
  expect(sheet.textContent).toContain("Day 12");
});

it("draws a loss leftward from zero, as long as it is", async () => {
  const net: AldoArtifact = {
    kind: "chart",
    title: "Net",
    type: "bar",
    labels: ["Mon", "Tue", "Wed"],
    series: [{ name: "Net", values: [-10, -100, 50] }],
  };
  await act(async () => root.render(<AldoArtifacts artifacts={[net]} />));
  const bars = [...container.querySelectorAll<HTMLElement>('[role="img"] .rounded-full')].map(
    (bar) => [parseFloat(bar.style.left), parseFloat(bar.style.width)],
  );
  // On a scale from -100 to 50, zero sits two thirds of the way along.
  expect(bars[0]![0]).toBeCloseTo(60);
  expect(bars[0]![1]).toBeCloseTo(6.67, 1);
  expect(bars[1]).toEqual([0, expect.closeTo(66.67, 1)]);
  expect(bars[2]).toEqual([expect.closeTo(66.67, 1), expect.closeTo(33.33, 1)]);
});

it("closes a chart's sheet for good: closing it doesn't open it again", async () => {
  await render();
  const open = () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Open Costs full screen"]')!
      .click();
  await act(async () => open());
  expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => {
    document.body
      .querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')!
      .click();
  });
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
});

it("draws a pie with each slice's share written beside it, and its data full screen", async () => {
  const holders: AldoArtifact = {
    kind: "chart",
    title: "Largest holders",
    type: "pie",
    labels: ["Berkshire", "Vanguard", "BlackRock"],
    series: [{ name: "Stake", values: [45, 8, 7] }],
    unit: "%",
  };
  await act(async () => root.render(<AldoArtifacts artifacts={[holders]} />));
  const pie = container.querySelector('[role="img"][aria-label="Largest holders"]')!;
  expect(pie.querySelectorAll("path")).toHaveLength(3);
  expect(pie.textContent).toContain("Berkshire");
  expect(pie.textContent).toContain("75%");
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Open Largest holders full screen"]')!
      .click();
  });
  expect(document.body.querySelector('[role="dialog"]')!.textContent).toContain("Share");
});

it("draws stacked columns as one column a label, and writes the latest label's figures over them", async () => {
  const revenue: AldoArtifact = {
    kind: "chart",
    title: "Revenue",
    type: "column",
    stacked: true,
    labels: ["Q1", "Q2", "Q3"],
    series: [
      { name: "US", values: [3, 4, 5] },
      { name: "EU", values: [1, 2, 0] },
    ],
    unit: "$",
  };
  await act(async () => root.render(<AldoArtifacts artifacts={[revenue]} />));
  const chart = container.querySelector('svg[role="img"][aria-label="Revenue"]')!;
  // A segment for each value but the one that's nothing.
  expect(chart.querySelectorAll("path")).toHaveLength(5);
  const figures = chart.closest("section")!.querySelector("p")!.textContent;
  expect(figures).toContain("Q3");
  expect(figures).toContain("US$5");
  expect(figures).toContain("EU$0");
});
