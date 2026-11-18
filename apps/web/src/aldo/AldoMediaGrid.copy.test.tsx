// @vitest-environment jsdom

// A grid of a message's media, rendered from its Markdown: it copies back as Markdown that makes
// the same grid, and a video's tile opens the viewer at its fragment (`#t=12`).

import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("../assets/assetUrls", () => ({
  useAssetUrlRefresh: () => vi.fn(),
  useAssetUrlState: () => ({ _tag: "Success", url: "https://signed.test/file" }),
}));
vi.mock("../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => vi.fn() }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../state/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/session")>()),
  usePreparedConnection: () => ({ _tag: "Loading" }),
}));
vi.mock("../state/entities", () => ({
  readThreadShell: () => null,
  useProjects: () => [],
  useServerConfigs: () => new Map(),
}));
vi.mock("../remoteOpen", () => ({
  useRemoteOpenResolution: () => ({ state: { mode: "local-exec" }, isResolved: true }),
}));
vi.mock("../editorPreferences", () => ({
  useOpenInPreferredEditor: () => vi.fn(),
  usePreferredEditor: () => [null, vi.fn()],
}));
vi.mock("~/lib/openPullRequestLink", () => ({
  findProjectOnChangeRequestHost: () => undefined,
  parseChangeRequestUrl: () => null,
  resolvePullRequestPreviewTarget: () => null,
  useOpenChangeRequestLink: () => vi.fn(),
}));

import ChatMarkdown from "../components/ChatMarkdown";
import { markdownImageItems } from "../components/chat/markdownImageGallery";
import { serializeRenderedMarkdownFragment } from "../markdown-clipboard";

const threadRef = { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") };
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(() => act(() => root.render(null)));

async function render(markdown: string) {
  await act(async () => {
    root.render(<ChatMarkdown cwd="/w" threadRef={threadRef} text={markdown} mediaGrid />);
  });
}

it("copies a grid as its media on lines of their own, a video link as the link", async () => {
  await render(
    '![a](https://img.test/a.png)\n![b](https://img.test/b.png)\n\n**[clip](/w/clip.mp4 "The cut")**',
  );
  expect(host.querySelectorAll("[data-markdown-gallery-video]")).toHaveLength(1);
  expect(serializeRenderedMarkdownFragment(host).trim()).toBe(
    '![a](https://img.test/a.png)\n![b](https://img.test/b.png)\n**[clip](/w/clip.mp4 "The cut")**',
  );
});

it("opens a video's tile in the viewer at its fragment", async () => {
  await render("![a](https://img.test/a.png)\n\n[reel](/w/reel.mov#t=12)");
  const tile = host.querySelector("[data-markdown-gallery-video]")!;
  expect(markdownImageItems.get(tile)?.srcFragment).toBe("#t=12");
});
