import { describe, expect, it } from "vite-plus/test";

import {
  ALDO_FRAME_JPEG,
  aldoLiveViewSize,
  aldoLiveViewUrl,
  parseAldoLiveFrame,
} from "./liveView.logic";

/** A binary message as aldod builds it (binaryMessage in sandbox-agent/browser/controller.ts). */
function message(kind: number, header: unknown, payload: number[]): ArrayBuffer {
  const head = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(3 + head.length + payload.length);
  out[0] = kind;
  new DataView(out.buffer).setUint16(1, head.length);
  out.set(head, 3);
  out.set(payload, 3 + head.length);
  return out.buffer;
}

describe("parseAldoLiveFrame", () => {
  it("reads the kind, the JSON header and the payload", () => {
    const frame = parseAldoLiveFrame(
      message(ALDO_FRAME_JPEG, { deviceWidth: 1271, deviceHeight: 679 }, [0xff, 0xd8, 0xff]),
    );
    expect(frame?.kind).toBe(ALDO_FRAME_JPEG);
    expect(frame?.header).toEqual({ deviceWidth: 1271, deviceHeight: 679 });
    expect([...(frame?.payload ?? [])]).toEqual([0xff, 0xd8, 0xff]);
  });

  it("refuses a truncated or malformed message", () => {
    expect(parseAldoLiveFrame(new Uint8Array([1, 0]).buffer)).toBeNull();
    const truncated = message(ALDO_FRAME_JPEG, { a: 1 }, []).slice(0, 6);
    expect(parseAldoLiveFrame(truncated)).toBeNull();
    const notJson = new Uint8Array([1, 0, 2, 0x7b, 0x7b]).buffer;
    expect(parseAldoLiveFrame(notJson)).toBeNull();
  });
});

describe("aldoLiveViewSize", () => {
  it("is the panel in device pixels, at most 2x", () => {
    expect(aldoLiveViewSize(600, 400, 1)).toEqual({ width: 600, height: 400 });
    expect(aldoLiveViewSize(600, 400, 3)).toEqual({ width: 1200, height: 800 });
    expect(aldoLiveViewSize(600.4, 400.6, 1.5)).toEqual({ width: 901, height: 601 });
  });
});

describe("aldoLiveViewUrl", () => {
  it("asks for binary frames at the panel's size, keeping the token", () => {
    const url = new URL(
      aldoLiveViewUrl("wss://sb.example/browser?token=a%2Bb", {
        width: 900,
        height: 560,
        paused: false,
      }),
    );
    expect(url.searchParams.get("token")).toBe("a+b");
    expect(url.searchParams.get("binary")).toBe("1");
    expect(url.searchParams.get("width")).toBe("900");
    expect(url.searchParams.get("height")).toBe("560");
    expect(url.searchParams.has("paused")).toBe(false);
  });

  it("says when the panel starts hidden, and leaves out a size it doesn't know yet", () => {
    const url = new URL(
      aldoLiveViewUrl("wss://sb.example/browser?token=t", { width: 0, height: 0, paused: true }),
    );
    expect(url.searchParams.get("paused")).toBe("1");
    expect(url.searchParams.has("width")).toBe(false);
  });
});
