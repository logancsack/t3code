import { describe, expect, it } from "vite-plus/test";

import { BRIEF_OFF, briefTimeOptions } from "./briefSettings.logic";

describe("briefTimeOptions", () => {
  it("offers the morning's half hours, then Off", () => {
    const options = briefTimeOptions(450);
    expect(options[0]?.value).toBe("300");
    expect(options.some((o) => o.value === "450")).toBe(true);
    expect(options.at(-1)).toEqual({ value: BRIEF_OFF, label: "Off" });
    expect(options).toHaveLength(12);
  });

  it("keeps a time set another way, in its place in the day", () => {
    const values = briefTimeOptions(465).map((o) => o.value);
    expect(values).toHaveLength(13);
    expect(values.indexOf("465")).toBe(values.indexOf("450") + 1);
    expect(
      briefTimeOptions(1200)
        .map((o) => o.value)
        .at(-2),
    ).toBe("1200");
  });
});
