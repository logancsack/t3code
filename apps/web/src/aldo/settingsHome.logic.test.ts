import { describe, expect, it } from "vite-plus/test";

import type { AldoApp, AldoIntegration, AldoVaultItem } from "./accountApi";
import type { AldoHomeUsage } from "./homeApi";
import {
  aldoAccountSummary,
  aldoConnectionsSummary,
  aldoEndedPlan,
  aldoModelsSummary,
  aldoPhoneSummary,
  aldoVaultSummary,
} from "./settingsHome.logic";

const account = (connected: boolean) => ({ connected, account: null, plan: null });

const integration = (name: string, connected: boolean, error: string | null = null) =>
  ({
    provider: name.toLowerCase(),
    name,
    available: true,
    connected,
    account: null,
    error,
  }) as AldoIntegration;

const app = (title: string, status: AldoApp["status"] = "connected"): AldoApp => ({
  id: title,
  name: title.toLowerCase(),
  title,
  url: "https://example.com/mcp",
  status,
  error: null,
});

const usage = (overrides: Partial<AldoHomeUsage>): AldoHomeUsage => ({
  configured: true,
  metered: true,
  plan: { id: "plus", name: "Plus", includedCredits: 3000 },
  period: { status: "active", start: "2026-10-01", end: "2026-11-01" },
  credits: { used: 475, included: 3000, authorized: 3000, remaining: 2525, projected: null },
  bill: null,
  alert: "",
  agents: { running: 0, limit: null },
  ...overrides,
});

describe("aldoModelsSummary", () => {
  it("says nothing before the accounts load", () => {
    expect(aldoModelsSummary(undefined)).toBeNull();
  });

  it("names the subscriptions that run agents, or Aldo's own models", () => {
    expect(aldoModelsSummary({ github: account(true) })).toBe("Aldo’s models");
    expect(aldoModelsSummary({ claude: account(true), codex: account(true) })).toBe(
      "Claude and ChatGPT",
    );
  });
});

describe("aldoConnectionsSummary", () => {
  const accounts = { github: account(true), claude: account(true) };

  it("waits for every source rather than count part of them", () => {
    expect(
      aldoConnectionsSummary({ accounts, integrations: undefined, apps: { apps: [] } }),
    ).toBeNull();
    expect(
      aldoConnectionsSummary({ accounts: undefined, integrations: [], apps: null }),
    ).toBeNull();
  });

  it("counts code hosts, accounts and apps, but not model subscriptions", () => {
    expect(
      aldoConnectionsSummary({
        accounts,
        integrations: [integration("Google", true), integration("Microsoft", false)],
        apps: { apps: [app("Notion")] },
      }),
    ).toEqual({ text: "3 connected", broken: false });
  });

  it("names the one that stopped working", () => {
    expect(
      aldoConnectionsSummary({
        accounts,
        integrations: [integration("Google", true, "invalid_grant")],
        apps: { apps: [app("Notion", "failed")] },
      }),
    ).toEqual({ text: "2 stopped working", broken: true });
    expect(
      aldoConnectionsSummary({
        accounts,
        integrations: null,
        apps: { apps: [app("Linear", "failed")] },
      }),
    ).toEqual({ text: "Linear stopped working", broken: true });
  });

  it("says none yet only once everything answered", () => {
    expect(aldoConnectionsSummary({ accounts: {}, integrations: null, apps: null })).toEqual({
      text: "None yet",
      broken: false,
    });
  });
});

describe("aldoVaultSummary", () => {
  const item = (kind: AldoVaultItem["kind"]) => ({ kind }) as AldoVaultItem;

  it("counts keys and logins", () => {
    expect(aldoVaultSummary(undefined)).toBeNull();
    expect(aldoVaultSummary([])).toBe("Empty");
    expect(aldoVaultSummary([item("request"), item("env"), item("login")])).toBe("2 keys, 1 login");
    expect(aldoVaultSummary([item("login"), item("login")])).toBe("2 logins");
  });
});

describe("aldoPhoneSummary", () => {
  it("shows the verified number, and nothing on an Aldo without phones", () => {
    expect(aldoPhoneSummary(null)).toBeNull();
    expect(aldoPhoneSummary({ available: false } as never)).toBeNull();
    expect(aldoPhoneSummary({ available: true, verified: false, phone: null } as never)).toBe(
      "Not set up",
    );
    expect(
      aldoPhoneSummary({ available: true, verified: true, phone: "+1 415 555 0100" } as never),
    ).toBe("+1 415 555 0100");
  });
});

describe("aldoAccountSummary", () => {
  it("gives the plan and what's left of it", () => {
    expect(aldoAccountSummary(usage({}))).toBe("Plus, 2,525 credits left");
    expect(aldoAccountSummary(usage({ metered: false }))).toBe("Plus");
  });

  it("says when the plan ended or its payment failed", () => {
    const ended = usage({ period: { status: "canceled", start: "", end: "" } });
    expect(aldoAccountSummary(ended)).toBe("Plus, plan ended");
    expect(aldoEndedPlan(ended)).toBe("Plus");
    expect(aldoEndedPlan(usage({}))).toBeNull();
    expect(aldoAccountSummary(usage({ period: { status: "past_due", start: "", end: "" } }))).toBe(
      "Plus, payment failed",
    );
  });

  it("says nothing without a plan", () => {
    expect(aldoAccountSummary(undefined)).toBeNull();
    expect(aldoAccountSummary(usage({ plan: null }))).toBeNull();
  });
});
