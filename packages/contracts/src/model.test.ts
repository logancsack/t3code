import { describe, expect, it } from "vite-plus/test";

import { ProviderDriverKind } from "./providerInstance.ts";
import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  DEFAULT_MODEL_BY_PROVIDER,
  PROVIDER_DISPLAY_NAMES,
} from "./model.ts";

describe("Muse Code model metadata", () => {
  const muse = ProviderDriverKind.make("muse");

  it("uses Muse Spark 1.2 as the interactive and text-generation default", () => {
    expect(DEFAULT_MODEL_BY_PROVIDER[muse]).toBe("muse-spark-1.2");
    expect(DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[muse]).toBe("muse-spark-1.2");
  });

  it("uses the full product name in provider presentation", () => {
    expect(PROVIDER_DISPLAY_NAMES[muse]).toBe("Muse Code");
  });
});

describe("Prime Agent model metadata", () => {
  const prime = ProviderDriverKind.make("primeAgent");

  it("defers interactive and text-generation model selection to Prime", () => {
    expect(DEFAULT_MODEL_BY_PROVIDER[prime]).toBe("auto");
    expect(DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[prime]).toBe("auto");
    expect(PROVIDER_DISPLAY_NAMES[prime]).toBe("Prime Agent");
  });
});
