import { describe, expect, it } from "vite-plus/test";

import {
  ALDO_SHARE_LIMITS,
  aldoShareKey,
  aldoShareKeyIsFor,
  aldoSharePrompt,
  aldoShareRefusedNotice,
  fitAldoSharedFiles,
  parseAldoShareDetails,
  parseAldoShareParam,
  sortAldoSharedFiles,
} from "./shareTarget.logic";

const file = (name: string, type: string, size = 100) => ({ name, type, size });

describe("share to Aldo", () => {
  it("reads which share the app was opened with", () => {
    expect(parseAldoShareParam("?share=lq3k9x2a-0f3c9a7b1d2e4f60")).toEqual({
      kind: "kept",
      id: "lq3k9x2a-0f3c9a7b1d2e4f60",
    });
    expect(parseAldoShareParam("?share=missed")).toEqual({ kind: "missed" });
    expect(parseAldoShareParam("?handoff=ho_1")).toBeNull();
    expect(parseAldoShareParam("")).toBeNull();
    // Nothing that could name another path in the cache.
    expect(parseAldoShareParam("?share=../../assets/index")).toBeNull();
    expect(parseAldoShareParam("?share=abc-def/0")).toBeNull();
    expect(parseAldoShareParam("?share=ABC-def")).toBeNull();
  });

  it("finds a share's entries where Aldo's worker keeps them", () => {
    expect(aldoShareKey("abc-def")).toBe("/aldo-share/abc-def");
    expect(aldoShareKey("abc-def", 2)).toBe("/aldo-share/abc-def/2");
    expect(aldoShareKeyIsFor("/aldo-share/abc-def", "abc-def")).toBe(true);
    expect(aldoShareKeyIsFor("/aldo-share/abc-def/0", "abc-def")).toBe(true);
    expect(aldoShareKeyIsFor("/aldo-share/abc-defg", "abc-def")).toBe(false);
    expect(aldoShareKeyIsFor("/aldo-share/abc-de/0", "abc-def")).toBe(false);
  });

  it("reads a share's details, whatever shape they're in", () => {
    expect(
      parseAldoShareDetails({
        title: "Juniper",
        text: "Dinner Friday?",
        url: "https://juniper.example",
        files: [{ name: "menu.jpg", type: "image/jpeg", size: 11 }],
      }),
    ).toEqual({
      title: "Juniper",
      text: "Dinner Friday?",
      url: "https://juniper.example",
      files: [{ name: "menu.jpg", type: "image/jpeg", size: 11 }],
    });
    expect(parseAldoShareDetails({ text: 4, files: [null, { size: "big" }] })).toEqual({
      title: "",
      text: "",
      url: "",
      files: [
        { name: "file", type: "", size: 0 },
        { name: "file", type: "", size: 0 },
      ],
    });
    expect(parseAldoShareDetails(null)).toBeNull();
    expect(parseAldoShareDetails("text")).toBeNull();
  });

  it("puts a share's words in the prompt, saying each thing once", () => {
    // A page from a browser: its title, and its link in the words.
    expect(
      aldoSharePrompt({
        title: "Juniper | Menu",
        text: "https://juniper.example/menu",
        url: "",
      }),
    ).toBe("Juniper | Menu\nhttps://juniper.example/menu");
    expect(
      aldoSharePrompt({ title: "", text: "Look at this", url: "https://juniper.example" }),
    ).toBe("Look at this\nhttps://juniper.example");
    expect(
      aldoSharePrompt({
        title: "Juniper",
        text: "Juniper has a table at 8",
        url: "https://juniper.example",
      }),
    ).toBe("Juniper has a table at 8\nhttps://juniper.example");
    expect(
      aldoSharePrompt({
        title: "https://juniper.example",
        text: "",
        url: "https://juniper.example",
      }),
    ).toBe("https://juniper.example");
    expect(aldoSharePrompt({ title: " ", text: "", url: "" })).toBe("");
  });

  it("attaches what the composer takes, in the order shared", () => {
    const sorted = sortAldoSharedFiles([
      file("menu.jpg", "image/jpeg"),
      file("report.pdf", "application/pdf"),
      file("IMG_0001.HEIC", ""),
      file("photo.png", "application/octet-stream"),
      file("clip.mp4", "video/mp4"),
      file("drawing.bmp", "image/bmp"),
      file("empty.txt", "text/plain", 0),
      file("empty.jpg", "image/jpeg", 0),
      file("huge.zip", "application/zip", ALDO_SHARE_LIMITS.fileBytes + 1),
    ]);
    expect(sorted.refused).toEqual([
      { name: "drawing.bmp", why: "unsupported-image" },
      { name: "empty.txt", why: "empty" },
      { name: "empty.jpg", why: "empty" },
    ]);
    const fit = fitAldoSharedFiles(sorted.candidates, new Set());
    expect(fit.taken.map(({ kind, file }) => `${kind} ${file.name}`)).toEqual([
      "image menu.jpg",
      "file report.pdf",
      "image IMG_0001.HEIC",
      "image photo.png",
      "file clip.mp4",
    ]);
    expect(fit.refused).toEqual([{ name: "huge.zip", why: "too-large" }]);
  });

  it("attaches no more than a message takes, an image that couldn't be made ready leaving its place to the next", () => {
    const many = Array.from({ length: 10 }, (_, i) => file(`photo-${i}.jpg`, "image/jpeg"));
    const { candidates } = sortAldoSharedFiles(many);
    const limits = { attachments: 8, fileBytes: 1000 };
    expect(fitAldoSharedFiles(candidates, new Set(), limits).refused).toEqual([
      { name: "photo-8.jpg", why: "too-many" },
      { name: "photo-9.jpg", why: "too-many" },
    ]);
    const fit = fitAldoSharedFiles(candidates, new Set([candidates[2]!]), limits);
    expect(fit.taken.map(({ file }) => file.name)).not.toContain("photo-2.jpg");
    expect(fit.taken).toHaveLength(8);
    expect(fit.refused).toEqual([{ name: "photo-9.jpg", why: "too-many" }]);
  });

  it("attaches files only as the draft's computer takes them", () => {
    const { candidates } = sortAldoSharedFiles([
      file("menu.jpg", "image/jpeg"),
      file("report.pdf", "application/pdf", 500),
      file("notes.txt", "text/plain", 50),
    ]);
    const none = fitAldoSharedFiles(candidates, new Set(), { attachments: 8, fileBytes: null });
    expect(none.taken.map(({ file }) => file.name)).toEqual(["menu.jpg"]);
    expect(none.refused).toEqual([
      { name: "report.pdf", why: "no-files" },
      { name: "notes.txt", why: "no-files" },
    ]);
    const small = fitAldoSharedFiles(candidates, new Set(), { attachments: 8, fileBytes: 100 });
    expect(small.taken.map(({ file }) => file.name)).toEqual(["menu.jpg", "notes.txt"]);
    expect(small.refused).toEqual([{ name: "report.pdf", why: "too-large" }]);
    expect(aldoShareRefusedNotice(none.refused.slice(0, 1))?.description).toBe(
      "'report.pdf' couldn't be attached: this thread's computer doesn't take files.",
    );
  });

  it("names what wasn't attached, and why", () => {
    expect(aldoShareRefusedNotice([])).toBeNull();
    expect(aldoShareRefusedNotice([{ name: "drawing.bmp", why: "unsupported-image" }])).toEqual({
      title: "A shared file wasn't attached",
      description: "'drawing.bmp' isn't an image Aldo can attach (GIF, HEIC, JPEG, PNG or WebP).",
    });
    const notice = aldoShareRefusedNotice(
      [
        { name: "huge.zip", why: "too-large" },
        { name: "photo-8.jpg", why: "too-many" },
        { name: "scan.jpg", why: "unreadable" },
        { name: "pano.jpg", why: "image-too-large" },
        { name: "lost.pdf", why: "missing" },
      ],
      { attachments: 8, fileBytes: 50 * 1024 * 1024 },
    );
    expect(notice?.title).toBe("5 shared files weren't attached");
    expect(notice?.description).toBe(
      "'huge.zip' exceeds the 50 MB attachment limit. 'photo-8.jpg' didn't fit: a message takes up to 8 attachments. 'scan.jpg' couldn't be read. And 2 more.",
    );
  });
});
