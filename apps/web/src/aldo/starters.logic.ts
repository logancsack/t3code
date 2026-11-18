// Home's starters (AldoStarters.tsx): real requests, each with about how long
// it takes, picked by what the user told the welcome they'd hand Aldo first
// (onboarding.logic.ts). A starter fills the composer with the request, to
// finish with their own details and send; it never sends.

import { type AldoInterest } from "./onboarding.logic";

/** Starters on Home at a time; "More ideas" shows the next ones. */
export const STARTERS_AT_A_TIME = 4;

export type AldoStarterIcon =
  | "store"
  | "tag"
  | "users"
  | "file-text"
  | "mail"
  | "sheet"
  | "receipt"
  | "eraser"
  | "chart"
  | "landmark"
  | "presentation"
  | "signature"
  | "file-user"
  | "book"
  | "film"
  | "pen-tool"
  | "image"
  | "scissors"
  | "search"
  | "scale"
  | "pie-chart"
  | "building"
  | "code"
  | "bug"
  | "terminal"
  | "list-checks";

export interface AldoStarter {
  readonly id: string;
  readonly interest: AldoInterest;
  readonly icon: AldoStarterIcon;
  readonly title: string;
  readonly detail: string;
  /** About how long the agent takes. */
  readonly minutes: number;
  /** The request it puts in the composer, ending where the user adds their details. */
  readonly words: string;
  /** What it needs besides words: the user's mail, or (for code) one of their repositories if they have one. */
  readonly needs?: "mail" | "repository";
}

/** Each kind of work's starters, best first. */
export const ALDO_STARTERS: ReadonlyArray<AldoStarter> = [
  {
    id: "fiverr",
    interest: "business",
    icon: "store",
    title: "Start a Fiverr business",
    detail: "Research what sells, make samples, write the gigs and set up the account",
    minutes: 30,
    words:
      "Start a Fiverr business for me: research what sells and at what price, make a few samples, write three gig listings and set up my seller account. What I’m good at: ",
  },
  {
    id: "price",
    interest: "business",
    icon: "tag",
    title: "Price my services",
    detail: "Compare 10 competitors and suggest three packages, with sources",
    minutes: 10,
    words:
      "Price my services: compare 10 competitors, with links, and suggest three packages with a price and what each includes. What I sell, and where: ",
  },
  {
    id: "customers",
    interest: "business",
    icon: "users",
    title: "Find my first customers",
    detail: "25 leads in a spreadsheet, each with a contact and a first email",
    minutes: 20,
    words:
      "Find my first customers: a spreadsheet of 25 businesses that could use what I sell, with a contact for each and a short first email I can send. What I sell, and to whom: ",
  },
  {
    id: "business-plan",
    interest: "business",
    icon: "file-text",
    title: "Write a business plan",
    detail: "Market, pricing, costs and the first 12 months, as a Word document",
    minutes: 25,
    words:
      "Write a business plan as a Word document: the market and competitors, pricing, startup costs and a month-by-month plan for the first year, with sources. The business: ",
  },
  {
    id: "inbox",
    interest: "business",
    icon: "mail",
    title: "Sort my inbox",
    detail: "What needs you this week, with replies drafted for you to send",
    minutes: 5,
    words:
      "Go through my inbox from the last week: tell me what needs me, and draft replies for me to approve.",
    needs: "mail",
  },
  {
    id: "budget",
    interest: "finance",
    icon: "sheet",
    title: "Build a budget",
    detail: "An Excel workbook by category, with formulas and a monthly chart",
    minutes: 10,
    words:
      "Build a budget in Excel: income and spending by category, formulas that total each month, and a chart of where the money goes. What I earn and spend: ",
  },
  {
    id: "receipts",
    interest: "finance",
    icon: "receipt",
    title: "Track my expenses",
    detail: "Receipts from your mail in a spreadsheet, totaled by month",
    minutes: 15,
    words:
      "Find the receipts in my email from the last three months and put them in a spreadsheet: date, vendor, amount and category, totaled by month.",
    needs: "mail",
  },
  {
    id: "clean-sheet",
    interest: "finance",
    icon: "eraser",
    title: "Fix a spreadsheet",
    detail: "Broken formulas fixed and the sheets tidied, with what changed",
    minutes: 10,
    words:
      "Fix the spreadsheet I’m attaching: repair the broken formulas, tidy the sheets, keep what it puts out the same, and tell me what changed.",
  },
  {
    id: "price-model",
    interest: "finance",
    icon: "chart",
    title: "Model a price change",
    detail: "Revenue and profit over 12 months, with assumptions you can change",
    minutes: 15,
    words:
      "Make a spreadsheet model of what a price change does to my revenue and profit over 12 months, with the assumptions in cells I can change. My prices and sales now: ",
  },
  {
    id: "loans",
    interest: "finance",
    icon: "landmark",
    title: "Compare loan offers",
    detail: "Monthly payment, total cost and the fine print, side by side",
    minutes: 10,
    words:
      "Compare these loan offers side by side in a spreadsheet: the monthly payment, the total cost over the term and anything in the terms to watch for. The offers: ",
  },
  {
    id: "deck",
    interest: "documents",
    icon: "presentation",
    title: "Turn notes into a deck",
    detail: "A PowerPoint deck with speaker notes, in your colors",
    minutes: 15,
    words:
      "Turn my notes into a PowerPoint deck of about 10 slides, with speaker notes, in my colors. My notes: ",
  },
  {
    id: "proposal",
    interest: "documents",
    icon: "signature",
    title: "Write a proposal",
    detail: "Scope, timeline and price in a Word document a client can sign",
    minutes: 15,
    words:
      "Write a proposal as a Word document: the client’s problem, what I’ll do, the timeline, the price and a place to sign. The client and the job: ",
  },
  {
    id: "resume",
    interest: "documents",
    icon: "file-user",
    title: "Fit my résumé to a job",
    detail: "One page, rewritten for the job you want, as Word and PDF",
    minutes: 10,
    words:
      "Rewrite my résumé for this job, on one page, as a Word document and a PDF. The job, and my résumé: ",
  },
  {
    id: "summary",
    interest: "documents",
    icon: "book",
    title: "Summarize a long PDF",
    detail: "The key points on one page, with the page each comes from",
    minutes: 5,
    words:
      "Summarize the PDF I’m attaching on one page: the key points, the numbers that matter and the page each comes from.",
  },
  {
    id: "promo",
    interest: "media",
    icon: "film",
    title: "Make a 30-second promo",
    detail: "From your logo and a few lines: a finished video in three sizes",
    minutes: 15,
    words:
      "Make a 30-second promo video from my logo and a few lines of text, with music, in three sizes: 16:9, 9:16 and square. What it’s for: ",
  },
  {
    id: "logo",
    interest: "media",
    icon: "pen-tool",
    title: "Design a logo",
    detail: "Three directions, then the one you pick in every size",
    minutes: 15,
    words:
      "Design a logo: three directions first, then the one I pick as SVG and PNG in every size I need. The business, and the feel I want: ",
  },
  {
    id: "social",
    interest: "media",
    icon: "image",
    title: "Make a week of posts",
    detail: "Seven posts with images, sized for Instagram, LinkedIn and X",
    minutes: 15,
    words:
      "Make a week of social posts: the text and an image for each, sized for Instagram, LinkedIn and X. What to promote: ",
  },
  {
    id: "clips",
    interest: "media",
    icon: "scissors",
    title: "Cut a video into clips",
    detail: "Five short clips with subtitles, ready to post",
    minutes: 20,
    words:
      "Cut this video into five clips under a minute each, with subtitles, ready to post. The video, and what the clips should show: ",
  },
  {
    id: "research",
    interest: "research",
    icon: "search",
    title: "Research something",
    detail: "A brief with sources, as a Google Doc or PDF",
    minutes: 10,
    words: "Research this and write it up as a short brief with sources, as a Google Doc: ",
  },
  {
    id: "compare",
    interest: "research",
    icon: "scale",
    title: "Compare your options",
    detail: "Prices, features and reviews in a table, with a pick",
    minutes: 10,
    words:
      "Compare the options in a table: price, features and what reviewers say, with links, and tell me which you’d pick and why. What I’m choosing: ",
  },
  {
    id: "market",
    interest: "research",
    icon: "pie-chart",
    title: "Size a market",
    detail: "How big it is, who’s in it and how fast it’s growing, with sources",
    minutes: 15,
    words:
      "Size this market: how big it is, the main companies in it, how fast it’s growing and who buys, with sources. The market: ",
  },
  {
    id: "company",
    interest: "research",
    icon: "building",
    title: "Check out a company",
    detail: "What it does, who runs it and what to know before you sign",
    minutes: 10,
    words:
      "Look into this company before I work with them: what they do, who runs it, reviews, news and anything I should know, with sources. The company: ",
  },
  {
    id: "build",
    interest: "code",
    icon: "code",
    title: "Build a small web app",
    detail: "A site or an app from a sentence, with a link to try it",
    minutes: 30,
    words: "Build a small web app and give me a link to try it. What it should do: ",
    needs: "repository",
  },
  {
    id: "bug",
    interest: "code",
    icon: "bug",
    title: "Fix a bug",
    detail: "Found, fixed and tested, with a pull request",
    minutes: 20,
    words:
      "Find and fix this bug, test the fix and open a pull request. The repository, and what goes wrong: ",
    needs: "repository",
  },
  {
    id: "script",
    interest: "code",
    icon: "terminal",
    title: "Write a script",
    detail: "A chore you do by hand, automated, with how to run it",
    minutes: 10,
    words: "Write a script that does this for me, test it and tell me how to run it. The chore: ",
  },
  {
    id: "review",
    interest: "code",
    icon: "list-checks",
    title: "Review my code",
    detail: "What to fix first, with the files, lines and why",
    minutes: 15,
    words:
      "Review the code in my repository: what to fix first, with the files and lines and why. The repository: ",
    needs: "repository",
  },
];

/** For someone who didn't say: one of each kind of work most people hand Aldo first. */
const MIX: ReadonlyArray<string> = ["research", "deck", "promo", "inbox"];

/** "About 15 min". */
export function aldoStarterTime(starter: Pick<AldoStarter, "minutes">): string {
  return `About ${starter.minutes} min`;
}

/**
 * Every starter for these interests, in the order Home shows them: the kinds
 * they picked taken in turn (two picked, two of each come first), then the
 * rest. Someone who didn't say gets a mix first. Code's come only for code,
 * or for an account that was never asked (which had them before the welcome).
 */
export function aldoStartersFor(
  interests: ReadonlyArray<AldoInterest> | null,
): ReadonlyArray<AldoStarter> {
  const picked = interests ?? [];
  const offered = ALDO_STARTERS.filter(
    (starter) => starter.interest !== "code" || interests === null || picked.includes("code"),
  );
  const byInterest = (interest: AldoInterest) =>
    offered.filter((starter) => starter.interest === interest);
  const first: AldoStarter[] = [];
  if (picked.length > 0) {
    const lists = picked.map(byInterest);
    for (let turn = 0; lists.some((list) => turn < list.length); turn++) {
      for (const list of lists) if (list[turn]) first.push(list[turn]!);
    }
  } else {
    for (const id of MIX) {
      const starter = offered.find((s) => s.id === id);
      if (starter) first.push(starter);
    }
  }
  return [...first, ...offered.filter((starter) => !first.includes(starter))];
}

/** The `page`th set of starters at a time, going round to the start again. */
export function aldoStarterPage<T>(starters: ReadonlyArray<T>, page: number): ReadonlyArray<T> {
  if (starters.length <= STARTERS_AT_A_TIME) return starters;
  const start = (page * STARTERS_AT_A_TIME) % starters.length;
  return Array.from(
    { length: STARTERS_AT_A_TIME },
    (_, index) => starters[(start + index) % starters.length]!,
  );
}
