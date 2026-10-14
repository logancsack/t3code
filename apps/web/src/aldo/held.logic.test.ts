import { describe, expect, it } from "vite-plus/test";

import {
  ALDO_INLINE_MAX_CHARS,
  aldoHeldCommand,
  aldoHoldAgain,
  aldoPartsOf,
  aldoUploadsOf,
} from "./held.logic";

const big = `data:image/png;base64,${"A".repeat(ALDO_INLINE_MAX_CHARS)}`;
const small = "data:image/png;base64,AAAA";
const command = (attachments: unknown[]) => ({
  type: "thread.turn.start",
  commandId: "c0ffee-1",
  threadId: "t",
  message: { messageId: "m", role: "user", text: "Look", attachments },
});
const image = (dataUrl: string) => ({
  type: "image",
  id: "a",
  name: "shot.png",
  mimeType: "image/png",
  sizeBytes: 1,
  dataUrl,
});

describe("aldoUploadsOf", () => {
  it("sends only the images too big to carry with the message, each an upload of its own", () => {
    expect(aldoUploadsOf(command([image(small), image(big), image(big)]))).toEqual([
      { index: 1, id: "c0ffee-1-1", dataUrl: big },
      { index: 2, id: "c0ffee-1-2", dataUrl: big },
    ]);
  });

  it("names uploads with what Aldo takes in an id", () => {
    expect(aldoUploadsOf({ ...command([image(big)]), commandId: "a b/c" })[0]?.id).toBe("a_b_c-0");
  });

  it("finds nothing to send first in a message without attachments", () => {
    expect(aldoUploadsOf({ type: "thread.archive", commandId: "c" })).toEqual([]);
  });
});

describe("aldoPartsOf", () => {
  it("splits a data URL into parts that join back into it", () => {
    const parts = aldoPartsOf("abcdefgh", 3);
    expect(parts).toEqual(["abc", "def", "gh"]);
    expect(parts.join("")).toBe("abcdefgh");
  });
});

describe("aldoHeldCommand", () => {
  it("names each uploaded image's upload in place of its data, and keeps the rest as sent", () => {
    const sent = command([image(small), image(big)]);
    const held = aldoHeldCommand(sent, aldoUploadsOf(sent)) as ReturnType<typeof command>;
    expect(held.message.attachments[0]).toEqual(image(small));
    expect(held.message.attachments[1]).toEqual({
      type: "image",
      id: "a",
      name: "shot.png",
      mimeType: "image/png",
      sizeBytes: 1,
      aldoUpload: { id: "c0ffee-1-1", parts: 1, chars: big.length },
    });
    expect(held.message.text).toBe("Look");
    expect(JSON.stringify(held).length).toBeLessThan(ALDO_INLINE_MAX_CHARS);
  });
});

describe("aldoHoldAgain", () => {
  it("tries again when nothing answered, a gateway gave up, or Aldo was in trouble", () => {
    for (const status of [null, 408, 429, 500, 502, 503, 504])
      expect(aldoHoldAgain(status)).toBe(true);
  });

  it("takes any other answer as Aldo's last word", () => {
    for (const status of [400, 401, 404, 409, 413]) expect(aldoHoldAgain(status)).toBe(false);
  });
});
