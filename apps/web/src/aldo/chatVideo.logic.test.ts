import { describe, expect, it } from "vite-plus/test";

import {
  chatVideoWidth,
  isVideoFile,
  soleParagraphLink,
  type ChatMarkdownNode,
} from "./chatVideo.logic";

const text = (value: string): ChatMarkdownNode => ({ type: "text", value });
const link = (href: string, label = href): ChatMarkdownNode => ({
  type: "element",
  tagName: "a",
  properties: { href },
  children: [text(label)],
});
const element = (tagName: string, children: ChatMarkdownNode[]): ChatMarkdownNode => ({
  type: "element",
  tagName,
  children,
});
const paragraph = (...children: ChatMarkdownNode[]) => element("p", children);

describe("soleParagraphLink", () => {
  it("reads a link on a line of its own", () => {
    expect(soleParagraphLink(paragraph(link("out/clip.mp4")))).toBe("out/clip.mp4");
    expect(soleParagraphLink(paragraph(text("\n"), link("out/clip.mp4"), text(" ")))).toBe(
      "out/clip.mp4",
    );
  });

  it("reads through bold and italic", () => {
    expect(soleParagraphLink(paragraph(element("strong", [link("clip.mp4")])))).toBe("clip.mp4");
    expect(
      soleParagraphLink(paragraph(element("em", [element("strong", [link("clip.mp4")])]))),
    ).toBe("clip.mp4");
  });

  it("leaves a link inside a sentence alone", () => {
    expect(soleParagraphLink(paragraph(text("Here it is: "), link("clip.mp4")))).toBeNull();
    expect(soleParagraphLink(paragraph(link("clip.mp4"), text(".")))).toBeNull();
    expect(soleParagraphLink(paragraph(link("a.mp4"), text(" "), link("b.mp4")))).toBeNull();
    expect(
      soleParagraphLink(paragraph(element("strong", [text("Clip: "), link("clip.mp4")]))),
    ).toBeNull();
  });

  it("needs a link with a destination", () => {
    expect(soleParagraphLink(undefined)).toBeNull();
    expect(soleParagraphLink(paragraph())).toBeNull();
    expect(soleParagraphLink(paragraph(element("code", [text("clip.mp4")])))).toBeNull();
    expect(soleParagraphLink(paragraph(link("")))).toBeNull();
  });
});

describe("isVideoFile", () => {
  it("knows video files by their extension", () => {
    expect(isVideoFile("/vercel/work/aldo/out/clip.mp4")).toBe(true);
    expect(isVideoFile("C:\\renders\\Clip.MOV")).toBe(true);
    expect(isVideoFile("out/clip.webm")).toBe(true);
  });

  it("leaves other files alone", () => {
    expect(isVideoFile("out/still.png")).toBe(false);
    expect(isVideoFile("src/video.ts")).toBe(false);
    expect(isVideoFile("out/mp4")).toBe(false);
    expect(isVideoFile("out/.mp4")).toBe(false);
  });
});

describe("chatVideoWidth", () => {
  it("fills the column up to 40rem, and keeps tall videos at most 32rem high", () => {
    expect(chatVideoWidth(16 / 9)).toBe("min(100%, 40rem, 56.889rem)");
    expect(chatVideoWidth(9 / 16)).toBe("min(100%, 40rem, 18rem)");
    expect(chatVideoWidth(1)).toBe("min(100%, 40rem, 32rem)");
  });

  it("assumes 16:9 until it knows", () => {
    expect(chatVideoWidth(Number.NaN)).toBe(chatVideoWidth(16 / 9));
    expect(chatVideoWidth(0)).toBe(chatVideoWidth(16 / 9));
  });
});
