// A grid of a message's media, rendered from its Markdown: it copies back as Markdown that makes
// the same grid, and a video's tile opens the viewer at its fragment (`#t=12`).

import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { render } from "../../test/render";

import ChatMarkdown from "../components/ChatMarkdown";
import { markdownImageItems } from "../components/chat/markdownImageGallery";
import { serializeRenderedMarkdownFragment } from "../markdown-clipboard";

const threadRef = { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") };

const grid = (markdown: string) =>
  render(<ChatMarkdown cwd="/w" threadRef={threadRef} text={markdown} mediaGrid />);

it("copies a grid as its media on lines of their own, a video link as the link", async () => {
  await using screen = await grid(
    '![a](https://img.test/a.png)\n![b](https://img.test/b.png)\n\n**[clip](/w/clip.mp4 "The cut")**',
  );
  const host = screen.container;
  expect(host.querySelectorAll("[data-markdown-gallery-video]")).toHaveLength(1);
  expect(serializeRenderedMarkdownFragment(host).trim()).toBe(
    '![a](https://img.test/a.png)\n![b](https://img.test/b.png)\n**[clip](/w/clip.mp4 "The cut")**',
  );
});

it("opens a video's tile in the viewer at its fragment", async () => {
  await using screen = await grid("![a](https://img.test/a.png)\n\n[reel](/w/reel.mov#t=12)");
  const tile = screen.container.querySelector("[data-markdown-gallery-video]")!;
  expect(markdownImageItems.get(tile)?.srcFragment).toBe("#t=12");
});
