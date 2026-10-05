// The Browser panel's live view on the wire. A newer machine sends frames as
// binary messages when the panel asks for them in its URL (`binary=1`), and
// paces them to the panel: it sends the next once the panel acknowledges the
// one it drew (`{ type: "frameAck" }`). An older machine ignores the
// parameters and sends JSON frames (base64), which the panel still draws.

/** A JPEG frame of the page, with the screencast's metadata as its header. */
export const ALDO_FRAME_JPEG = 1;

export interface AldoLiveFrame {
  readonly kind: number;
  readonly header: Record<string, unknown>;
  readonly payload: Uint8Array<ArrayBuffer>;
}

/** A binary message: a kind byte, the header's length (uint16, big-endian), a JSON header, then the payload. */
export function parseAldoLiveFrame(data: ArrayBuffer): AldoLiveFrame | null {
  if (data.byteLength < 3) return null;
  const view = new DataView(data);
  const kind = view.getUint8(0);
  const headerLength = view.getUint16(1);
  if (3 + headerLength > data.byteLength) return null;
  try {
    const header = JSON.parse(
      new TextDecoder().decode(new Uint8Array(data, 3, headerLength)),
    ) as unknown;
    if (!header || typeof header !== "object") return null;
    return {
      kind,
      header: header as Record<string, unknown>,
      payload: new Uint8Array(data, 3 + headerLength),
    };
  } catch {
    return null;
  }
}

/** The panel's size in device pixels (capped at 2x): the machine never sends bigger frames than that. */
export function aldoLiveViewSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): { width: number; height: number } {
  const dpr = Math.min(2, devicePixelRatio || 1);
  return { width: Math.round(cssWidth * dpr), height: Math.round(cssHeight * dpr) };
}

/** The stream's URL with what this panel takes: binary frames, its size, and whether it starts hidden. */
export function aldoLiveViewUrl(
  url: string,
  options: { width: number; height: number; paused: boolean },
): string {
  const parsed = new URL(url);
  parsed.searchParams.set("binary", "1");
  if (options.width > 0 && options.height > 0) {
    parsed.searchParams.set("width", String(options.width));
    parsed.searchParams.set("height", String(options.height));
  }
  if (options.paused) parsed.searchParams.set("paused", "1");
  return parsed.toString();
}
