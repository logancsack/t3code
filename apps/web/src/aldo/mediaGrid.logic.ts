// A run of images or videos in a chat message shows as a grid (AldoMediaGrid), not a column:
// images one per line in a paragraph, or paragraphs that are each one image or one video, one
// after another. A single one, and images that share a line (a row of badges), stay as they were.

import { isVideoFile } from "./chatVideo.logic";

/** The part of a Markdown (hast) node this reads and builds. */
export interface MediaGridNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: MediaGridNode[];
}

/**
 * Which links to a video file join a run, played from the thread's files: none without a
 * thread, absolute paths only without a folder to resolve a relative one against.
 */
export type AldoVideoLinks = "none" | "absolute" | "all";

const isBlank = (node: MediaGridNode) => node.type === "text" && !node.value?.trim();

const significant = (nodes: ReadonlyArray<MediaGridNode> | undefined) =>
  (nodes ?? []).filter((node) => !isBlank(node));

/** Bold or italic around a single thing is still that thing. */
function unwrapEmphasis(node: MediaGridNode): MediaGridNode {
  let current = node;
  while (current.tagName === "strong" || current.tagName === "em") {
    const content = significant(current.children);
    if (content.length !== 1) return current;
    current = content[0]!;
  }
  return current;
}

function textOf(node: MediaGridNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/;

/** A link to a video file in the thread's files, by its literal extension: `/out/clip.mp4`, `clip.mp4#t=3`. */
export function isAldoVideoLink(href: string, videoLinks: AldoVideoLinks): boolean {
  if (videoLinks === "none") return false;
  const hashAt = href.indexOf("#");
  const hash = hashAt === -1 ? "" : href.slice(hashAt + 1);
  // A line marker points into a text file, not at a video.
  if (/^L\d/.test(hash)) return false;
  const path = (hashAt === -1 ? href : href.slice(0, hashAt)).split("?")[0] ?? "";
  const windows = WINDOWS_DRIVE_PATH.test(path);
  const fileUrl = /^file:/i.test(path);
  if (!windows && !fileUrl && (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith("//"))) {
    return false;
  }
  const absolute = windows || fileUrl || path.startsWith("/");
  if (!absolute && videoLinks !== "all") return false;
  return isVideoFile(path);
}

/**
 * What a grid shows for one thing in a paragraph: an image, a linked image (its link kept, so it
 * still opens the page), or a link to a video file, as an image of it (the renderer plays a video
 * by its extension). Null for anything else.
 */
export function aldoMediaItem(
  node: MediaGridNode,
  videoLinks: AldoVideoLinks,
): MediaGridNode | null {
  const inner = unwrapEmphasis(node);
  if (inner.type !== "element") return null;
  if (inner.tagName === "img") return inner;
  if (inner.tagName !== "a") return null;
  const content = significant(inner.children);
  if (content.length === 1 && unwrapEmphasis(content[0]!).tagName === "img") return inner;
  const href = inner.properties?.href;
  if (typeof href !== "string" || !isAldoVideoLink(href, videoLinks)) return null;
  return {
    type: "element",
    tagName: "img",
    properties: {
      src: href,
      alt: textOf(inner).trim(),
      // The image renderer reads a drive path from here: `src` may have been reshaped.
      ...(WINDOWS_DRIVE_PATH.test(href) ? { dataLocalSrc: href } : {}),
    },
    children: [],
  };
}

/**
 * The images and videos a paragraph is made of, when it's nothing else and each starts a line of
 * its own; null otherwise. Images that share a line are a row of badges or icons, not a set.
 */
export function aldoParagraphMedia(
  node: MediaGridNode,
  videoLinks: AldoVideoLinks,
): MediaGridNode[] | null {
  if (node.type !== "element" || node.tagName !== "p") return null;
  const items: MediaGridNode[] = [];
  let onNewLine = true;
  for (const child of node.children ?? []) {
    if (isBlank(child)) {
      if (child.value?.includes("\n")) onNewLine = true;
      continue;
    }
    if (child.tagName === "br") {
      onNewLine = true;
      continue;
    }
    const item = aldoMediaItem(child, videoLinks);
    if (!item || !onNewLine) return null;
    items.push(item);
    onNewLine = false;
  }
  return items.length > 0 ? items : null;
}

/**
 * A block's children with each run of two or more images or videos made one grid element
 * (`data-aldo-media-grid`, holding the media themselves); the rest, and a lone one, unchanged.
 */
export function groupAldoMediaRuns(
  children: ReadonlyArray<MediaGridNode>,
  videoLinks: AldoVideoLinks,
): MediaGridNode[] {
  const out: MediaGridNode[] = [];
  let run: { nodes: MediaGridNode[]; items: MediaGridNode[] } | null = null;
  const flush = () => {
    if (run === null) return;
    if (run.items.length >= 2) {
      out.push({
        type: "element",
        tagName: "div",
        properties: { dataAldoMediaGrid: run.items.length },
        children: run.items,
      });
    } else {
      out.push(...run.nodes);
    }
    run = null;
  };
  for (const child of children) {
    if (run !== null && isBlank(child)) {
      run.nodes.push(child);
      continue;
    }
    const items = aldoParagraphMedia(child, videoLinks);
    if (items) {
      run ??= { nodes: [], items: [] };
      run.nodes.push(child);
      run.items.push(...items);
      continue;
    }
    flush();
    out.push(child);
  }
  flush();
  return out;
}

/** A rehype step (after sanitizing) that makes a message's runs of images or videos grids. */
export function rehypeAldoMediaGrid(options: { readonly videoLinks: AldoVideoLinks }) {
  return (tree: MediaGridNode) => {
    tree.children = groupAldoMediaRuns(tree.children ?? [], options.videoLinks);
  };
}
