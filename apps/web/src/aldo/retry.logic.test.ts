import { describe, expect, it } from "vite-plus/test";

import { aldoRetryAfterReconnect } from "./retry.logic";

const expired = { auth: { status: "unauthenticated" as const } };
const image = {
  type: "image",
  id: "attachment-1",
  name: "plan.png",
  mimeType: "image/png",
  sizeBytes: 12,
} as const;
const shipIt = { text: "ship it", attachments: [image] };
const resend = { kind: "resend", ...shipIt };

describe("aldoRetryAfterReconnect", () => {
  it.each([
    ["a failed turn sends its message again, with what it carried", "failed", false, resend],
    ["a stopped turn resumes when it can", "interrupted", true, { kind: "resume" }],
    ["a stopped turn that can't resume sends again", "interrupted", false, resend],
    ["a finished turn is left alone", "completed", true, null],
    ["a running turn is left alone", "running", false, null],
  ] as const)("%s", (_name, latestRunStatus, canResume, expected) => {
    expect(
      aldoRetryAfterReconnect({
        provider: expired,
        latestRunStatus,
        canResume,
        userMessage: shipIt,
      }),
    ).toEqual(expected);
  });

  it("sends a message that was only attachments", () => {
    const userMessage = { text: "", attachments: [image] };
    expect(
      aldoRetryAfterReconnect({
        provider: expired,
        latestRunStatus: "failed",
        canResume: false,
        userMessage,
      }),
    ).toEqual({ kind: "resend", ...userMessage });
  });

  it("does nothing for a provider that was signed in, or a turn with no message", () => {
    expect(
      aldoRetryAfterReconnect({
        provider: { auth: { status: "authenticated" } },
        latestRunStatus: "failed",
        canResume: false,
        userMessage: shipIt,
      }),
    ).toBeNull();
    expect(
      aldoRetryAfterReconnect({
        provider: expired,
        latestRunStatus: "failed",
        canResume: false,
        userMessage: { text: " ", attachments: [] },
      }),
    ).toBeNull();
  });
});
