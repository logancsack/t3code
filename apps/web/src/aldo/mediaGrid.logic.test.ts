import { describe, expect, it } from "vite-plus/test";

import {
  aldoParagraphMedia,
  groupAldoMediaRuns,
  isAldoVideoLink,
  rehypeAldoMediaGrid,
  type MediaGridNode,
} from "./mediaGrid.logic";

const text = (value: string): MediaGridNode => ({ type: "text", value });
const img = (src: string, alt = src): MediaGridNode => ({
  type: "element",
  tagName: "img",
  properties: { src, alt },
  children: [],
});
const link = (href: string, ...children: MediaGridNode[]): MediaGridNode => ({
  type: "element",
  tagName: "a",
  properties: { href },
  children,
});
const el = (tagName: string, ...children: MediaGridNode[]): MediaGridNode => ({
  type: "element",
  tagName,
  children,
});
const p = (...children: MediaGridNode[]) => el("p", ...children);
const br = () => el("br");
const grid = (...children: MediaGridNode[]): MediaGridNode => ({
  type: "element",
  tagName: "div",
  properties: { dataAldoMediaGrid: children.length },
  children,
});

// The shapes below are what react-markdown's parser makes of each message.
describe("groupAldoMediaRuns", () => {
  it("makes images one per line in a paragraph a grid", () => {
    // ![a](a.png)\n![b](b.png)
    const tree = [p(img("a.png"), text("\n"), img("b.png"))];
    expect(groupAldoMediaRuns(tree, "all")).toEqual([grid(img("a.png"), img("b.png"))]);
  });

  it("makes them a grid when single newlines are hard breaks too", () => {
    const tree = [p(img("a.png"), br(), text("\n"), img("b.png"))];
    expect(groupAldoMediaRuns(tree, "all")).toEqual([grid(img("a.png"), img("b.png"))]);
  });

  it("leaves images that share a line alone, like a row of badges", () => {
    // ![a](a.svg) ![b](b.svg)
    const tree = [p(img("a.svg"), text(" "), img("b.svg"))];
    expect(groupAldoMediaRuns(tree, "all")).toEqual(tree);
  });

  it("leaves a single image alone", () => {
    const tree = [p(img("a.png")), text("\n"), p(text("Done."))];
    expect(groupAldoMediaRuns(tree, "all")).toEqual(tree);
  });

  it("joins paragraphs that are each an image or a video, across blank lines", () => {
    // ![a](a.png)\n\n[Logo reel](/w/reel.mp4)\n\n![b](b.png)
    const tree = [
      p(text("Here they are:")),
      text("\n"),
      p(img("a.png")),
      text("\n"),
      p(link("/w/reel.mp4", text("Logo reel"))),
      text("\n"),
      p(img("b.png")),
      text("\n"),
      p(text("All checked.")),
    ];
    expect(groupAldoMediaRuns(tree, "all")).toEqual([
      p(text("Here they are:")),
      text("\n"),
      grid(img("a.png"), img("/w/reel.mp4", "Logo reel"), img("b.png")),
      p(text("All checked.")),
    ]);
  });

  it("joins a paragraph of images with the ones after it", () => {
    const tree = [p(img("a.png"), text("\n"), img("b.png")), text("\n"), p(img("c.png"))];
    expect(groupAldoMediaRuns(tree, "all")).toEqual([
      grid(img("a.png"), img("b.png"), img("c.png")),
    ]);
  });

  it("keeps a linked image's link, so it still opens the page", () => {
    const first = link("https://fiverr.com/a", img("a.png"));
    const second = link("https://fiverr.com/b", img("b.png"));
    const tree = [p(first, text("\n"), second)];
    expect(groupAldoMediaRuns(tree, "all")).toEqual([grid(first, second)]);
  });

  it("takes a video link in bold, as it plays in place", () => {
    const tree = [p(img("a.png")), text("\n"), p(el("strong", link("/w/clip.mp4", text("clip"))))];
    expect(groupAldoMediaRuns(tree, "all")).toEqual([
      grid(img("a.png"), img("/w/clip.mp4", "clip")),
    ]);
  });

  it("breaks a run at anything else", () => {
    const tree = [p(img("a.png")), text("\n"), p(text("and")), text("\n"), p(img("b.png"))];
    expect(groupAldoMediaRuns(tree, "all")).toEqual(tree);
  });

  it("leaves video links out where they wouldn't play", () => {
    const tree = [p(img("a.png")), text("\n"), p(link("out/clip.mp4", text("clip.mp4")))];
    // Without the thread's folder a relative path can't be found; without a thread, none can.
    expect(groupAldoMediaRuns(tree, "absolute")).toEqual(tree);
    expect(
      groupAldoMediaRuns([p(img("a.png")), text("\n"), p(link("/w/c.mp4", text("c")))], "none"),
    ).toEqual([p(img("a.png")), text("\n"), p(link("/w/c.mp4", text("c")))]);
  });

  it("leaves a link to a page or a document alone", () => {
    const tree = [p(img("a.png")), text("\n"), p(link("https://example.com", text("Site")))];
    expect(groupAldoMediaRuns(tree, "all")).toEqual(tree);
    const doc = [p(img("a.png")), text("\n"), p(link("/w/notes.md", text("notes.md")))];
    expect(groupAldoMediaRuns(doc, "all")).toEqual(doc);
  });
});

describe("aldoParagraphMedia", () => {
  it("is null for a paragraph with words in it", () => {
    expect(aldoParagraphMedia(p(img("a.png"), text("\nThe logo")), "all")).toBeNull();
  });

  it("keeps a drive path where the image renderer reads it", () => {
    expect(aldoParagraphMedia(p(link("C:\\out\\clip.mp4", text("clip"))), "absolute")).toEqual([
      {
        type: "element",
        tagName: "img",
        properties: { src: "C:\\out\\clip.mp4", alt: "clip", dataLocalSrc: "C:\\out\\clip.mp4" },
        children: [],
      },
    ]);
  });
});

describe("isAldoVideoLink", () => {
  it("is a video file in the thread's files", () => {
    expect(isAldoVideoLink("/vercel/work/x/reel.mp4", "absolute")).toBe(true);
    expect(isAldoVideoLink("file:///vercel/work/x/reel.webm", "absolute")).toBe(true);
    expect(isAldoVideoLink("/w/reel.mov#t=12", "absolute")).toBe(true);
    expect(isAldoVideoLink("out/reel.mp4", "all")).toBe(true);
  });

  it("isn't a page, a line in a file or another kind of file", () => {
    expect(isAldoVideoLink("https://example.com/reel.mp4", "all")).toBe(false);
    expect(isAldoVideoLink("//cdn.example.com/reel.mp4", "all")).toBe(false);
    expect(isAldoVideoLink("/w/reel.mp4#L12", "all")).toBe(false);
    expect(isAldoVideoLink("/w/notes.md", "all")).toBe(false);
    expect(isAldoVideoLink("out/reel.mp4", "absolute")).toBe(false);
    expect(isAldoVideoLink("/w/reel.mp4", "none")).toBe(false);
  });
});

describe("rehypeAldoMediaGrid", () => {
  it("groups the message's top-level runs", () => {
    const tree: MediaGridNode = {
      type: "root",
      children: [p(img("a.png"), text("\n"), img("b.png"))],
    };
    rehypeAldoMediaGrid({ videoLinks: "none" })(tree);
    expect(tree.children).toEqual([grid(img("a.png"), img("b.png"))]);
  });
});
