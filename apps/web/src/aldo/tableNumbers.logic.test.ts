import { describe, expect, it } from "vite-plus/test";

import { isNumberCell } from "./tableNumbers.logic";

describe("isNumberCell", () => {
  it("takes counts, amounts, shares and multiples", () => {
    for (const cell of [
      "0",
      "14",
      "1,234",
      "1 234 567",
      "18,412.07",
      "$18,412.07",
      "-$500",
      "−3.4%",
      "+12%",
      "<0.1%",
      "~$1.2M",
      "804K",
      "19.9B",
      "1.2bn",
      "2.5x",
      "€ 5",
      "5 €",
      "USD 1,200",
      "1,200 USD",
      "(1,234)",
      " 42 ",
    ]) {
      expect(isNumberCell(cell), cell).toBe(true);
    }
  });

  it("takes dates, times, ranges and phone numbers written in digits", () => {
    for (const cell of ["2026-10-21", "10/21/2026", "14:30", "3–5", "+1 415 555 0100"]) {
      expect(isNumberCell(cell), cell).toBe(true);
    }
  });

  it("leaves words, and numbers among words, in the interface face", () => {
    for (const cell of [
      "",
      "  ",
      "—",
      "N/A",
      "Unpriced",
      "Q3",
      "v1.2",
      "#12",
      "1st",
      "14 deals",
      "2 days",
      "6:03 PM",
      "1.2 GB",
      "Oct 21",
      "$",
      "1".repeat(41),
    ]) {
      expect(isNumberCell(cell), cell).toBe(false);
    }
  });
});
