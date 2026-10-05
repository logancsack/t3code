import { describe, expect, it } from "vite-plus/test";

import {
  aldoDesktopVideoHello,
  aldoDesktopVideoUrls,
  parseAldoVideoConfig,
} from "./liveVideo.logic";

describe("parseAldoVideoConfig", () => {
  const message = {
    type: "video",
    codec: "avc1.64001f",
    description: "AWQAH//hABlnZAAf",
    width: 900,
    height: 480,
    page: { width: 1271, height: 679 },
  };

  it("reads the decoder's configuration and the page's size", () => {
    expect(parseAldoVideoConfig(message)).toEqual({
      codec: "avc1.64001f",
      description: "AWQAH//hABlnZAAf",
      width: 900,
      height: 480,
      page: { width: 1271, height: 679 },
    });
  });

  it("has no page for the desktop", () => {
    const { page: _page, ...desktop } = message;
    expect(parseAldoVideoConfig(desktop)?.page).toBeNull();
  });

  it("is null when the machine goes back to JPEG frames, or says something else", () => {
    expect(parseAldoVideoConfig({ type: "video", codec: null })).toBeNull();
    expect(parseAldoVideoConfig({ ...message, codec: "vp09.00.10.08" })).toBeNull();
    expect(parseAldoVideoConfig({ ...message, description: "" })).toBeNull();
    expect(parseAldoVideoConfig({ ...message, width: 0 })).toBeNull();
    expect(parseAldoVideoConfig(null)).toBeNull();
  });
});

describe("aldoDesktopVideoHello", () => {
  it("tells a machine that streams video from an older one that speaks VNC", () => {
    expect(aldoDesktopVideoHello(JSON.stringify({ type: "hello", video: "h264" }))).toBe("video");
    expect(aldoDesktopVideoHello(new TextEncoder().encode("RFB 003.008\n").buffer)).toBe("vnc");
    expect(aldoDesktopVideoHello("{}")).toBe("unknown");
    expect(aldoDesktopVideoHello("not json")).toBe("unknown");
    expect(aldoDesktopVideoHello(new ArrayBuffer(0))).toBe("unknown");
  });
});

describe("aldoDesktopVideoUrls", () => {
  it("asks for video at the view's size, and VNC for input alone, keeping the token", () => {
    const { video, input } = aldoDesktopVideoUrls("wss://sb.example/desktop?token=a%2Bb", {
      width: 900,
      height: 562,
    });
    const videoUrl = new URL(video);
    expect(videoUrl.pathname).toBe("/desktop");
    expect(videoUrl.searchParams.get("token")).toBe("a+b");
    expect(videoUrl.searchParams.get("video")).toBe("h264");
    expect(videoUrl.searchParams.get("width")).toBe("900");
    expect(videoUrl.searchParams.get("height")).toBe("562");
    const inputUrl = new URL(input);
    expect(inputUrl.searchParams.get("token")).toBe("a+b");
    expect(inputUrl.searchParams.get("input")).toBe("1");
    expect(inputUrl.searchParams.has("video")).toBe(false);
  });
});
