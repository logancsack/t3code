// A run of images or videos in a message, as a grid (mediaGrid.logic.ts): two columns on a
// phone, three where the column is wide (two for two or four, so none is left alone on a row). Each tile opens the message's media in the full-screen
// viewer, as a single image does; a video shows its first frame there and plays in the viewer.

import {
  Children,
  createContext,
  isValidElement,
  use,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

import type {
  ExpandedImageItem,
  ExpandedImagePreview,
} from "../components/chat/ExpandedImagePreview";
import { markdownImageGallery, markdownImageItems } from "../components/chat/markdownImageGallery";
import type { MediaActionSource } from "../components/media/MediaActions";
import { MediaVideoPlayer } from "../components/media/MediaVideoPlayer";
import { aldoMediaGridColumns } from "./mediaGrid.logic";

const AldoMediaGridContext = createContext(false);

/** Whether this image or video is a tile of a grid, which sizes it to the tile. */
export function useInAldoMediaGrid(): boolean {
  return use(AldoMediaGridContext);
}

/** Classes that fit an image to its tile; merged over the image's own. */
export const ALDO_MEDIA_TILE_IMAGE_CLASS_NAME =
  "block! aspect-video w-full max-w-none max-h-none rounded-lg object-cover";

/** Tiles take the tile's shape, not the image's authored size. */
export const ALDO_MEDIA_TILE_STYLE = {};

export function AldoMediaGrid(props: { readonly children: ReactNode }) {
  const tiles = Children.toArray(props.children).filter(isValidElement).length;
  return (
    <div className="@container my-3 max-w-[40rem]">
      <div
        className={
          aldoMediaGridColumns(tiles) === 3
            ? "grid grid-cols-2 gap-1.5 @md:grid-cols-3"
            : "grid grid-cols-2 gap-1.5"
        }
      >
        <AldoMediaGridContext value>{props.children}</AldoMediaGridContext>
      </div>
    </div>
  );
}

/**
 * A video's tile: its first frame, muted, with a play button that opens it in the viewer, among
 * the message's other images and videos.
 */
export function AldoMediaGridVideo(props: {
  readonly src: string | null;
  readonly label: string;
  readonly sourceFailed?: boolean | undefined;
  readonly originalUrl?: string | undefined;
  readonly copyMarkdown?: string | undefined;
  readonly actionsSource?: MediaActionSource | undefined;
  readonly onRetry?: (() => Promise<unknown>) | undefined;
  readonly onExpand: ((preview: ExpandedImagePreview) => void) | undefined;
}) {
  const tile = useRef<HTMLSpanElement | null>(null);
  const { src, label, originalUrl, actionsSource, onExpand } = props;
  const item = useMemo(
    (): ExpandedImageItem => ({
      src,
      name: label || "video",
      type: "video",
      ...(originalUrl ? { originalUrl } : {}),
      ...(actionsSource ? { actionsSource } : {}),
    }),
    [src, label, originalUrl, actionsSource],
  );
  // The viewer gathers a message's media in order from what each one registered.
  const register = useCallback(
    (element: HTMLSpanElement | null) => {
      tile.current = element;
      if (element) markdownImageItems.set(element, item);
    },
    [item],
  );
  return (
    <span ref={register} data-markdown-gallery-video="" className="block min-w-0">
      <MediaVideoPlayer
        src={props.src}
        sourceFailed={props.sourceFailed}
        label={props.label}
        originalUrl={props.originalUrl}
        copyMarkdown={props.copyMarkdown}
        onRetry={props.onRetry}
        actionsSource={props.actionsSource}
        className="block w-full"
        videoClassName="aspect-video w-full rounded-lg border border-border/40 object-cover"
        stateClassName="aspect-video rounded-lg"
        {...(onExpand
          ? {
              onOpen: () => {
                if (tile.current) onExpand(markdownImageGallery(tile.current, item));
              },
            }
          : {})}
      />
    </span>
  );
}
