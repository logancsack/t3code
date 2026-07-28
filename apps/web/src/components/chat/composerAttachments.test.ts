import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  composerAttachmentKind,
  composerAttachmentMimeType,
  formatComposerAttachmentSize,
  planComposerAttachmentIntake,
} from "./composerAttachments";

const fileOfSize = (name: string, type: string, sizeBytes: number) =>
  new File([new Uint8Array(sizeBytes)], name, { type });

const png = (name = "shot.png") => fileOfSize(name, "image/png", 3);
const markdown = (name = "notes.md") => fileOfSize(name, "text/markdown", 3);

describe("classifying a composer attachment", () => {
  it("treats an image mime type as an image", () => {
    expect(composerAttachmentKind(png())).toBe("image");
  });

  it("treats everything else as a file", () => {
    expect(composerAttachmentKind(markdown())).toBe("file");
    expect(composerAttachmentKind(fileOfSize("bundle.zip", "application/zip", 3))).toBe("file");
  });

  it("treats a file the browser could not type as a file", () => {
    expect(composerAttachmentKind(fileOfSize("notes.md", "", 3))).toBe("file");
  });

  it("substitutes a mime type when the browser reports none", () => {
    // Browsers report no type for plenty of ordinary extensions, and the wire
    // contract requires a non-empty one.
    expect(composerAttachmentMimeType(fileOfSize("notes.md", "", 3))).toBe(
      "application/octet-stream",
    );
    expect(composerAttachmentMimeType(markdown())).toBe("text/markdown");
  });
});

describe("planning what the composer stages", () => {
  it("accepts images and files together", () => {
    const result = planComposerAttachmentIntake({
      files: [png(), markdown()],
      existingCount: 0,
    });
    expect(result.error).toBeNull();
    expect(result.accepted.map((attachment) => [attachment.name, attachment.type])).toEqual([
      ["shot.png", "image"],
      ["notes.md", "file"],
    ]);
  });

  it("holds files to a larger size limit than images", () => {
    const bigImage = fileOfSize("huge.png", "image/png", PROVIDER_SEND_TURN_MAX_IMAGE_BYTES + 1);
    const sameSizedFile = fileOfSize(
      "huge.csv",
      "text/csv",
      PROVIDER_SEND_TURN_MAX_IMAGE_BYTES + 1,
    );
    const result = planComposerAttachmentIntake({
      files: [bigImage, sameSizedFile],
      existingCount: 0,
    });
    expect(result.accepted.map((attachment) => attachment.name)).toEqual(["huge.csv"]);
    expect(result.error).toContain("huge.png");
  });

  it("rejects a file past the file limit", () => {
    const result = planComposerAttachmentIntake({
      files: [fileOfSize("huge.zip", "application/zip", PROVIDER_SEND_TURN_MAX_FILE_BYTES + 1)],
      existingCount: 0,
    });
    expect(result.accepted).toEqual([]);
    expect(result.error).toContain("25MB");
  });

  it("skips an oversized file but keeps the rest of the batch", () => {
    // Dropping a folder with one huge archive in it should still attach
    // everything else rather than failing wholesale.
    const result = planComposerAttachmentIntake({
      files: [
        markdown("a.md"),
        fileOfSize("huge.zip", "application/zip", PROVIDER_SEND_TURN_MAX_FILE_BYTES + 1),
        markdown("b.md"),
      ],
      existingCount: 0,
    });
    expect(result.accepted.map((attachment) => attachment.name)).toEqual(["a.md", "b.md"]);
    expect(result.error).toContain("huge.zip");
  });

  it("rejects an empty file", () => {
    const result = planComposerAttachmentIntake({
      files: [fileOfSize("empty.md", "text/markdown", 0)],
      existingCount: 0,
    });
    expect(result.accepted).toEqual([]);
    expect(result.error).toContain("empty.md");
  });

  it("stops at the per-message attachment cap", () => {
    const files = Array.from({ length: PROVIDER_SEND_TURN_MAX_ATTACHMENTS + 2 }, (_, index) =>
      markdown(`note-${index}.md`),
    );
    const result = planComposerAttachmentIntake({ files, existingCount: 0 });
    expect(result.accepted).toHaveLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS);
    expect(result.error).toContain(`up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} files`);
  });

  it("counts what is already staged against the cap", () => {
    const result = planComposerAttachmentIntake({
      files: [markdown("a.md"), markdown("b.md")],
      existingCount: PROVIDER_SEND_TURN_MAX_ATTACHMENTS - 1,
    });
    expect(result.accepted.map((attachment) => attachment.name)).toEqual(["a.md"]);
    expect(result.error).toContain("up to");
  });

  it("names an attachment the browser handed over unnamed", () => {
    const result = planComposerAttachmentIntake({
      files: [fileOfSize("", "image/png", 3), fileOfSize("", "application/zip", 3)],
      existingCount: 0,
    });
    expect(result.accepted.map((attachment) => attachment.name)).toEqual(["image", "file"]);
  });
});

describe("formatting an attachment size", () => {
  it("reads in the largest unit that fits", () => {
    expect(formatComposerAttachmentSize(512)).toBe("512 B");
    expect(formatComposerAttachmentSize(2048)).toBe("2.0 KB");
    expect(formatComposerAttachmentSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
