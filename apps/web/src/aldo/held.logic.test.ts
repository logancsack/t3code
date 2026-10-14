import { extname } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  ALDO_FILE_PART_BYTES,
  ALDO_INLINE_MAX_CHARS,
  aldoAttachmentId,
  aldoFileExtension,
  aldoFilePartCount,
  aldoHeldCommand,
  aldoHeldFileCommand,
  aldoHoldAgain,
  aldoMissingParts,
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

describe("aldoAttachmentId", () => {
  const uuid = "0f8e2c1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
  // T3's own rule (attachmentFileExtension in apps/server/src/attachmentStore.ts), on Node's path.
  const t3Extension = (name: string) => {
    const extension = extname(name).toLowerCase();
    return extension === ".part" || !/^\.[a-z0-9]{1,10}$/.test(extension)
      ? "bin"
      : extension.slice(1);
  };

  it("names a file as T3 names an upload of it, by its extension as T3 reads it", () => {
    for (const name of [
      "clip.mp4",
      "Clip.MOV",
      "archive.tar.gz",
      "Makefile",
      ".env",
      "notes.part",
      "file.",
      "..mp4",
      "a..b",
      "weird.ext-with-dash",
      "report.verylongextension",
    ]) {
      expect(aldoFileExtension(name)).toBe(t3Extension(name));
      expect(aldoAttachmentId({ type: "file", name, mimeType: "x/y" }, uuid)).toBe(
        `pending-${uuid}-${t3Extension(name)}`,
      );
    }
  });

  it("names an image without an extension, and only one of a type T3 names", () => {
    expect(aldoAttachmentId({ type: "image", name: "a.png", mimeType: "image/PNG" }, uuid)).toBe(
      `pending-${uuid}`,
    );
    expect(
      aldoAttachmentId({ type: "image", name: "a.jxl", mimeType: "image/jxl" }, uuid),
    ).toBeNull();
    expect(
      aldoAttachmentId({ type: "file", name: "a.txt", mimeType: "text/plain" }, "not-a-uuid"),
    ).toBeNull();
  });
});

describe("aldoMissingParts", () => {
  const size = ALDO_FILE_PART_BYTES * 2 + 5;

  it("sends every part of a file Aldo has nothing of, the last one shorter", () => {
    expect(aldoFilePartCount(size)).toBe(3);
    expect(aldoMissingParts(size, [])).toEqual([0, 1, 2]);
  });

  it("sends again only the parts Aldo doesn't have whole", () => {
    expect(
      aldoMissingParts(size, [
        { part: 0, bytes: ALDO_FILE_PART_BYTES },
        { part: 1, bytes: 100 },
        { part: 2, bytes: 5 },
      ]),
    ).toEqual([1]);
    expect(aldoMissingParts(5, [{ part: 0, bytes: 5 }])).toEqual([]);
  });
});

describe("aldoHeldFileCommand", () => {
  const file = {
    type: "file",
    id: "pending-x-mp4",
    name: "clip.mp4",
    mimeType: "video/mp4",
    sizeBytes: 9,
  };

  it("says in how many parts each file went, and goes now when sent from a connected page", () => {
    const held = aldoHeldFileCommand(
      command([image(small), file]),
      new Map([["pending-x-mp4", { size: ALDO_FILE_PART_BYTES + 1 }]]),
      true,
    ) as { aldoNow?: boolean; message: { attachments: unknown[] } };
    expect(held.aldoNow).toBe(true);
    expect(held.message.attachments).toEqual([image(small), { ...file, aldoFile: { parts: 2 } }]);
    const later = aldoHeldFileCommand(
      command([file]),
      new Map([["pending-x-mp4", { size: 9 }]]),
      false,
    );
    expect(later).not.toHaveProperty("aldoNow");
  });
});
