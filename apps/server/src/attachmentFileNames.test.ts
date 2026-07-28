import { describe, expect, it } from "vite-plus/test";

import { inferAttachmentFileExtension } from "./attachmentFileNames.ts";

describe("naming a file attachment on disk", () => {
  it("keeps the extension the user's file had", () => {
    expect(inferAttachmentFileExtension({ mimeType: "text/markdown", fileName: "notes.md" })).toBe(
      ".md",
    );
    expect(
      inferAttachmentFileExtension({ mimeType: "application/zip", fileName: "bundle.zip" }),
    ).toBe(".zip");
  });

  it("prefers the filename over the mime type", () => {
    // Browsers report `application/octet-stream` for most of what people
    // attach, while the name they chose carries the real extension.
    expect(
      inferAttachmentFileExtension({
        mimeType: "application/octet-stream",
        fileName: "report.csv",
      }),
    ).toBe(".csv");
  });

  it("lowercases the extension", () => {
    expect(inferAttachmentFileExtension({ mimeType: "application/zip", fileName: "A.ZIP" })).toBe(
      ".zip",
    );
  });

  it("falls back to the mime type when the name carries no extension", () => {
    expect(inferAttachmentFileExtension({ mimeType: "application/pdf", fileName: "report" })).toBe(
      ".pdf",
    );
  });

  it("falls back to .bin when neither name nor mime type says anything", () => {
    expect(
      inferAttachmentFileExtension({ mimeType: "application/octet-stream", fileName: "payload" }),
    ).toBe(".bin");
    expect(inferAttachmentFileExtension({ mimeType: "application/octet-stream" })).toBe(".bin");
  });

  it("refuses an extension that could escape the attachments directory", () => {
    // Attachments are stored flat as `<id><extension>`; a separator or a dot
    // segment surviving into the extension would break that.
    expect(
      inferAttachmentFileExtension({ mimeType: "text/plain", fileName: "notes.../../etc/passwd" }),
    ).toBe(".txt");
    expect(inferAttachmentFileExtension({ mimeType: "application/x-thing", fileName: "a." })).toBe(
      ".bin",
    );
  });

  it("refuses an implausibly long extension", () => {
    expect(
      inferAttachmentFileExtension({
        mimeType: "application/octet-stream",
        fileName: "a.verylongextension",
      }),
    ).toBe(".bin");
  });
});
