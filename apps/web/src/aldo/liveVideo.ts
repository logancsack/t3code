// The live views as H.264 video, for a newer machine and a browser that
// decodes it (WebCodecs): the panel asks for it (`video=h264` in the stream's
// URL), the machine says so with `{ type: "video", codec, description, ... }`
// (the decoder's configuration; `codec: null` when it goes back to JPEG
// frames), then sends each frame as a binary message (ALDO_FRAME_VIDEO). The
// panel acknowledges each frame its decoder took (`videoAck`), which is how
// the machine paces the stream, and asks for a keyframe if its decoder fails.

import type { AldoLiveFrame } from "./liveView.logic";
import { parseAldoVideoConfig, type AldoVideoConfig } from "./liveVideo.logic";

let support: Promise<boolean> | null = null;

/** Whether this browser decodes the machines' H.264 (checked once: High profile, as x264 makes it). */
export function aldoCanDecodeH264(): Promise<boolean> {
  support ??= (async () => {
    if (typeof VideoDecoder === "undefined" || typeof EncodedVideoChunk === "undefined")
      return false;
    try {
      const { supported } = await VideoDecoder.isConfigSupported({
        codec: "avc1.640028",
        optimizeForLatency: true,
      });
      return supported === true;
    } catch {
      return false;
    }
  })();
  return support;
}

function bytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Decodes the machine's frames and hands each picture to `draw` (which must
 * not keep it). `acknowledge` is called once per frame the decoder has taken
 * off its queue (or that couldn't be decoded), `broken` when the decoder
 * fails: the machine then sends a keyframe to start again from.
 */
export class AldoVideoPlayer {
  private decoder: VideoDecoder | null = null;
  private waitingForKey = true;
  private submitted = 0;
  private acknowledged = 0;
  config: AldoVideoConfig | null = null;

  constructor(
    private readonly draw: (frame: VideoFrame) => void,
    private readonly acknowledge: () => void,
    private readonly broken: () => void,
  ) {}

  /** A `{ type: "video" }` message: configures the decoder, or (codec null) stops. False when there's no video. */
  configure(message: unknown): boolean {
    this.close();
    const config = parseAldoVideoConfig(message);
    if (!config) return false;
    this.config = config;
    const decoder = new VideoDecoder({
      output: (frame) => {
        try {
          if (this.decoder === decoder) this.draw(frame);
        } finally {
          frame.close();
        }
      },
      error: () => {
        if (this.decoder !== decoder) return;
        this.release();
        this.broken();
      },
    });
    // A frame is acknowledged once the decoder has taken it.
    decoder.addEventListener("dequeue", () => {
      if (this.decoder === decoder) this.settle(decoder.decodeQueueSize);
    });
    decoder.configure({
      codec: config.codec,
      description: bytes(config.description),
      optimizeForLatency: true,
    });
    this.decoder = decoder;
    this.waitingForKey = true;
    return true;
  }

  decode(frame: AldoLiveFrame): void {
    const key = frame.header.key === true;
    const decoder = this.decoder;
    this.submitted++;
    if (!decoder || decoder.state !== "configured" || (this.waitingForKey && !key)) {
      // Nothing to decode it with (yet): taken all the same, so the stream goes on.
      return this.settle(0);
    }
    this.waitingForKey = false;
    try {
      decoder.decode(
        new EncodedVideoChunk({
          type: key ? "key" : "delta",
          timestamp: Number(frame.header.ts) || 0,
          data: frame.payload,
        }),
      );
    } catch {
      this.release();
      return this.broken();
    }
    // Browsers without the dequeue event: taken as it's handed over.
    if (!("ondequeue" in decoder)) this.settle(0);
  }

  /** Acknowledges every frame submitted except the `queued` ones still waiting in the decoder. */
  private settle(queued: number): void {
    while (this.acknowledged < this.submitted - queued) {
      this.acknowledged++;
      this.acknowledge();
    }
  }

  /** Drops the decoder (what it held counts as taken). */
  private release(): void {
    const decoder = this.decoder;
    this.decoder = null;
    this.settle(0);
    if (decoder && decoder.state !== "closed") decoder.close();
  }

  close(): void {
    this.release();
    this.config = null;
  }
}
