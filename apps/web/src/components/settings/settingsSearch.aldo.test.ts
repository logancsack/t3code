import { describe, expect, it, vi } from "vite-plus/test";

const mode = vi.hoisted(() => ({ cloud: true }));
vi.mock("../../aldo/cloud", () => ({
  get isAldoCloud() {
    return mode.cloud;
  },
}));

import {
  filterAvailableSettingsSearchItems,
  searchSettings,
  type SettingsSearchAvailability,
} from "./settingsSearch";

const availability: SettingsSearchAvailability = {
  hasCloudPublicConfig: false,
  hasPrimaryEnvironment: false,
  hasProviderSettingsEnvironment: false,
  canManageLocalBackend: false,
  isWslSettingsRowVisible: false,
  hasThreadAutoSettlement: false,
};

describe("Aldo phone settings search", () => {
  it.each([undefined, false])(
    "hides phone results until the API is supported (%s)",
    (supported) => {
      const items = filterAvailableSettingsSearchItems(
        supported === undefined ? availability : { ...availability, hasAldoPhoneApi: supported },
      );
      expect(searchSettings("sms", items)).toEqual([]);
      expect(items.some((item) => item.id === "aldo-phone")).toBe(false);
      expect(items.some((item) => item.id === "aldo-integration-microsoft")).toBe(true);
    },
  );

  it("offers the mounted phone section when the API exists, including before provider setup", () => {
    const items = filterAvailableSettingsSearchItems({ ...availability, hasAldoPhoneApi: true });
    expect(searchSettings("sms", items)).toMatchObject([
      { id: "aldo-phone", title: "Text and call Aldo", to: "/settings/integrations" },
    ]);
  });

  it("does not expose phone settings outside Aldo cloud mode", () => {
    mode.cloud = false;
    try {
      const items = filterAvailableSettingsSearchItems({ ...availability, hasAldoPhoneApi: true });
      expect(searchSettings("sms", items)).toEqual([]);
    } finally {
      mode.cloud = true;
    }
  });
});
