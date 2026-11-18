// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ApprovalText, RewriteNote } from "./AldoApprovals";
import { type AldoApproval } from "./homeApi";

const email = (over: Partial<AldoApproval> = {}): AldoApproval => ({
  id: "ap_1",
  kind: "email",
  provider: "google",
  title: "Offer",
  summary: "To Jordan",
  fields: [],
  body: "Yes, thank you. I accept.",
  approveLabel: "Send",
  discardLabel: "Discard",
  status: "pending",
  result: null,
  failed: false,
  thread: null,
  threadTitle: null,
  createdAt: "2026-10-21T12:00:00Z",
  decidedAt: null,
  ...over,
});

describe("a draft Aldo rewrote", () => {
  it("underlines the new words and says so", () => {
    const a = email({ previous: { title: "Offer", body: "Yes, thank you." } });
    expect(renderToStaticMarkup(<ApprovalText approval={a} />)).toContain("<ins");
    expect(renderToStaticMarkup(<RewriteNote approval={a} />)).toContain(
      "Aldo rewrote it. The new words in the text are underlined.",
    );
  });

  it("says what the subject was when it changed, with the text or alone", () => {
    const both = email({
      title: "Accepting the offer",
      previous: { title: "Offer", body: "Yes." },
    });
    expect(renderToStaticMarkup(<RewriteNote approval={both} />)).toContain(
      "Aldo rewrote it. The new words in the text are underlined. The subject was “Offer”.",
    );
    const subject = email({
      title: "Accepting the offer",
      previous: { title: "Offer", body: "Yes, thank you. I accept." },
    });
    expect(renderToStaticMarkup(<RewriteNote approval={subject} />)).toContain(
      "Aldo changed the subject from “Offer”.",
    );
  });

  it("says nothing of one Aldo didn't rewrite", () => {
    expect(renderToStaticMarkup(<RewriteNote approval={email()} />)).toBe("");
  });
});
