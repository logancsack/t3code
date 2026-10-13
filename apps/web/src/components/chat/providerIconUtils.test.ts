import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { MuseCodeIcon, PrimeAgentIcon } from "../Icons";
import { PROVIDER_ICON_BY_PROVIDER } from "./providerIconUtils";

describe("Muse Code provider presentation", () => {
  const muse = ProviderDriverKind.make("muse");

  it("uses the Meta brand icon", () => {
    expect(PROVIDER_ICON_BY_PROVIDER[muse]).toBe(MuseCodeIcon);
  });
});

describe("Prime Agent provider presentation", () => {
  const primeAgent = ProviderDriverKind.make("primeAgent");

  it("uses the Prime Intellect butterfly icon", () => {
    expect(PROVIDER_ICON_BY_PROVIDER[primeAgent]).toBe(PrimeAgentIcon);
  });
});
