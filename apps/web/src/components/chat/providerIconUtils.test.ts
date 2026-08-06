import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { MuseCodeIcon } from "../Icons";
import { AVAILABLE_PROVIDER_OPTIONS, PROVIDER_ICON_BY_PROVIDER } from "./providerIconUtils";

describe("Muse Code provider presentation", () => {
  const muse = ProviderDriverKind.make("muse");

  it("appears as a selectable new provider", () => {
    expect(AVAILABLE_PROVIDER_OPTIONS).toContainEqual({
      value: muse,
      label: "Muse Code",
      available: true,
      pickerSidebarBadge: "new",
    });
  });

  it("uses the Meta brand icon", () => {
    expect(PROVIDER_ICON_BY_PROVIDER[muse]).toBe(MuseCodeIcon);
  });
});
