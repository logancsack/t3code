// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import AldoArtifacts from "./AldoArtifacts";
import type { AldoArtifact, AldoLinkRow } from "./artifacts.logic";

const opened = vi.hoisted(() => [] as unknown[]);
vi.mock("./shareViewer", () => ({ openAldoShare: (share: unknown) => opened.push(share) }));

const SHARE = "/s/abcdefghijklmnop1234";
const PAGE = "/s/pagepagepagepage5678";
const RECORDING = "https://store-1.public.blob.vercel-storage.com/artifacts/thread_1/2048-x7.mp4";

const PICTURE: AldoArtifact = {
  kind: "file",
  url: SHARE,
  title: "Cat",
  contentType: "image/png",
  bytes: 2048,
};
const VIDEO: AldoArtifact = {
  kind: "file",
  url: RECORDING,
  title: "Checkout fix",
  contentType: "video/mp4",
};
const PAGE_FILE: AldoArtifact = {
  kind: "file",
  url: PAGE,
  title: "Launch page",
  contentType: "text/html",
};
const CHART: AldoArtifact = {
  kind: "chart",
  title: "Machine hours",
  type: "bar",
  labels: Array.from({ length: 12 }, (_, i) => `Day ${i + 1}`),
  series: [{ name: "Hours", values: Array.from({ length: 12 }, (_, i) => i) }],
  unit: "h",
};
const TABLE: AldoArtifact = {
  kind: "table",
  title: "Costs",
  columns: ["Thread", "Model", "Tokens", "Machine", "Total", "When"],
  rows: Array.from({ length: 9 }, (_, i) => [`Fix ${i}`, "Opus", "12,000", "1 h", "$4", "Today"]),
};

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

const render = (artifacts: AldoArtifact[], links: AldoLinkRow[] = []) =>
  act(async () => root.render(<AldoArtifacts artifacts={artifacts} links={links} />));

it("shows one thing in place and lists the rest in one card, without sizes", async () => {
  // A thread's research result: a page, a picture of a chart, a report, a spreadsheet and a table.
  const report: AldoArtifact = {
    kind: "file",
    url: "/s/reportreportreport12",
    title: "Full report",
    contentType: "text/markdown",
    bytes: 21415,
  };
  const csv: AldoArtifact = {
    kind: "file",
    url: "/s/csvcsvcsvcsvcsvcsv12",
    title: "Month-end closes",
    contentType: "text/csv",
    bytes: 930,
  };
  const archive: AldoArtifact = {
    kind: "file",
    url: "/s/zipzipzipzipzipzip12",
    title: "Source archive",
    contentType: "application/zip",
  };
  const pull: AldoLinkRow = {
    url: "https://github.com/acme/shop/pull/7",
    title: "acme/shop #7",
    type: "Pull request",
  };
  await render([PAGE_FILE, PICTURE, report, csv, archive, TABLE], [pull]);
  const list = container.querySelector("[data-aldo-artifacts]")!;
  expect(list.classList).toContain("min-w-0");
  expect(list.classList).toContain("max-w-full");
  for (const child of list.children) expect(child.classList).toContain("min-w-0");
  // The table leads; the rest is one list, the picture by its own thumbnail.
  expect(list.children).toHaveLength(2);
  expect(list.querySelector("table")).not.toBeNull();
  expect(list.querySelector("iframe")).toBeNull();
  const rows = [...list.querySelectorAll("li")].map((row) => row.textContent);
  expect(rows).toEqual([
    "Launch pagePage",
    "CatPicture",
    "Full reportDocument",
    "Month-end closesSpreadsheet",
    "Source archiveArchive",
    "acme/shop #7Pull request",
  ]);
  expect(list.querySelector("li img")!.getAttribute("src")).toBe(`${SHARE}?in=chat`);
  expect(container.textContent).not.toMatch(/\d\s?(B|KB|MB)\b/);
  // A tap opens a file in the viewer; what a browser can't show saves; a link opens where it goes.
  await act(async () => list.querySelector<HTMLButtonElement>("li button")!.click());
  expect(opened).toEqual([
    {
      id: "pagepagepagepage5678",
      url: PAGE,
      title: "Launch page",
      contentType: "text/html",
      share: null,
    },
  ]);
  const save = [...list.querySelectorAll<HTMLAnchorElement>("li a")];
  expect(save[0]!.hasAttribute("download")).toBe(true);
  expect(save[1]!.href).toBe(pull.url);
  expect(save[1]!.target).toBe("_blank");
});

it("fits a table to the conversation: whole words and figures, numbers to the right", async () => {
  await render([TABLE]);
  const table = container.querySelector("table")!;
  expect(table.classList).not.toContain("table-fixed");
  expect(table.outerHTML).not.toContain("truncate");
  expect(table.parentElement!.classList).toContain("overflow-x-auto");
  expect(table.querySelectorAll("th")).toHaveLength(4);
  expect(table.querySelectorAll("tbody tr")).toHaveLength(8);
  const [thread, , tokens] = table.querySelectorAll("tbody tr:first-child td");
  expect(thread!.classList).toContain("break-words");
  expect(tokens!.classList).toContain("text-right");
  expect(tokens!.classList).toContain("whitespace-nowrap");
  expect(tokens!.classList).toContain("tabular-nums");
  expect(container.textContent).toContain("All 6 columns · 9 rows");
  // A small one shows whole, and says nothing's left out.
  await render([{ ...TABLE, columns: ["Thread", "Total"], rows: [["Fix", "$4"]] }]);
  expect(container.textContent).not.toContain("All");
});

it("opens a listed table full screen, with its data to save", async () => {
  await render([VIDEO, TABLE]);
  const row = [...container.querySelectorAll("li button")].find((b) =>
    b.textContent!.includes("Table · 9 rows"),
  )!;
  expect(row.textContent).toBe("CostsTable · 9 rows");
  await act(async () => (row as HTMLButtonElement).click());
  const sheet = document.body.querySelector('[role="dialog"]')!;
  expect(sheet.textContent).toContain("Download CSV");
  expect(sheet.textContent).toContain("Fix 8");
});

it("leads with a recording and lists the screenshots and other recordings", async () => {
  const second: AldoArtifact = { ...VIDEO, url: `${RECORDING.slice(0, -4)}b.mp4`, title: "Mobile" };
  await render([PICTURE, VIDEO, second]);
  expect(container.querySelectorAll("video")).toHaveLength(1);
  expect([...container.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
    "CatPicture",
    "MobileVideo",
  ]);
});

it("shows a page as a picture of its top that takes no taps, its title under it, and opens it whole", async () => {
  await render([PAGE_FILE]);
  const frame = container.querySelector("iframe")!;
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame.getAttribute("src")).toBe(`${PAGE}?in=chat`);
  expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(frame.getAttribute("loading")).toBe("lazy");
  expect(frame.classList).toContain("pointer-events-none");
  expect(frame.tabIndex).toBe(-1);
  const card = container.querySelector<HTMLButtonElement>('button[aria-label="Open Launch page"]')!;
  expect(card.textContent).toBe("Launch pagePage");
  expect(container.querySelector("ul")).toBeNull();
  await act(async () => card.click());
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
  await render([PICTURE]);
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

it("lists a picture by its icon when its thumbnail won't load", async () => {
  await render([TABLE, PICTURE]);
  await act(async () => container.querySelector("li img")!.dispatchEvent(new Event("error")));
  expect(container.querySelector("li img")).toBeNull();
  expect(container.querySelector("li svg")).not.toBeNull();
  expect(container.querySelector("li")!.textContent).toBe("CatPicture");
});

it("says so, in a tile with a retry, for a sound that won't load, without scrolling sideways", async () => {
  const sound: AldoArtifact = {
    kind: "file",
    url: "/s/soundsoundsound9999",
    title: "Voice note",
    contentType: "audio/mpeg",
  };
  await render([sound]);
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
  await render([VIDEO]);
  const video = container.querySelector("video")!;
  expect(video.closest("figure")!.textContent).toContain("Checkout fix");
  expect(
    container.querySelector<HTMLAnchorElement>('a[aria-label="Save Checkout fix"]')!.href,
  ).toBe(`${RECORDING}?download=1`);
});

it("draws a chart from its data, a few bars in place and all of them full screen with the data to save", async () => {
  await render([PICTURE, CHART]);
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
  await render([net]);
  const bars = [...container.querySelectorAll<HTMLElement>('[role="img"] .rounded-full')].map(
    (bar) => [parseFloat(bar.style.left), parseFloat(bar.style.width)],
  );
  // On a scale from -100 to 50, zero sits two thirds of the way along.
  expect(bars[0]![0]).toBeCloseTo(60);
  expect(bars[0]![1]).toBeCloseTo(6.67, 1);
  expect(bars[1]).toEqual([0, expect.closeTo(66.67, 1)]);
  expect(bars[2]).toEqual([expect.closeTo(66.67, 1), expect.closeTo(33.33, 1)]);
});

it("closes a table's sheet for good: closing it doesn't open it again", async () => {
  await render([TABLE]);
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
  await render([holders]);
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
  await render([revenue]);
  const chart = container.querySelector('svg[role="img"][aria-label="Revenue"]')!;
  // A segment for each value but the one that's nothing.
  expect(chart.querySelectorAll("path")).toHaveLength(5);
  const figures = chart.closest("section")!.querySelector("p")!.textContent;
  expect(figures).toContain("Q3");
  expect(figures).toContain("US$5");
  expect(figures).toContain("EU$0");
});

const fills = (chart: Element) =>
  [...chart.querySelectorAll<SVGElement>("path, polygon, circle")].map((e) =>
    e.getAttribute("fill"),
  );

it("colors every series and slice apart by default, however many there are", async () => {
  const names = Array.from({ length: 6 }, (_, i) => `S${i}`);
  const lines: AldoArtifact = {
    kind: "chart",
    title: "Six lines",
    type: "line",
    labels: ["a", "b"],
    series: names.map((name, i) => ({ name, values: [i, i + 1] })),
  };
  const pie: AldoArtifact = {
    kind: "chart",
    title: "Eleven slices",
    type: "donut",
    labels: Array.from({ length: 11 }, (_, i) => `P${i}`),
    series: [{ name: "Share", values: Array.from({ length: 11 }, () => 1) }],
  };
  await render([lines, pie]);
  const strokes = [...container.querySelectorAll('svg[aria-label="Six lines"] polyline')].map((e) =>
    e.getAttribute("stroke"),
  );
  expect(new Set(strokes).size).toBe(6);
  const slices = fills(container.querySelector('[aria-label="Eleven slices"]')!);
  expect(new Set(slices).size).toBe(11);
  expect(slices).not.toContain("var(--muted-foreground)");
});

it("draws exactly the colors it was given: a series', a pie's slices', a scatter point's", async () => {
  const column: AldoArtifact = {
    kind: "chart",
    title: "Gain and loss",
    type: "column",
    labels: ["a", "b"],
    series: [
      { name: "Gain", values: [1, 2], color: "#16a34a" },
      { name: "Loss", values: [2, 1], color: "#dc2626" },
    ],
  };
  const pie: AldoArtifact = {
    kind: "chart",
    title: "Split",
    type: "pie",
    labels: ["A", "B", "C"],
    series: [{ name: "Share", values: [1, 2, 3], colors: ["#ea580c", "", "#16a34a"] }],
  };
  const scatter: AldoArtifact = {
    kind: "chart",
    title: "Points",
    type: "scatter",
    labels: [],
    series: [
      {
        name: "Cos",
        values: [],
        color: "#7c3aed",
        points: [
          { x: 1, y: 2, color: "#0ea5e9" },
          { x: 2, y: 3 },
        ],
      },
    ],
  };
  await render([column, pie, scatter]);
  const of = (title: string) => fills(container.querySelector(`[aria-label="${title}"]`)!);
  expect(new Set(of("Gain and loss"))).toEqual(new Set(["#16a34a", "#dc2626"]));
  expect(of("Split")).toEqual(["#ea580c", "#e8743b", "#16a34a"]);
  expect(of("Points")).toEqual(["#0ea5e9", "#7c3aed"]);
});
