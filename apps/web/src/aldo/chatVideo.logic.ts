// Which chat paragraphs show a video in place: a link to a video file on a line of its own.

import { mediaMimeTypeFromExtension } from "@t3tools/shared/filePreview";

/** The part of a Markdown (hast) node this reads. */
export interface ChatMarkdownNode {
  readonly type: string;
  readonly tagName?: string;
  readonly value?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly children?: ReadonlyArray<ChatMarkdownNode>;
}

const significant = (nodes: ReadonlyArray<ChatMarkdownNode> | undefined) =>
  (nodes ?? []).filter((node) => !(node.type === "text" && !node.value?.trim()));

/**
 * The link a paragraph is made of, when it's nothing else (`[clip.mp4](out/clip.mp4)`, bold or
 * italic too), or null: a link inside a sentence stays a link.
 */
export function soleParagraphLink(paragraph: ChatMarkdownNode | undefined): string | null {
  let content = significant(paragraph?.children);
  while (
    content.length === 1 &&
    (content[0]?.tagName === "strong" || content[0]?.tagName === "em")
  ) {
    content = significant(content[0].children);
  }
  const [link] = content;
  if (content.length !== 1 || link?.tagName !== "a") return null;
  const href = link.properties?.href;
  return typeof href === "string" && href.length > 0 ? href : null;
}

/** A file a browser can play, by its literal extension. */
export function isVideoFile(path: string): boolean {
  const name = path.split(/[\\/]/).at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 && (mediaMimeTypeFromExtension(name.slice(dot)) ?? "").startsWith("video/");
}

/** A video's shape once its metadata has loaded, or null before. */
export function videoAspectRatio(video: {
  readonly videoWidth: number;
  readonly videoHeight: number;
}): number | null {
  return video.videoWidth > 0 && video.videoHeight > 0
    ? video.videoWidth / video.videoHeight
    : null;
}

/** How wide a video shows: the column, at most 40rem, and at most 32rem tall. */
export function chatVideoWidth(aspectRatio: number): string {
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 16 / 9;
  return `min(100%, 40rem, ${Math.round(32 * ratio * 1000) / 1000}rem)`;
}
