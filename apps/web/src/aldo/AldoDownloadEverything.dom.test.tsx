// @vitest-environment jsdom

import type { ScopedThreadRef } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const aldo = vi.hoisted(() => ({
  zips: false,
  asleep: false,
  woken: 0,
  asks: [] as { check: boolean; name?: string | undefined }[],
  answer: null as unknown,
  /** How many files a size check says go in; else all of them. */
  checkFiles: null as number | null,
}));
vi.mock("./directory", () => ({
  aldoZipsResults: () => aldo.zips,
  aldoMachineIsAsleep: () => aldo.asleep,
  subscribeAldoEnvironments: () => () => {},
  wakeAldoEnvironment: async () => {
    aldo.woken += 1;
    aldo.asleep = false;
  },
}));
vi.mock("./workspaceApi", async () => {
  const { AldoApiError } = await import("./api");
  return {
    zipAldoFiles: async (
      _environmentId: string,
      files: ReadonlyArray<unknown>,
      options: { check: boolean; name?: string },
    ) => {
      aldo.asks.push(options);
      if (aldo.asleep) {
        throw new AldoApiError(
          409,
          "Its computer is asleep. Making the zip wakes it, which takes about 20 seconds.",
          {
            asleep: true,
          },
        );
      }
      if (options.check)
        return {
          bytes: 57 * 1024 * 1024,
          files: aldo.checkFiles ?? files.length,
          left: [],
          url: null,
          name: null,
          expiresAt: null,
        };
      return aldo.answer;
    },
  };
});
vi.mock("../state/entities", () => ({ useThreadShell: () => ({ title: "Quarterly report" }) }));

const { AldoDownloadEverything } = await import("./AldoDownloadEverything");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ref = { environmentId: "aldo-t1", threadId: "c1" } as unknown as ScopedThreadRef;
let files = [
  { path: "/vercel/work/general/deck.pptx", name: "Q3 board deck" },
  { path: "/vercel/work/general/model.xlsx", name: "model.xlsx" },
];
let host: HTMLDivElement;
let root: Root;
const clicked: string[] = [];

beforeEach(() => {
  Object.assign(aldo, {
    zips: true,
    asleep: false,
    woken: 0,
    asks: [],
    answer: null,
    checkFiles: null,
  });
  // Each test its own files, so no size is known from another.
  files = files.map((file) => ({ ...file, path: `${file.path}.${Math.random()}` }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this.href);
  });
  clicked.length = 0;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const render = (shown = files) =>
  act(async () =>
    root.render(<AldoDownloadEverything threadRef={ref} files={shown} links={["Launch page"]} />),
  );
const made = (url: string) => ({
  bytes: 1000,
  files: 2,
  left: [],
  url,
  name: "Quarterly report.zip",
  expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
});
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((element) => element.textContent?.includes(text));

it("shows nothing where Aldo can't make zips", async () => {
  aldo.zips = false;
  await render();
  expect(host.textContent).toBe("");
  expect(aldo.asks).toEqual([]);
});

it("says the size its computer gave, then downloads the zip it makes", async () => {
  aldo.answer = {
    bytes: 1000,
    files: 2,
    left: [{ name: "keys.md", why: "it holds the value of STRIPE_KEY from your vault" }],
    url: "https://sb-1-3780.sail.box/downloads/abcdefghijklmnopqrstuv?token=t",
    name: "Quarterly report.zip",
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
  await render();
  expect(aldo.asks).toEqual([{ check: true }]);
  expect(host.textContent).toContain("Download everything (zip, 57 MB)");
  await act(async () => button("Download everything")!.click());
  expect(aldo.asks.at(-1)).toEqual({ check: false, name: "Quarterly report" });
  expect(clicked).toEqual(["https://sb-1-3780.sail.box/downloads/abcdefghijklmnopqrstuv?token=t"]);
  expect(host.textContent).toContain("Downloading Quarterly report.zip: two files, 1 KB.");
  expect(host.textContent).toContain(
    "keys.md isn’t in it: it holds the value of STRIPE_KEY from your vault.",
  );
  expect(host.textContent).toContain(
    "Launch page isn’t in it: it’s a link, with no file on its computer.",
  );
  expect(host.querySelector("a")?.textContent).toBe("Download it again");
});

it("asks before waking a computer asleep, and never asks it the size", async () => {
  aldo.asleep = true;
  aldo.answer = {
    bytes: 2048,
    files: 2,
    left: [],
    url: "https://sb-1-3780.sail.box/downloads/abcdefghijklmnopqrstuv?token=t",
    name: "Quarterly report.zip",
    expiresAt: null,
  };
  await render();
  expect(aldo.asks).toEqual([]);
  expect(host.textContent).toContain("Download everything (zip)");
  await act(async () => button("Download everything")!.click());
  expect(host.textContent).toContain(
    "Its computer is asleep. Making the zip wakes it, which takes about 20 seconds.",
  );
  expect(aldo.woken).toBe(0);
  await act(async () => button("Not now")!.click());
  expect(host.textContent).not.toContain("asleep");
  await act(async () => button("Download everything")!.click());
  await act(async () => button("Wake it and make the zip")!.click());
  expect(aldo.woken).toBe(1);
  expect(clicked).toHaveLength(1);
});

it("says a refusal in Aldo's words, offering to try again only where that can help", async () => {
  await render();
  aldo.answer = {
    bytes: 0,
    files: 0,
    left: [{ name: "gone.pdf", why: "it’s no longer on its computer" }],
  };
  await act(async () => button("Download everything")!.click());
  expect(host.querySelector("[role=alert]")?.textContent).toBe("Nothing could go in the zip.");
  expect(host.textContent).toContain("gone.pdf isn’t in it: it’s no longer on its computer.");
  expect(button("Try again")).toBeUndefined();
  expect(clicked).toEqual([]);
});

it("starts again for a later turn's files: the last zip's link goes, and one still being made comes to nothing", async () => {
  aldo.answer = made("https://sb-1-3780.sail.box/downloads/first?token=t");
  await render();
  await act(async () => button("Download everything")!.click());
  expect(host.querySelector("a")?.textContent).toBe("Download it again");
  const later = [
    ...files,
    { path: `/vercel/work/general/notes.md.${Math.random()}`, name: "notes.md" },
  ];
  await render(later);
  expect(host.querySelector("a")).toBeNull();
  expect(button("Download everything")).toBeDefined();

  // Asked for, then the files change before it's made.
  let release: (zip: unknown) => void = () => {};
  aldo.answer = new Promise((resolve) => (release = resolve));
  await act(async () => button("Download everything")!.click());
  expect(host.textContent).toContain("Making the zip…");
  await render([
    ...later,
    { path: `/vercel/work/general/more.md.${Math.random()}`, name: "more.md" },
  ]);
  await act(async () => release(made("https://sb-1-3780.sail.box/downloads/stale?token=t")));
  expect(clicked).toEqual(["https://sb-1-3780.sail.box/downloads/first?token=t"]);
  expect(host.querySelector("a")).toBeNull();
  expect(host.textContent).not.toContain("Making the zip");
});

it("a size stops being shown after five minutes, and one of nothing shows the action again", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  aldo.checkFiles = 0;
  await render();
  expect(host.textContent).toBe("");
  aldo.checkFiles = null;
  await act(async () => {
    vi.advanceTimersByTime(5 * 60_000);
  });
  expect(aldo.asks).toEqual([{ check: true }, { check: true }]);
  expect(host.textContent).toContain("Download everything (zip, 57 MB)");
});
