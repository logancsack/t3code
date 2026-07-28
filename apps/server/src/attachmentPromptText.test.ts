import type { ChatAttachment } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildFileAttachmentPromptSection,
  withFileAttachmentPromptSection,
} from "./attachmentPromptText.ts";

const attachmentsDir = "/state/attachments";

const fileAttachment = (
  overrides: Partial<Extract<ChatAttachment, { type: "file" }>> = {},
): ChatAttachment =>
  ({
    type: "file",
    id: "thread-00000000-0000-4000-8000-000000000001",
    name: "notes.md",
    mimeType: "text/markdown",
    sizeBytes: 2048,
    ...overrides,
  }) as ChatAttachment;

const imageAttachment = (): ChatAttachment =>
  ({
    type: "image",
    id: "thread-00000000-0000-4000-8000-000000000002",
    name: "shot.png",
    mimeType: "image/png",
    sizeBytes: 1024,
  }) as ChatAttachment;

describe("describing file attachments to the agent", () => {
  it("names each file and where it was saved", () => {
    const section = buildFileAttachmentPromptSection({
      attachmentsDir,
      attachments: [fileAttachment()],
    });
    expect(section).toContain("notes.md");
    expect(section).toContain("text/markdown");
    expect(section).toContain("2.0 KB");
    expect(section).toContain("/state/attachments/thread-00000000-0000-4000-8000-000000000001.md");
  });

  it("says nothing when the turn carries only images", () => {
    // Images reach the model as native content blocks; a path would be noise.
    expect(
      buildFileAttachmentPromptSection({ attachmentsDir, attachments: [imageAttachment()] }),
    ).toBeNull();
  });

  it("says nothing when the turn carries no attachments", () => {
    expect(buildFileAttachmentPromptSection({ attachmentsDir, attachments: [] })).toBeNull();
  });

  it("counts the files in the heading", () => {
    const section = buildFileAttachmentPromptSection({
      attachmentsDir,
      attachments: [
        fileAttachment(),
        fileAttachment({
          id: "thread-00000000-0000-4000-8000-000000000003",
          name: "bundle.zip",
          mimeType: "application/zip",
        }),
      ],
    });
    expect(section).toContain("attached 2 files");
    expect(section).toContain("bundle.zip");
  });

  it("skips an attachment whose id cannot resolve to a path", () => {
    // One unusable id should not cost the user the rest of the message.
    const section = buildFileAttachmentPromptSection({
      attachmentsDir,
      attachments: [fileAttachment({ id: "../../escape" }), fileAttachment()],
    });
    expect(section).toContain("attached a file");
    expect(section).not.toContain("escape");
  });
});

describe("appending the section to a turn", () => {
  it("keeps the user's text above it", () => {
    const text = withFileAttachmentPromptSection({
      attachmentsDir,
      attachments: [fileAttachment()],
      text: "summarize this",
    });
    expect(text?.startsWith("summarize this\n\n")).toBe(true);
    expect(text).toContain("notes.md");
  });

  it("becomes the whole message when the turn has no text of its own", () => {
    const text = withFileAttachmentPromptSection({
      attachmentsDir,
      attachments: [fileAttachment()],
      text: undefined,
    });
    expect(text).toContain("notes.md");
  });

  it("leaves a turn without file attachments untouched", () => {
    expect(
      withFileAttachmentPromptSection({
        attachmentsDir,
        attachments: [imageAttachment()],
        text: "look at this",
      }),
    ).toBe("look at this");
    expect(
      withFileAttachmentPromptSection({ attachmentsDir, attachments: [], text: undefined }),
    ).toBeUndefined();
  });
});
