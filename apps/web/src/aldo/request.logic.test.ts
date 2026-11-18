import { describe, expect, it } from "vite-plus/test";

import { aldoRecalledPrompt, aldoRequestLabel, aldoRequestOf } from "./request.logic";

const SIGNATURE = "_(Sent by Aldo, the user's assistant, for them.)_";
const HEADER =
  "The user's request to Aldo on Home, in their own words (for context: the brief above is the task):";
const BRIEF =
  "Set up a Fiverr motion-graphics business for the user.\n\n1. Research what sells.\n2. Make 8 portfolio clips.";
const REQUEST =
  "Start a Fiverr motion-graphics business for me: research what sells, make a portfolio of samples, write the gig listings, and set up my seller account.";

/** A first message as Aldo's fromAldo writes it (src/lib/from-aldo.ts). */
const fromAldo = (brief: string, quoted: string, header = HEADER) =>
  `${brief}\n\n${header}\n\n${quoted}\n\n${SIGNATURE}`;

describe("aldoRequestOf", () => {
  it("reads the user's words and the brief from a thread Aldo started", () => {
    expect(aldoRequestOf(fromAldo(BRIEF, `> ${REQUEST}`))).toEqual({
      said: REQUEST,
      from: "home",
      brief: BRIEF,
    });
    expect(
      aldoRequestOf(fromAldo(BRIEF, "> Book a table.", HEADER.replace("on Home", "by text"))),
    ).toMatchObject({ said: "Book a table.", from: "text" });
  });

  it("unquotes every line, blank lines and the user's own quotes included", () => {
    const quoted = ["> First line", ">", "> > their quote", `> ${HEADER}`, `> ${SIGNATURE}`].join(
      "\n",
    );
    expect(aldoRequestOf(fromAldo(BRIEF, quoted))?.said).toBe(
      ["First line", "", "> their quote", HEADER, SIGNATURE].join("\n"),
    );
    // Line endings and trailing space a transport may add don't matter.
    expect(aldoRequestOf(`${fromAldo(BRIEF, `> ${REQUEST}`).replace(/\n/g, "\r\n")}\n`)?.said).toBe(
      REQUEST,
    );
  });

  it("takes the last block, so a brief that mentions one stays in the brief", () => {
    const brief = `${BRIEF}\n\n${HEADER}\n\n> not theirs\n\nMore of the brief.`;
    expect(aldoRequestOf(fromAldo(brief, `> ${REQUEST}`))).toEqual({
      said: REQUEST,
      from: "home",
      brief,
    });
  });

  it("shows any other message as it is", () => {
    expect(aldoRequestOf(REQUEST)).toBeNull();
    // Aldo's message without the user's words.
    expect(aldoRequestOf(`${BRIEF}\n\n${SIGNATURE}`)).toBeNull();
    // Unsigned: the user typed it.
    expect(aldoRequestOf(`${BRIEF}\n\n${HEADER}\n\n> ${REQUEST}`)).toBeNull();
    // A line that isn't quoted, an empty quote, an unknown place, or no brief.
    expect(aldoRequestOf(fromAldo(BRIEF, `> ${REQUEST}\nnot quoted`))).toBeNull();
    expect(aldoRequestOf(fromAldo(BRIEF, ">\n>"))).toBeNull();
    expect(
      aldoRequestOf(fromAldo(BRIEF, "> hi", HEADER.replace("on Home", "on a call"))),
    ).toBeNull();
    expect(aldoRequestOf(`\n\n${HEADER}\n\n> ${REQUEST}\n\n${SIGNATURE}`)).toBeNull();
  });
});

describe("aldoRecalledPrompt", () => {
  it("brings back the user's words, and nothing else Aldo wrote", () => {
    expect(aldoRecalledPrompt(fromAldo(BRIEF, `> ${REQUEST}`))).toBe(REQUEST);
    expect(aldoRecalledPrompt(`${BRIEF}\n\n${SIGNATURE}`)).toBe("");
    expect(aldoRecalledPrompt(`${BRIEF}\r\n\r\n${SIGNATURE}\n`)).toBe("");
    // What the user typed is theirs, as it is.
    expect(aldoRecalledPrompt(REQUEST)).toBeNull();
    expect(aldoRecalledPrompt(`Quoting Aldo: ${SIGNATURE} and more`)).toBeNull();
  });
});

describe("aldoRequestLabel", () => {
  it("says where the user asked", () => {
    expect(aldoRequestLabel("home")).toBe("Your request, from Home");
    expect(aldoRequestLabel("text")).toBe("Your request, by text");
  });
});
