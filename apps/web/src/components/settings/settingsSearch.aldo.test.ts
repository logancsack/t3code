import { describe, expect, it, vi } from "vite-plus/test";

const mode = vi.hoisted(() => ({ cloud: true }));
vi.mock("../../aldo/api", () => ({
  get isAldoCloud() {
    return mode.cloud;
  },
}));

import {
  filterAvailableSettingsSearchItems,
  getSettingsSearchTargetScope,
  searchSettings,
  type SettingsSearchAvailability,
} from "./settingsSearch";

const availability: SettingsSearchAvailability = {
  hasCloudPublicConfig: false,
  hasEnvironment: false,
  hasProviderSettingsEnvironment: false,
  hasMacProviderSettingsEnvironment: false,
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
      { id: "aldo-phone", title: "Text and call Aldo", to: "/settings/phone" },
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

describe("Aldo Link settings search", () => {
  it("finds the Link wallet row by what people call it", () => {
    const items = filterAvailableSettingsSearchItems(availability);
    for (const query of ["link", "wallet", "payments"]) {
      expect(searchSettings(query, items)[0]).toMatchObject({
        id: "aldo-integration-link",
        to: "/settings/connections",
      });
    }
  });
});

describe("Aldo agent inbox settings search", () => {
  it.each([undefined, false])("hides the inbox until Aldo has inboxes (%s)", (available) => {
    const items = filterAvailableSettingsSearchItems(
      available === undefined ? availability : { ...availability, hasAldoAgentInbox: available },
    );
    expect(items.some((item) => item.id === "aldo-agent-inbox")).toBe(false);
  });

  it("finds the agent inbox row by its address and its sender name", () => {
    const items = filterAvailableSettingsSearchItems({ ...availability, hasAldoAgentInbox: true });
    for (const query of ["agent inbox", "sender name", "email address"]) {
      expect(searchSettings(query, items)[0]).toMatchObject({
        id: "aldo-agent-inbox",
        to: "/settings/agents",
      });
    }
  });
});

describe("Aldo simple mode settings search", () => {
  it("finds simple mode by what people call it", () => {
    const items = filterAvailableSettingsSearchItems(availability);
    for (const query of ["simple", "rail", "hide threads"]) {
      expect(searchSettings(query, items)[0]).toMatchObject({
        id: "aldo-simple-mode",
        to: "/settings/general",
      });
    }
  });

  it("is only in Aldo cloud mode", () => {
    mode.cloud = false;
    try {
      const items = filterAvailableSettingsSearchItems(availability);
      expect(items.some((item) => item.id === "aldo-simple-mode")).toBe(false);
    } finally {
      mode.cloud = true;
    }
  });
});

describe("Aldo hides T3 settings it doesn't show", () => {
  const everywhere: SettingsSearchAvailability = {
    ...availability,
    hasEnvironment: true,
    hasProviderSettingsEnvironment: true,
    hasMacProviderSettingsEnvironment: true,
    hasThreadAutoSettlement: true,
  };
  const ids = (items: ReadonlyArray<{ readonly id: string }>) => items.map((item) => item.id);

  it("leaves out rows Aldo doesn't render, and keeps the licenses", () => {
    const items = ids(filterAvailableSettingsSearchItems(everywhere));
    for (const id of [
      "thread-notifications",
      "in-app-notifications",
      "follow-up-behavior",
      "provider-update-checks",
      "diagnostics",
      "new-threads",
      "worktree-submodules",
      "start-from-origin",
      "add-project-starts-in",
    ]) {
      expect(items).not.toContain(id);
    }
    expect(items).toContain("open-source-licenses");
    expect(items).toContain("hide-whitespace-changes");
    expect(items).toContain("default-model");
  });

  it("leaves out the SnapShots and Storage pages", () => {
    const items = filterAvailableSettingsSearchItems(everywhere);
    expect(
      items.filter((item) => item.to === "/settings/snap-shot" || item.to === "/settings/storage"),
    ).toEqual([]);
    expect(searchSettings("snapshots", items)).toEqual([]);
    expect(searchSettings("worktree cleanup", items)).toEqual([]);
  });

  it("leads T3's pages Aldo moved to where they are now", () => {
    const items = filterAvailableSettingsSearchItems(everywhere);
    const moved = new Set<string>([
      "/settings/providers",
      "/settings/integrations",
      "/settings/source-control",
      "/settings/shared",
      "/settings/environments",
    ]);
    expect(ids(items.filter((item) => moved.has(item.to)))).toEqual([]);
    expect(items.find((item) => item.id === "providers")).toMatchObject({
      to: "/settings/agents",
    });
    expect(items.find((item) => item.id === "source-control")).toMatchObject({
      to: "/settings/connections",
    });
    expect(items.find((item) => item.id === "default-permissions")).toMatchObject({
      to: "/settings/permissions",
      title: "Access",
    });
  });

  it("keeps only Aldo's own rows on its Connections page", () => {
    const items = filterAvailableSettingsSearchItems(everywhere);
    const connections = items.filter(
      (item) => item.to === "/settings/connections" && item.id !== "source-control",
    );
    expect(connections.length).toBeGreaterThan(0);
    expect(connections.every((item) => item.id.startsWith("aldo-"))).toBe(true);
  });

  it("finds Git hosts by the hosts Aldo supports, not Forgejo or Gitea", () => {
    const items = filterAvailableSettingsSearchItems(everywhere);
    expect(searchSettings("forgejo", items)).toEqual([]);
    expect(searchSettings("gitea", items)).toEqual([]);
    expect(searchSettings("bitbucket", items)).toMatchObject([{ id: "source-control" }]);
  });

  it("opens Git hosts at any selection", () => {
    expect(getSettingsSearchTargetScope("source-control")?.scope).toBeNull();
  });

  it("keeps T3's rows and pages outside Aldo cloud mode", () => {
    mode.cloud = false;
    try {
      const items = ids(filterAvailableSettingsSearchItems(everywhere));
      for (const id of [
        "thread-notifications",
        "follow-up-behavior",
        "provider-update-checks",
        "diagnostics",
        "start-from-origin",
        "snap-shot-enabled",
        "storage-worktrees",
        "usage-providers",
        "git-fetch-interval",
      ]) {
        expect(items).toContain(id);
      }
    } finally {
      mode.cloud = true;
    }
  });
});

describe("Aldo's own notifications and hidden shortcuts in settings search", () => {
  it("finds Aldo's notification rows in place of T3's", () => {
    const items = filterAvailableSettingsSearchItems(availability);
    expect(searchSettings("notifications", items).map((item) => item.id)).toContain(
      "aldo-notifications",
    );
    expect(searchSettings("chime", items)[0]).toMatchObject({
      id: "aldo-notification-sound",
      to: "/settings/notifications",
    });
    expect(items.some((item) => item.id === "thread-notifications")).toBe(false);
  });

  it("leaves out the shortcut to Usage's Limits tab, which Aldo doesn't show", () => {
    const items = filterAvailableSettingsSearchItems(availability);
    expect(items.some((item) => item.id === "keybinding-usage.limits")).toBe(false);
    expect(items.some((item) => item.id === "keybinding-usage.cost")).toBe(true);
  });
});
