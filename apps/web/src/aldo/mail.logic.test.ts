import { describe, expect, it } from "vite-plus/test";

import {
  appendMailPage,
  formatMailSize,
  hasRemoteMailContent,
  inlineImageOrigins,
  linkifyMailText,
  mailBody,
  mailContentSecurityPolicy,
  mailConversations,
  mailDocument,
  mailFiles,
  mailPersonLabel,
  mailRowPeople,
  mailSnippet,
  mailTimeKind,
  mergeMailPages,
  parseAldoMailSearch,
  parseMailAddress,
  parseMailFrameMessage,
  withInlineImages,
} from "./mail.logic";

describe("parseAldoMailSearch", () => {
  it("keeps a known folder, a search and a conversation", () => {
    expect(
      parseAldoMailSearch({ folder: "sent", q: " invoice ", thread: "thd_1", message: "<a@b>" }),
    ).toEqual({
      folder: "sent",
      q: "invoice",
      thread: "thd_1",
      message: "<a@b>",
    });
  });

  it("leaves out the inbox (the default), unknown folders, blanks and a message without its conversation", () => {
    expect(parseAldoMailSearch({ folder: "inbox" })).toEqual({});
    expect(parseAldoMailSearch({ folder: "trash", q: "  ", thread: 3 })).toEqual({});
    expect(parseAldoMailSearch({ message: "<a@b>" })).toEqual({});
  });

  it("caps a search at what Aldo takes", () => {
    expect(parseAldoMailSearch({ q: "x".repeat(300) }).q).toHaveLength(200);
  });
});

describe("parseMailAddress", () => {
  it("reads the ways mail writes people", () => {
    expect(parseMailAddress("Ada Lovelace <ada@example.com>")).toEqual({
      name: "Ada Lovelace",
      address: "ada@example.com",
    });
    expect(parseMailAddress('"Lovelace, Ada" <ada@example.com>')).toEqual({
      name: "Lovelace, Ada",
      address: "ada@example.com",
    });
    expect(parseMailAddress("ada@example.com")).toEqual({ name: "", address: "ada@example.com" });
    expect(parseMailAddress("<ada@example.com>")).toEqual({ name: "", address: "ada@example.com" });
  });

  it("doesn't repeat an address given as the name", () => {
    expect(parseMailAddress("ada@example.com <ada@example.com>").name).toBe("");
  });

  it("calls someone by name, else by address", () => {
    expect(mailPersonLabel("Ada <ada@example.com>")).toBe("Ada");
    expect(mailPersonLabel("ada@example.com")).toBe("ada@example.com");
  });
});

describe("mailRowPeople", () => {
  it("shows who wrote received mail, and who sent mail went to", () => {
    expect(
      mailRowPeople({ from: "Ada <ada@example.com>", to: ["agent@aldomail.com"], sent: false }),
    ).toBe("Ada");
    expect(
      mailRowPeople({
        from: "agent@aldomail.com",
        to: ["Ada <ada@example.com>", "bob@example.com"],
        sent: true,
      }),
    ).toBe("To: Ada, bob@example.com");
    expect(mailRowPeople({ from: "agent@aldomail.com", to: [], sent: true })).toBe("To: (no one)");
  });
});

describe("mailTimeKind", () => {
  const now = new Date(2026, 9, 12, 15, 0);
  it("is the time today, the day this year, the date before", () => {
    expect(mailTimeKind(new Date(2026, 9, 12, 9, 30).toISOString(), now)).toBe("time");
    expect(mailTimeKind(new Date(2026, 2, 1).toISOString(), now)).toBe("day");
    expect(mailTimeKind(new Date(2025, 11, 31).toISOString(), now)).toBe("date");
    expect(mailTimeKind("", now)).toBeNull();
  });
});

describe("formatMailSize", () => {
  it("reads like a file size", () => {
    expect(formatMailSize(512)).toBe("512 B");
    expect(formatMailSize(1536)).toBe("1.5 KB");
    expect(formatMailSize(1024 * 1024 * 12.4)).toBe("12 MB");
    expect(formatMailSize(-1)).toBe("");
  });
});

describe("mailBody", () => {
  it("shows HTML over text", () => {
    expect(mailBody({ reply: false, html: "<p>Hi</p>", text: "Hi" }, false)).toEqual({
      kind: "html",
      content: "<p>Hi</p>",
      quoteHidden: false,
      quotes: false,
    });
    expect(mailBody({ reply: false, html: "  ", text: "Hi" }, false)?.kind).toBe("text");
    expect(mailBody({ reply: false }, false)).toBeNull();
  });

  it("shows what's new in a reply, and what it quotes when asked", () => {
    const reply = {
      reply: true,
      text: "Thanks!\n\nOn Monday, Ada wrote:\n> Hi",
      extractedText: "Thanks!",
    };
    expect(mailBody(reply, false)).toEqual({
      kind: "text",
      content: "Thanks!",
      quoteHidden: true,
      quotes: true,
    });
    expect(mailBody(reply, true)).toEqual({
      kind: "text",
      content: reply.text,
      quoteHidden: false,
      quotes: true,
    });
  });

  it("has nothing to hide when the new part is the whole of it, or it isn't a reply", () => {
    expect(mailBody({ reply: true, text: "Thanks", extractedText: "Thanks" }, false)?.quotes).toBe(
      false,
    );
    expect(mailBody({ reply: false, text: "A\n> B", extractedText: "A" }, false)?.content).toBe(
      "A\n> B",
    );
  });
});

describe("mailSnippet", () => {
  it("is what's new, as plain text on one line", () => {
    expect(mailSnippet({ reply: true, text: "Thanks\n> old", extractedText: "Thanks" })).toBe(
      "Thanks",
    );
    expect(
      mailSnippet({
        reply: false,
        html: "<style>p{color:red}</style><p>Fish &amp; chips</p>\n<p>tonight?</p>",
      }),
    ).toBe("Fish & chips tonight?");
  });

  it("is cut short with an ellipsis", () => {
    expect(mailSnippet({ reply: false, text: "word ".repeat(10) }, 11)).toBe("word word…");
  });
});

describe("mailFiles", () => {
  const files = [
    { id: "logo", contentId: "Logo@x", contentType: "image/png", inline: true },
    { id: "photo", contentId: "photo@x", contentType: "image/jpeg", inline: true },
    { id: "pdf", contentType: "application/pdf", inline: false },
  ];
  it("lists all but the images shown inside the mail", () => {
    const listed = mailFiles({ html: '<img src="cid:logo@x">', attachments: files });
    expect(listed.map((file) => file.id)).toEqual(["photo", "pdf"]);
  });

  it("lists every file of a text message", () => {
    expect(mailFiles({ attachments: files })).toHaveLength(3);
  });
});

describe("mergeMailPages", () => {
  const at = (minutes: number) =>
    new Date(Date.UTC(2026, 9, 12, 12, 0) - minutes * 60_000).toISOString();
  const m = (id: string, minutes: number) => ({ id, at: at(minutes) });
  const loaded = {
    key: "folder:inbox",
    messages: [m("c", 1), m("b", 2), m("a", 3)],
    next: "page_3",
  };

  it("keeps the older pages loaded below a fresh first page", () => {
    const fresh = { key: "folder:inbox", messages: [m("d", 0), m("c", 1)], next: "page_2" };
    expect(mergeMailPages(loaded, fresh, true)).toEqual({
      key: "folder:inbox",
      messages: [m("d", 0), m("c", 1), m("b", 2), m("a", 3)],
      next: "page_3",
    });
  });

  it("drops what's no longer there above the first page's end", () => {
    const fresh = { key: "folder:inbox", messages: [m("d", 0), m("b", 2)], next: "page_2" };
    expect(mergeMailPages(loaded, fresh, true).messages.map((x) => x.id)).toEqual(["d", "b", "a"]);
  });

  it("starts over for another folder, a search, or a folder that fits on a page", () => {
    const fresh = { key: "folder:inbox", messages: [m("d", 0)], next: "page_2" };
    expect(mergeMailPages(loaded, { ...fresh, key: "folder:sent" }, true).messages).toHaveLength(1);
    expect(mergeMailPages(loaded, fresh, false).messages).toHaveLength(1);
    expect(mergeMailPages(loaded, { ...fresh, next: null }, true).messages).toHaveLength(1);
    expect(mergeMailPages(null, fresh, true)).toBe(fresh);
  });

  it("adds a next page without what's there already", () => {
    expect(appendMailPage(loaded, { messages: [m("a", 3), m("z", 9)], next: null })).toEqual({
      key: "folder:inbox",
      messages: [...loaded.messages, m("z", 9)],
      next: null,
    });
  });
});

describe("mailConversations", () => {
  it("lists a conversation once, at its first message, with how many of its messages are listed", () => {
    const rows = mailConversations([
      { id: "4", threadId: "a" },
      { id: "3", threadId: "b" },
      { id: "2", threadId: "a" },
      { id: "1", threadId: "c" },
    ]);
    expect(rows.map((row) => [row.mail.id, row.count])).toEqual([
      ["4", 2],
      ["3", 1],
      ["1", 1],
    ]);
  });
});

describe("linkifyMailText", () => {
  it("finds web addresses, without the punctuation after them", () => {
    expect(linkifyMailText("See https://example.com/a?b=1. Or http://x.test)")).toEqual([
      { kind: "text", value: "See ", start: 0 },
      { kind: "link", value: "https://example.com/a?b=1", start: 4 },
      { kind: "text", value: ". Or ", start: 29 },
      { kind: "link", value: "http://x.test", start: 34 },
      { kind: "text", value: ")", start: 47 },
    ]);
  });

  it("links nothing else", () => {
    expect(linkifyMailText("javascript:alert(1) ftp://x")).toEqual([
      { kind: "text", value: "javascript:alert(1) ftp://x", start: 0 },
    ]);
  });
});

describe("withInlineImages", () => {
  it("points the mail's own images at where Aldo said they are", () => {
    const images = [
      { contentId: "Logo@X", url: "https://cdn.agentmail.to/logo?sig=1" },
      { contentId: "evil@x", url: "javascript:alert(1)" },
    ];
    expect(
      withInlineImages(
        '<img src="cid:logo@x"><img src="cid:evil@x"><img src="cid:gone@x">',
        images,
      ),
    ).toBe(
      '<img src="https://cdn.agentmail.to/logo?sig=1"><img src="cid:evil@x"><img src="cid:gone@x">',
    );
  });

  it("allows its images' origins, and only https ones", () => {
    expect(
      inlineImageOrigins([
        { url: "https://cdn.agentmail.to/a" },
        { url: "https://cdn.agentmail.to/b" },
        { url: "http://insecure.test/c" },
        {},
      ]),
    ).toEqual(["https://cdn.agentmail.to"]);
  });
});

describe("hasRemoteMailContent", () => {
  it("notices what loads from the web", () => {
    expect(hasRemoteMailContent('<img src="https://t.example/pixel.gif">')).toBe(true);
    expect(hasRemoteMailContent("<img src=//t.example/p.gif>")).toBe(true);
    expect(hasRemoteMailContent("<td style=\"background:url('https://x.test/a.png')\">")).toBe(
      true,
    );
    expect(hasRemoteMailContent("<style>@import 'https://x.test/a.css';</style>")).toBe(true);
    expect(hasRemoteMailContent('<link rel="stylesheet" href="https://x.test/a.css">')).toBe(true);
  });

  it("doesn't count links, or images written into the mail", () => {
    expect(
      hasRemoteMailContent(
        '<a href="https://example.com">x</a><img src="data:image/png;base64,AA">',
      ),
    ).toBe(false);
  });
});

describe("mailContentSecurityPolicy", () => {
  it("runs only our script and loads only the mail's own images", () => {
    expect(
      mailContentSecurityPolicy({
        nonce: "n1",
        remote: false,
        imageOrigins: ["https://cdn.agentmail.to"],
      }),
    ).toBe(
      "default-src 'none'; script-src 'nonce-n1'; img-src data: https://cdn.agentmail.to; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'",
    );
  });

  it("loads images, styles and fonts from the web once the user asks", () => {
    const policy = mailContentSecurityPolicy({ nonce: "n1", remote: true, imageOrigins: [] });
    expect(policy).toContain("img-src data: https: http:");
    expect(policy).toContain("style-src 'unsafe-inline' https: http:");
    expect(policy).toContain("font-src data: https: http:");
    expect(policy).toContain("script-src 'nonce-n1';");
  });
});

describe("parseMailFrameMessage", () => {
  it("takes a height only from our script", () => {
    expect(parseMailFrameMessage({ aldoMail: "n1", height: 420 }, "n1")).toBe(420);
    expect(parseMailFrameMessage({ aldoMail: "n2", height: 420 }, "n1")).toBeNull();
    expect(parseMailFrameMessage({ aldoMail: "n1", height: Number.NaN }, "n1")).toBeNull();
    expect(parseMailFrameMessage({ aldoMail: "n1", height: -1 }, "n1")).toBeNull();
    expect(parseMailFrameMessage("n1", "n1")).toBeNull();
    expect(parseMailFrameMessage(null, "n1")).toBeNull();
  });
});

describe("mailDocument", () => {
  const document = mailDocument({
    nonce: "n1",
    policy: "default-src 'none'; script-src 'nonce-n1'",
    head: "<style>p{}</style>",
    bodyAttributes: 'bgcolor="#eee"',
    body: "<p>Hi</p>",
  });

  it("puts our policy before anything of the mail's", () => {
    const policy = document.indexOf("Content-Security-Policy");
    expect(policy).toBeGreaterThan(-1);
    expect(policy).toBeLessThan(document.indexOf("<style>p{}</style>"));
    expect(document).toContain(`content="default-src 'none'; script-src 'nonce-n1'"`);
  });

  it("runs our script with its nonce, in the head, before the mail's markup", () => {
    expect(document).toContain('<script nonce="n1">');
    expect(document.indexOf("<script")).toBeLessThan(document.indexOf("</head>"));
    expect(document).toContain('aldoMail:"n1"');
  });

  it("opens links in a new tab, without a referrer, and keeps the mail's body", () => {
    expect(document).toContain('<base target="_blank">');
    expect(document).toContain('<meta name="referrer" content="no-referrer">');
    expect(document).toContain(
      '<body bgcolor="#eee"><div id="aldo-mail-root"><p>Hi</p></div></body>',
    );
  });
});
