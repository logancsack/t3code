import { assert, describe, it } from "vite-plus/test";

import {
  T3_PIERRE_ICONS,
  hasSpecificPierreIconForFileName,
  resolvePierreIconForEntry,
  syntheticFileNameForLanguageId,
} from "./pierre-icons";

describe("Pierre file icons", () => {
  it("ships every custom icon referenced by the extended resolver", () => {
    const customIconNames = new Set(
      Object.values(T3_PIERRE_ICONS.byFileName).filter((name) => name.startsWith("t3-")),
    );
    for (const iconName of customIconNames) {
      assert.include(T3_PIERRE_ICONS.spriteSheet, `id="${iconName}"`);
    }
  });

  it("uses the Pierre default icon for unknown file types", () => {
    assert.equal(resolvePierreIconForEntry("artifact.unknown-ext", "file")?.token, "default");
    assert.isFalse(hasSpecificPierreIconForFileName("artifact.unknown-ext"));
  });

  it("leaves directory rendering to the shared folder fallback", () => {
    assert.isNull(resolvePierreIconForEntry("packages/client-runtime", "directory"));
  });

  it("normalizes common markdown fence language aliases", () => {
    assert.equal(syntheticFileNameForLanguageId("typescript"), "file.ts");
    assert.equal(syntheticFileNameForLanguageId("dockerfile"), "Dockerfile");
    assert.equal(syntheticFileNameForLanguageId("shellscript"), "file.sh");
    assert.equal(syntheticFileNameForLanguageId("python"), "file.py");
  });
});
