import { describe, expect, it } from "vite-plus/test";

import { parseAldoSecretRequest } from "./secretRequest.logic";

describe("parseAldoSecretRequest", () => {
  it("reads an injected secret an agent asked for", () => {
    const search =
      "?request=STRIPE_SECRET_KEY&delivery=request&hosts=api.stripe.com&why=Test+checkout&thread=abc123xyz0&t3=t3-thread";
    expect(parseAldoSecretRequest(search, "*")).toEqual({
      kind: "request",
      name: "STRIPE_SECRET_KEY",
      scope: "*",
      hosts: "api.stripe.com",
      path: "",
      why: "Test checkout",
      requestedBy: { thread: "abc123xyz0", t3: "t3-thread" },
    });
  });

  it("defaults to a variable for every thread, and shows file paths under ~/", () => {
    expect(parseAldoSecretRequest("?request=DATABASE_URL&thread=t1&why=Dev+db", "*")).toMatchObject(
      {
        kind: "env",
        scope: "*",
        requestedBy: { thread: "t1" },
      },
    );
    expect(
      parseAldoSecretRequest(
        "?request=GCP_KEY&delivery=file&path=/vercel/.config/key.json&scope=me/app&thread=t1",
        "*",
      ),
    ).toMatchObject({ kind: "file", path: "~/.config/key.json", scope: "me/app" });
  });

  it("ignores a Vault URL without a whole request", () => {
    expect(parseAldoSecretRequest("", "*")).toBeNull();
    expect(parseAldoSecretRequest("?request=X", "*")).toBeNull();
    expect(parseAldoSecretRequest("?thread=t1", "*")).toBeNull();
    expect(parseAldoSecretRequest("?request=X&thread=t1&delivery=login", "*")).toBeNull();
  });
});
