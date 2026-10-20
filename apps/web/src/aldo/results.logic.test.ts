import { describe, expect, it } from "vite-plus/test";

import type { AldoShareView } from "./library.logic";
import { aldoTurnMade, type AldoShare } from "./made.logic";
import {
  aldoAddress,
  aldoAnswerMedia,
  aldoDocumentSections,
  aldoLiveShots,
  aldoReadable,
  aldoResults,
  type AldoListedShare,
} from "./results.logic";
import { aldoShareOf } from "./workLabels.logic";

const ROOT = "/vercel/work/general";
const unknown: AldoListedShare = () => null;

function share(id: string, overrides: Partial<AldoShareView> = {}): AldoShareView {
  return {
    id,
    title: id,
    url: `https://aldo.computer/s/${id}`,
    contentType: "text/html",
    bytes: 1024,
    public: true,
    views: 0,
    createdAt: "2026-10-20T08:00:00.000Z",
    environmentId: "env-1",
    ...overrides,
  };
}

function results(input: {
  files?: ReadonlyArray<string>;
  shares?: ReadonlyArray<AldoShare>;
  answer?: string;
  listed?: AldoListedShare;
}) {
  const answer = input.answer ?? "";
  const live = aldoLiveShots(answer);
  return aldoResults({
    items: aldoTurnMade({
      files: (input.files ?? []).map((path) => ({ path, additions: 10, deletions: 0 })),
      shares: input.shares ?? [],
      workspaceRoot: ROOT,
    }).items,
    workspaceRoot: ROOT,
    shown: aldoAnswerMedia(answer, ROOT),
    shots: live.shots,
    listed: input.listed ?? unknown,
  });
}

describe("the main item", () => {
  it("is the first video, ahead of a page", () => {
    const laid = results({ files: ["site/index.html", "clips/one.mp4", "clips/reel.mp4"] });
    expect(laid.main?.path).toBe("clips/one.mp4");
    expect(laid.main?.absolutePath).toBe(`${ROOT}/clips/one.mp4`);
    expect(laid.gallery.map((item) => item.path)).toEqual(["clips/reel.mp4"]);
    expect(laid.links.map((link) => link.address)).toEqual(["site/index.html"]);
  });

  it("is a page in the folder when there's no video", () => {
    const laid = results({ files: ["notes/plan.md", "site/index.html", "shot.png"] });
    expect(laid.main?.kind).toBe("page");
    expect(laid.main?.path).toBe("site/index.html");
    expect(laid.mainImage).toBeNull();
  });

  it("is a shared page with the screenshot the answer linked to it", () => {
    const laid = results({
      shares: [{ path: null, title: "Launch page", url: "https://aldo.computer/s/page1" }],
      answer: "It's live.\n\n[![Launch page](shots/launch.png)](https://aldo.computer/s/page1)",
    });
    expect(laid.main?.name).toBe("Launch page");
    expect(laid.mainImage).toBe("shots/launch.png");
    expect(laid.links).toEqual([]);
  });

  it("leaves a shared page with nothing to preview it among the links", () => {
    const laid = results({
      shares: [{ path: null, title: "Launch page", url: "https://aldo.computer/s/page1" }],
    });
    expect(laid.main).toBeNull();
    expect(laid.links.map((link) => [link.title, link.address])).toEqual([
      ["Launch page", "aldo.computer/s/page1"],
    ]);
  });

  it("is the video the answer plays on a line of its own, so the block shows none large", () => {
    const laid = results({
      files: ["reel.mp4", "clips/one.mp4", "site/index.html"],
      answer: `The reel:\n\n[Logo reel](${ROOT}/reel.mp4)\n\nAnd the rest below.`,
    });
    expect(laid.main).toBeNull();
    expect(laid.gallery.map((item) => item.path)).toEqual(["clips/one.mp4"]);
    expect(laid.links.map((link) => link.address)).toEqual(["site/index.html"]);
  });

  it("is still a video the answer only mentions in a sentence", () => {
    const laid = results({
      files: ["reel.mp4"],
      answer: `The [reel](${ROOT}/reel.mp4) is 32 seconds.`,
    });
    expect(laid.main?.path).toBe("reel.mp4");
  });
});

describe("grouping", () => {
  it("puts images and clips in the gallery, pages in the links and the rest in documents, in order", () => {
    const laid = results({
      files: [
        "reel.mp4",
        "a.png",
        "b.mp4",
        "pricing.xlsx",
        "listings.md",
        "renders.zip",
        "deck.pptx",
        "voice.mp3",
        "report.pdf",
        "other.html",
        "site/index.html",
      ],
    });
    expect(laid.main?.path).toBe("reel.mp4");
    expect(laid.gallery.map((item) => item.path)).toEqual(["a.png", "b.mp4"]);
    expect(laid.links.map((link) => link.address)).toEqual(["other.html", "site/index.html"]);
    expect(laid.documents.map((item) => item.path)).toEqual([
      "listings.md",
      "pricing.xlsx",
      "deck.pptx",
      "report.pdf",
      "voice.mp3",
      "renders.zip",
    ]);
  });

  it("leaves out the images the answer shows, however it addresses them", () => {
    const laid = results({
      files: ["shots/a.png", "shots/b.png", "shots/c.png"],
      shares: [{ path: `${ROOT}/shots/c.png`, title: "C", url: "https://aldo.computer/s/c1" }],
      answer: `![A](shots/a.png)\n![B](<${ROOT}/shots/b.png>)\n\n![C](https://aldo.computer/s/c1)`,
    });
    expect(laid.gallery).toEqual([]);
  });

  it("doesn't count an image inside a code block as shown", () => {
    const laid = results({
      files: ["a.png"],
      answer: "```md\n![A](a.png)\n```",
    });
    expect(laid.gallery.map((item) => item.path)).toEqual(["a.png"]);
  });

  it("makes cards of screenshots linked to live pages, one per address", () => {
    const answer = [
      "Three gigs are live.",
      "",
      "- [![Gig 1](shots/gig-1.png)](https://www.fiverr.com/logansack/logo-reveal)",
      "- [![Gig 2](shots/gig-2.png)](https://www.fiverr.com/logansack/intro)",
      "- [![Gig 2 again](shots/gig-2b.png)](https://www.fiverr.com/logansack/intro)",
    ].join("\n");
    const laid = results({ files: ["shots/gig-1.png", "shots/gig-2.png"], answer });
    expect(laid.links.map((link) => [link.title, link.address, link.image])).toEqual([
      ["Gig 1", "fiverr.com/logansack/logo-reveal", "shots/gig-1.png"],
      ["Gig 2", "fiverr.com/logansack/intro", "shots/gig-2.png"],
    ]);
    // Their screenshots are on the cards, not in the gallery too.
    expect(laid.gallery).toEqual([]);
  });
});

describe("aldoLiveShots", () => {
  it("takes out paragraphs and lists made only of linked screenshots", () => {
    const text = [
      "Your gigs are live.",
      "",
      "[![Gig 1](a.png)](https://fiverr.com/a) [![Gig 2](b.png)](https://fiverr.com/b)",
      "",
      "Next, a payout method.",
    ].join("\n");
    const live = aldoLiveShots(text);
    expect(live.text).toBe("Your gigs are live.\n\nNext, a payout method.");
    expect(live.shots.map((shot) => shot.url)).toEqual([
      "https://fiverr.com/a",
      "https://fiverr.com/b",
    ]);
  });

  it("leaves a screenshot in a sentence, one linked to an image and one in code where they are", () => {
    for (const text of [
      "See [![Gig 1](a.png)](https://fiverr.com/a) for the first.",
      "[![Full size](a.png)](https://example.com/a-full.png)",
      "```\n[![Gig 1](a.png)](https://fiverr.com/a)\n```",
      "[![Local](a.png)](site/index.html)",
    ]) {
      expect(aldoLiveShots(text)).toEqual({ text, shots: [] });
    }
  });
});

describe("who can open it", () => {
  it("goes by Aldo's list of shares, then by what the agent recorded", () => {
    const shares: AldoShare[] = [
      { path: null, title: "Listed private", url: "https://aldo.computer/s/p1" },
      { path: null, title: "Recorded only you", url: "https://aldo.computer/s/p3", public: false },
      { path: null, title: "Recorded", url: "https://aldo.computer/s/p4" },
    ];
    const listed: AldoListedShare = (id) =>
      id === "p1" ? share("p1", { public: false, contentType: "application/pdf" }) : null;
    const laid = results({ shares, listed });
    const all = [
      ...laid.documents,
      ...laid.links.flatMap((link) => (link.item ? [link.item] : [])),
    ];
    const audience = Object.fromEntries(all.map((item) => [item.name, item.audience]));
    expect(audience).toEqual({
      "Listed private": "private",
      "Recorded only you": "private",
      // share_file's links are for anyone unless it was asked otherwise.
      Recorded: "public",
    });
    // Its share's type says what it is.
    expect(laid.documents.find((item) => item.name === "Listed private")?.kind).toBe("pdf");
  });

  it("is only the user for a file no link was made for", () => {
    expect(results({ files: ["plan.md"] }).documents[0]?.audience).toBe("private");
  });

  it("says a link was stopped, and keeps a file in the folder as the user's own", () => {
    const shares: AldoShare[] = [
      { path: null, title: "Old page", url: "https://aldo.computer/s/gone1" },
      { path: `${ROOT}/plan.md`, title: "Plan", url: "https://aldo.computer/s/gone2" },
    ];
    const laid = results({ shares, listed: () => "gone" });
    expect(laid.links[0]?.item?.audience).toBe("stopped");
    expect(laid.links[0]?.url).toBeNull();
    const plan = laid.documents[0];
    expect([plan?.name, plan?.audience, plan?.url]).toEqual(["plan.md", "private", null]);
  });

  it("keeps a stopped page's screenshot on it, and offers no stopped link", () => {
    const answer = [
      "Here it is.",
      "",
      "[![Old page](shots/old.png)](https://aldo.computer/s/gone1)",
      "",
      "[![Another](shots/other.png)](https://aldo.computer/s/gone3)",
    ].join("\n");
    const shares: AldoShare[] = [
      { path: null, title: "Old page", url: "https://aldo.computer/s/gone1" },
    ];
    const laid = results({ shares, answer, listed: () => "gone" });
    const links = [laid.main, ...laid.links.map((link) => link.item)].filter(Boolean);
    expect(links.map((item) => [item?.name, item?.url, item?.audience])).toEqual([
      ["Old page", null, "stopped"],
    ]);
    expect(laid.links.some((link) => link.url !== null)).toBe(false);
    expect(laid.mainImage ?? laid.links[0]?.image).toBe("shots/old.png");
  });
});

describe("aldoShareOf", () => {
  const step = (args: Record<string, unknown> | null, result: string | null) =>
    aldoShareOf({
      label: "share_file",
      tone: "tool",
      toolData: { tool: "share_file", server: "aldo", arguments: args, result },
    } as unknown as Parameters<typeof aldoShareOf>[0]);

  it("says when only the user can open it, from aldod's reply", () => {
    expect(
      step(
        { path: "/a.pdf", public: true },
        'Shared "A": https://aldo.computer/s/a1 (only the user, signed in, can open it)',
      ),
    ).toEqual({ path: "/a.pdf", title: "A", url: "https://aldo.computer/s/a1", public: false });
    // A link for anyone adds nothing to what a share was before.
    expect(
      step(
        { path: "/a.pdf", public: false },
        'Shared "A": https://aldo.computer/s/a1 (anyone with the link can open it)',
      ),
    ).toEqual({ path: "/a.pdf", title: "A", url: "https://aldo.computer/s/a1" });
  });

  it("goes by what the step asked for without a reply", () => {
    expect(step({ path: "/a.pdf" }, null)).toEqual({ path: "/a.pdf", title: null, url: null });
    expect(step({ path: "/a.pdf", public: false }, null)?.public).toBe(false);
  });
});

describe("aldoAddress", () => {
  it("is the host without www and the path without its query", () => {
    expect(aldoAddress("https://www.fiverr.com/logansack/logo-reveal/?ref=1")).toBe(
      "fiverr.com/logansack/logo-reveal",
    );
    expect(aldoAddress("https://example.com/")).toBe("example.com");
    expect(aldoAddress("not a url")).toBe("not a url");
  });
});

describe("aldoDocumentSections", () => {
  it("splits at headings, with a lone top heading as the title", () => {
    const doc = aldoDocumentSections(
      [
        "# Gig listings",
        "",
        "The three listings as published.",
        "",
        "## Gig 1: logo reveal",
        "",
        "### Title",
        "",
        "I will animate your logo",
        "",
        "### Search tags",
        "",
        "- logo animation",
        "- logo reveal",
      ].join("\n"),
    );
    expect(doc.title).toBe("Gig listings");
    expect(doc.sections).toEqual([
      { heading: null, depth: 0, body: "The three listings as published." },
      { heading: "Gig 1: logo reveal", depth: 2, body: "" },
      { heading: "Title", depth: 3, body: "I will animate your logo" },
      { heading: "Search tags", depth: 3, body: "- logo animation\n- logo reveal" },
    ]);
  });

  it("keeps a heading inside a code block in its part", () => {
    const doc = aldoDocumentSections(
      "## Script\n\n```sh\n# not a heading\necho hi\n```\n\n## After",
    );
    expect(doc.title).toBeNull();
    expect(doc.sections).toEqual([
      { heading: "Script", depth: 2, body: "```sh\n# not a heading\necho hi\n```" },
      { heading: "After", depth: 2, body: "" },
    ]);
  });

  it("has no title when there are several top headings, and keeps text before the first", () => {
    const doc = aldoDocumentSections("Intro\r\n\r\n# One\r\nA\r\n# Two ##\r\nB");
    expect(doc.title).toBeNull();
    expect(doc.sections.map((section) => [section.heading, section.body])).toEqual([
      [null, "Intro"],
      ["One", "A"],
      ["Two", "B"],
    ]);
  });
});

describe("aldoReadable", () => {
  it("is Markdown or text in the thread's folder", () => {
    expect(aldoReadable({ kind: "document", path: "a.md", fileName: "a.md" })).toBe(true);
    expect(aldoReadable({ kind: "document", path: "a.txt", fileName: "a.txt" })).toBe(true);
    expect(aldoReadable({ kind: "document", path: "a.docx", fileName: "a.docx" })).toBe(false);
    expect(aldoReadable({ kind: "document", path: null, fileName: "a.md" })).toBe(false);
  });
});
