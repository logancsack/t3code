import { describe, expect, it } from "vite-plus/test";

import {
  aldoFileCount,
  aldoOffersZip,
  aldoZipFiles,
  aldoZipKey,
  aldoZipLabel,
  aldoZipLeftLines,
  aldoZipMadeText,
  aldoZipOf,
  formatAldoZipSize,
} from "./download.logic";
import type { AldoMadeItem } from "./made.logic";

const ROOT = "/vercel/work/general";

describe("aldoZipFiles", () => {
  it("takes each file on the computer once, under the name the results show", () => {
    const items: AldoMadeItem[] = [
      { path: "out/deck.pptx", name: "deck.pptx", kind: "deck", sharedAs: "Q3 board deck" },
      { path: "out/model.xlsx", name: "model.xlsx", kind: "sheet" },
      { path: null, name: "chart.png", kind: "image", sourcePath: "/vercel/work/aldo/chart.png" },
      // The same file shared again.
      { path: "out/model.xlsx", name: "model.xlsx", kind: "sheet", sharedAs: "Model" },
    ];
    expect(aldoZipFiles(items, `${ROOT}/`)).toEqual({
      files: [
        { path: `${ROOT}/out/deck.pptx`, name: "Q3 board deck" },
        { path: `${ROOT}/out/model.xlsx`, name: "model.xlsx" },
        { path: "/vercel/work/aldo/chart.png", name: "chart.png" },
      ],
      links: [],
    });
  });

  it("names the links with no file on the computer, which can't go in", () => {
    const items: AldoMadeItem[] = [
      { path: "a.md", name: "a.md", kind: "document" },
      {
        path: null,
        name: "Shared file",
        kind: "page",
        sharedAs: "Launch page",
        url: "https://aldo.computer/s/x",
      },
      { path: null, name: "relative.md", kind: "document", sourcePath: "relative.md" },
    ];
    expect(aldoZipFiles(items, ROOT)).toEqual({
      files: [{ path: `${ROOT}/a.md`, name: "a.md" }],
      links: ["Launch page"],
    });
  });

  it("offers a zip for more than one file", () => {
    const one = [{ path: "/a", name: "a" }];
    expect(aldoOffersZip([])).toBe(false);
    expect(aldoOffersZip(one)).toBe(false);
    expect(aldoOffersZip([...one, { path: "/b", name: "b" }])).toBe(true);
  });

  it("keys the same files in any order alike, and other machines apart", () => {
    const a = { path: "/w/a", name: "a" };
    const b = { path: "/w/b", name: "b" };
    expect(aldoZipKey("env", [a, b])).toBe(aldoZipKey("env", [b, a]));
    expect(aldoZipKey("env", [a, b])).not.toBe(aldoZipKey("other", [a, b]));
  });
});

describe("words", () => {
  it("says the size as the prototype does", () => {
    expect(formatAldoZipSize(300)).toBe("1 KB");
    expect(formatAldoZipSize(820 * 1024)).toBe("820 KB");
    expect(formatAldoZipSize(4.24 * 1024 * 1024)).toBe("4.2 MB");
    expect(formatAldoZipSize(57.4 * 1024 * 1024)).toBe("57 MB");
    expect(formatAldoZipSize(1.1 * 1024 * 1024 * 1024)).toBe("1.1 GB");
    expect(aldoZipLabel(57 * 1024 * 1024)).toBe("Download everything (zip, 57 MB)");
    expect(aldoZipLabel(null)).toBe("Download everything (zip)");
    expect(aldoZipLabel(0)).toBe("Download everything (zip)");
  });

  it("counts files in words to nine", () => {
    expect(aldoFileCount(1)).toBe("one file");
    expect(aldoFileCount(3)).toBe("three files");
    expect(aldoFileCount(12)).toBe("12 files");
  });

  it("says what it's downloading and what didn't go in", () => {
    expect(
      aldoZipMadeText({
        bytes: 57 * 1024 * 1024,
        files: 3,
        left: [],
        url: "https://x",
        name: "Quarterly report.zip",
        expiresAt: null,
      }),
    ).toBe("Downloading Quarterly report.zip: three files, 57 MB.");
    expect(
      aldoZipLeftLines(
        [
          { name: "deck.pptx", why: "it’s no longer on its computer" },
          { name: "keys.md", why: "it holds the value of STRIPE_KEY from your vault" },
        ],
        ["Launch page"],
      ),
    ).toEqual([
      "deck.pptx isn’t in it: it’s no longer on its computer.",
      "keys.md isn’t in it: it holds the value of STRIPE_KEY from your vault.",
      "Launch page isn’t in it: it’s a link, with no file on its computer.",
    ]);
  });
});

describe("aldoZipOf", () => {
  it("reads Aldo's answer, keeping only what it should", () => {
    expect(
      aldoZipOf({
        bytes: 10,
        files: 2,
        left: [{ name: "a", why: "b" }, { name: 1 }, null],
        url: "https://sb-1-3780.sail.box/downloads/abc?token=t",
        name: "Results.zip",
        expiresAt: "2026-10-20T10:00:00.000Z",
      }),
    ).toEqual({
      bytes: 10,
      files: 2,
      left: [{ name: "a", why: "b" }],
      url: "https://sb-1-3780.sail.box/downloads/abc?token=t",
      name: "Results.zip",
      expiresAt: "2026-10-20T10:00:00.000Z",
    });
    expect(aldoZipOf({ bytes: 1, files: 1, url: "javascript:alert(1)" })?.url).toBeNull();
    expect(aldoZipOf({ bytes: 1, files: 1 })).toEqual({
      bytes: 1,
      files: 1,
      left: [],
      url: null,
      name: null,
      expiresAt: null,
    });
    expect(aldoZipOf({ error: "x" })).toBeNull();
    expect(aldoZipOf(null)).toBeNull();
  });
});
