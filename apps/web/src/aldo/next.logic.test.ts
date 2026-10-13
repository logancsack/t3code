import { describe, expect, it } from "vite-plus/test";

import { splitAldoNext } from "./next.logic";

describe("splitAldoNext", () => {
  it("takes the follow-ups out of the reply", () => {
    expect(
      splitAldoNext(
        "Here's the sheet.\n\n```aldo-next\nDo this every month\n- Cancel Dropbox Plus\n2. Email it to Sam\nOne too many\n```\n",
      ),
    ).toEqual({
      text: "Here's the sheet.",
      next: ["Do this every month", "Cancel Dropbox Plus", "Email it to Sam"],
    });
  });

  it("hides a block still streaming in", () => {
    expect(splitAldoNext("Done.\n\n```aldo-next\nDeploy it")).toEqual({
      text: "Done.",
      next: ["Deploy it"],
    });
    expect(splitAldoNext("Done.\n\n```aldo-next")).toEqual({ text: "Done.", next: [] });
  });

  it("leaves other code alone", () => {
    const reply = "Run:\n\n```sh\necho aldo-next\n```";
    expect(splitAldoNext(reply)).toEqual({ text: reply, next: [] });
    expect(splitAldoNext("No block here")).toEqual({ text: "No block here", next: [] });
  });
});
