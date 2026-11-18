import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { extractJsonObject, fromLenientJson } from "./schemaJson.ts";

const decodeLenientJson = Schema.decodeUnknownSync(fromLenientJson(Schema.Unknown));

describe("schemaJson helpers", () => {
  it("extracts a balanced JSON object from surrounding text", () => {
    expect(
      extractJsonObject(`Sure, here is the JSON:
\`\`\`json
{
  "subject": "Update README",
  "body": ""
}
\`\`\`
Done.`),
    ).toBe(`{
  "subject": "Update README",
  "body": ""
}`);
  });

  it("ignores braces inside strings while finding the object boundary", () => {
    expect(
      extractJsonObject('prefix {"message":"literal } brace","nested":{"ok":true}} suffix'),
    ).toBe('{"message":"literal } brace","nested":{"ok":true}}');
  });

  it("returns trimmed input when no JSON object starts", () => {
    expect(extractJsonObject("  no structured output  ")).toBe("no structured output");
  });

  it("decodes JSON with comments and trailing commas", () => {
    expect(
      decodeLenientJson(`{
        // Comments are valid in settings files.
        "enabled": true,
        "values": [1, 2,],
      }`),
    ).toEqual({
      enabled: true,
      values: [1, 2],
    });
  });

  it("rejects malformed JSON after lenient preprocessing", () => {
    expect(() => decodeLenientJson('{ "enabled": true,, }')).toThrow();
  });

  it("preserves commas before brackets inside string values", () => {
    // A comma inside a string value that happens to precede `}`/`]` must not
    // be stripped as if it were a trailing comma.
    expect(decodeLenientJson('{"note":"a,]"}')).toEqual({ note: "a,]" });
    expect(decodeLenientJson('{"list":["x,}"]}')).toEqual({ list: ["x,}"] });
    // Genuine trailing commas are still removed.
    expect(decodeLenientJson('{"values":[1, 2,],}')).toEqual({ values: [1, 2] });
  });
});
