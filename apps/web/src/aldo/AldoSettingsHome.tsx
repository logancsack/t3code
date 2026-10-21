// Settings on a phone opens here, as a phone's own settings do: a search, the
// account, and each page in the nav's groups with a line on what's there now
// (settingsHome.logic.ts). A page opens over it, and its bar's Settings comes
// back. On a wider screen the nav is beside every page and this isn't shown.

import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, SearchIcon } from "lucide-react";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { SettingsGroup } from "../components/settings/SettingsGroup";
import { SettingsPageContainer } from "../components/settings/settingsLayout";
import { searchSettings, type SettingsPath } from "../components/settings/settingsSearch";
import { useAvailableSettingsSearchItems } from "../components/settings/useAvailableSettingsSearchItems";
import { Button } from "../components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../components/ui/input-group";
import { useTheme } from "../hooks/useTheme";
import { cn } from "../lib/utils";
import { AldoAvatar, profileName, useAldoProfile } from "./AldoAccountMenu";
import { AldoIconTile } from "./AldoBrandTile";
import { ALDO_SETTINGS_ICONS, useAldoConnectionsSummary } from "./AldoSettingsNav";
import { useAldoDeveloperTools } from "./developerTools";
import { aldoOffersItsModels, subscribeAldoEnvironments } from "./directory";
import { planRunning } from "./home.logic";
import { useAldoHomeRead, type AldoHomeFeed } from "./homeFeed";
import { aldoSettingsNav, aldoSettingsPage } from "./settings.logic";
import { settingsAccounts, settingsMemory, settingsPhone, settingsVault } from "./settingsData";
import {
  aldoAccountSummary,
  aldoAppearanceSummary,
  aldoEndedPlan,
  aldoMemorySummary,
  aldoModelsSummary,
  aldoPhoneSummary,
  aldoVaultSummary,
} from "./settingsHome.logic";
import { useSettingsResource } from "./settingsResource";
import { useAldoSimpleMode } from "./simpleMode";

/** The plan has ended: said first, with the way to choose one, on Account and the phone's list. */
export function AldoPlanEndedBanner(props: {
  readonly plan: string;
  readonly onChoose: () => void;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-warning/40 bg-warning/6 px-3 py-2.5 sm:px-4"
    >
      <p className="min-w-0 flex-1 text-foreground text-sm">
        Your {props.plan} plan has ended, so agents can’t start. Choose a plan to start again.
      </p>
      <Button size="sm" onClick={props.onChoose}>
        Choose a plan
      </Button>
    </div>
  );
}

/**
 * Whether agents run on Aldo's own models without a subscription: where this
 * Aldo offers them and the plan runs (Models shows them so). Undefined until
 * the plan is known.
 */
function useOwnModels(feed: AldoHomeFeed): boolean | undefined {
  const offered = useSyncExternalStore(subscribeAldoEnvironments, aldoOffersItsModels, () => false);
  if (!offered) return false;
  if (feed.home) return planRunning(feed.home.usage);
  return feed.supported === false || feed.error !== null ? true : undefined;
}

function useSummaries(
  feed: AldoHomeFeed,
): Partial<Record<SettingsPath, { readonly text: string; readonly attention?: boolean }>> {
  const ownModels = useOwnModels(feed);
  const accounts = useSettingsResource(settingsAccounts).data;
  const vault = useSettingsResource(settingsVault).data;
  const memory = useSettingsResource(settingsMemory).data;
  const phone = useSettingsResource(settingsPhone).data;
  const { appearanceMode } = useTheme();
  const simple = useAldoSimpleMode();
  const connections = useAldoConnectionsSummary();
  const entries: Array<[SettingsPath, string | null, boolean?]> = [
    ["/settings/agents", aldoModelsSummary(accounts, ownModels)],
    ["/settings/instructions", aldoMemorySummary(memory)],
    ["/settings/connections", connections?.text ?? null, connections?.broken === true],
    ["/settings/vault", aldoVaultSummary(vault)],
    ["/settings/appearance", aldoAppearanceSummary(appearanceMode, simple)],
    ["/settings/phone", aldoPhoneSummary(phone)],
  ];
  return Object.fromEntries(
    entries.flatMap(([to, text, attention]) =>
      text ? [[to, { text, ...(attention ? { attention } : {}) }]] : [],
    ),
  );
}

function ListRow(props: {
  readonly leading: ReactNode;
  readonly title: string;
  readonly summary?: { readonly text: string; readonly attention?: boolean } | undefined;
  readonly subtitle?: string | null;
  readonly onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left outline-none transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-accent/40 focus-visible:bg-accent/40 active:bg-accent/60"
      onClick={props.onOpen}
    >
      {props.leading}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-foreground text-sm">{props.title}</span>
        {props.subtitle ? (
          <span className="truncate text-muted-foreground text-xs">{props.subtitle}</span>
        ) : null}
      </span>
      {props.summary ? (
        <span
          className={cn(
            "flex min-w-0 max-w-[45%] items-center gap-1.5 text-sm",
            props.summary.attention ? "text-warning-foreground" : "text-muted-foreground",
          )}
        >
          {props.summary.attention ? (
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warning" />
          ) : null}
          <span className="truncate">{props.summary.text}</span>
        </span>
      ) : null}
      <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/70" />
    </button>
  );
}

export function AldoSettingsHome() {
  const navigate = useNavigate();
  const profile = useAldoProfile();
  const feed = useAldoHomeRead();
  const usage = feed.home?.usage ?? null;
  const nav = aldoSettingsNav({ developer: useAldoDeveloperTools() });
  const summaries = useSummaries(feed);
  const [query, setQuery] = useState("");
  const searchable = useAvailableSettingsSearchItems();
  const results = useMemo(() => searchSettings(query, searchable), [query, searchable]);
  const searching = query.trim() !== "";
  const ended = aldoEndedPlan(usage);

  const open = (to: SettingsPath, hash = "") =>
    void navigate({
      to,
      search: { project: undefined },
      hash,
      state: { aldoFromSettingsList: true, ...(hash ? { settingsTargetHighlight: true } : {}) },
      ...(hash ? { hashScrollIntoView: false } : {}),
    });

  return (
    <SettingsPageContainer className="gap-6">
      <h1 className="px-1 font-semibold text-2xl text-foreground tracking-tight">Settings</h1>
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          aria-label="Search settings"
          placeholder="Search settings"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </InputGroup>

      {searching ? (
        results.length === 0 ? (
          <p role="status" className="px-1 text-muted-foreground text-sm">
            No settings match “{query.trim()}”.
          </p>
        ) : (
          <SettingsGroup>
            {results.map((item) => (
              <ListRow
                key={item.id}
                leading={null}
                title={item.title}
                subtitle={aldoSettingsPage(item.to)?.title ?? null}
                onOpen={() => open(item.to, item.targetId ?? item.id)}
              />
            ))}
          </SettingsGroup>
        )
      ) : (
        <>
          {ended ? (
            <AldoPlanEndedBanner
              plan={ended}
              onChoose={() => open("/settings/account", "aldo-plan")}
            />
          ) : null}
          <SettingsGroup>
            <ListRow
              leading={<AldoAvatar profile={profile} className="size-9" />}
              title={profile === undefined ? "Account" : profileName(profile)}
              subtitle={aldoAccountSummary(usage) ?? "Your plan, credits and sign-in"}
              onOpen={() => open("/settings/account")}
            />
          </SettingsGroup>
          {nav.map((group) => (
            <section key={group.group} className="flex flex-col gap-1.5">
              <h2 className="px-1 text-muted-foreground text-xs">{group.group}</h2>
              <SettingsGroup>
                {group.items.map((item) => {
                  const Icon = ALDO_SETTINGS_ICONS[item.to];
                  return (
                    <ListRow
                      key={item.to}
                      leading={<AldoIconTile icon={Icon ? <Icon /> : null} />}
                      title={item.label}
                      summary={summaries[item.to]}
                      onOpen={() => open(item.to)}
                    />
                  );
                })}
              </SettingsGroup>
            </section>
          ))}
        </>
      )}
    </SettingsPageContainer>
  );
}
