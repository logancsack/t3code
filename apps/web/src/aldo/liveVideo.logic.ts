// What a machine says about its video (liveVideo.ts), checked.

/** A frame of H.264 video: header `{ key, ts }` (keyframe, timestamp in microseconds), payload an access unit (4-byte NAL lengths). */
export const ALDO_FRAME_VIDEO = 2;

export interface AldoVideoConfig {
  /** WebCodecs' codec string, e.g. "avc1.64001f". */
  readonly codec: string;
  /** The avcC record, base64. */
  readonly description: string;
  /** The video's size in pixels. */
  readonly width: number;
  readonly height: number;
  /** The Browser view's page in CSS pixels, which input coordinates are in. */
  readonly page: { readonly width: number; readonly height: number } | null;
}

const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/** A `{ type: "video" }` message's configuration, or null (`codec: null`: the stream is back to JPEG frames, or VNC). */
export function parseAldoVideoConfig(message: unknown): AldoVideoConfig | null {
  if (!message || typeof message !== "object") return null;
  const { codec, description, width, height, page } = message as Record<string, unknown>;
  if (typeof codec !== "string" || !/^avc1\.[0-9a-f]{6}$/i.test(codec)) return null;
  if (typeof description !== "string" || !description) return null;
  if (!positive(width) || !positive(height)) return null;
  const pageSize =
    page && typeof page === "object" ? (page as { width?: unknown; height?: unknown }) : null;
  return {
    codec,
    description,
    width,
    height,
    page:
      pageSize && positive(pageSize.width) && positive(pageSize.height)
        ? { width: pageSize.width, height: pageSize.height }
        : null,
  };
}

/** What the machine's first message on the Desktop view's video URL says: it streams video, or (an older machine) it speaks VNC. */
export function aldoDesktopVideoHello(data: unknown): "video" | "vnc" | "unknown" {
  if (data instanceof ArrayBuffer) {
    // RFB starts "RFB 003.008\n".
    const head = new Uint8Array(data, 0, Math.min(4, data.byteLength));
    return String.fromCharCode(...head) === "RFB " ? "vnc" : "unknown";
  }
  if (typeof data !== "string") return "unknown";
  try {
    const message = JSON.parse(data) as { type?: unknown; video?: unknown };
    return message.type === "hello" && message.video === "h264" ? "video" : "unknown";
  } catch {
    return "unknown";
  }
}

/** The Desktop view's URLs: video at the panel's size, and VNC for its input alone. */
export function aldoDesktopVideoUrls(
  desktopUrl: string,
  size: { width: number; height: number },
): { video: string; input: string } {
  const video = new URL(desktopUrl);
  video.searchParams.set("video", "h264");
  if (size.width > 0 && size.height > 0) {
    video.searchParams.set("width", String(size.width));
    video.searchParams.set("height", String(size.height));
  }
  const input = new URL(desktopUrl);
  input.searchParams.set("input", "1");
  return { video: video.toString(), input: input.toString() };
}
