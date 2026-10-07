import { mediaFileReference } from "@t3tools/client-runtime/media-reference";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { useAssetUrlRefresh, useAssetUrlState } from "../assets/assetUrls";
import type { ExpandedImagePreview } from "../components/chat/ExpandedImagePreview";
import type { MediaActionSource } from "../components/media/MediaActions";
import { MediaVideoPlayer } from "../components/media/MediaVideoPlayer";
import { useRightPanelStore } from "../rightPanelStore";
import { chatVideoWidth, videoAspectRatio } from "./chatVideo.logic";

/**
 * A video file a message links on a line of its own, played in place at its own shape, with
 * the link beneath it.
 */
export function AldoChatVideo(props: {
  readonly threadRef: ScopedThreadRef;
  readonly path: string;
  readonly name: string;
  readonly workspaceRoot: string | undefined;
  /** The link's own fragment, such as `#t=12` to start 12 seconds in. */
  readonly fragment: string;
  readonly onExpand: (preview: ExpandedImagePreview) => void;
  readonly children: ReactNode;
}) {
  const { environmentId, threadId } = props.threadRef;
  const resource = useMemo(
    () => ({ _tag: "media-file" as const, threadId, path: props.path }),
    [threadId, props.path],
  );
  const assetUrl = useAssetUrlState(environmentId, resource);
  const refresh = useAssetUrlRefresh(environmentId, resource);
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  const figure = useRef<HTMLElement>(null);
  // The player owns its <video>, and loadedmetadata doesn't bubble: catch it on the way down.
  useEffect(() => {
    const element = figure.current;
    if (!element) return;
    const measure = (event: Event) => {
      const ratio = event.target instanceof HTMLVideoElement && videoAspectRatio(event.target);
      if (ratio) setAspectRatio(ratio);
    };
    element.addEventListener("loadedmetadata", measure, true);
    return () => element.removeEventListener("loadedmetadata", measure, true);
  }, []);

  const src = assetUrl._tag === "Success" ? assetUrl.url + props.fragment : null;
  const reference = mediaFileReference(props.path, props.workspaceRoot);
  const relativePath = reference.relativePath;
  const actionsSource: MediaActionSource = {
    kind: "video",
    name: props.name,
    src,
    asset: { environmentId, resource },
    reference,
    ...(relativePath
      ? {
          onOpenFile: () =>
            useRightPanelStore.getState().openFile({ environmentId, threadId }, relativePath),
        }
      : {}),
  };
  const size = {
    width: chatVideoWidth(aspectRatio),
    "--aldo-video-aspect": String(aspectRatio),
  } as CSSProperties;

  return (
    <figure ref={figure} className="my-4 flex flex-col items-start gap-1.5">
      <MediaVideoPlayer
        src={src}
        sourceFailed={assetUrl._tag === "Failure"}
        label={props.name}
        style={size}
        className="block"
        videoClassName="block aspect-(--aldo-video-aspect) rounded-lg border border-border/40"
        onRetry={refresh}
        actionsSource={actionsSource}
        onExpand={(expandSrc) =>
          props.onExpand({
            images: [
              {
                src: expandSrc,
                name: props.name,
                type: "video",
                autoPlay: false,
                actionsSource: { ...actionsSource, src: expandSrc },
              },
            ],
            index: 0,
          })
        }
      />
      <figcaption className="max-w-full">{props.children}</figcaption>
    </figure>
  );
}
