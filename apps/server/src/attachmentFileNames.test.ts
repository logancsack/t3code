import { describe, expect, it } from "vite-plus/test";

import { inferAttachmentFileExtension } from "./attachmentFileNames.ts";

describe("naming a file attachment on disk", () => {
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
