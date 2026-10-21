// Settings → Account: who's signed in, their plan and credits this month, what
// is left on their AI subscriptions, and signing out. The month's usage in
// detail stays on the Usage page; this links to it.

import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, GaugeIcon, LogOutIcon, UserIcon } from "lucide-react";

import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  scrollToSettingsTarget,
} from "../components/settings/settingsLayout";
import { searchableSetting } from "../components/settings/settingsSearch";
import { Button } from "../components/ui/button";
import { AldoWorkspaceUsageSection } from "../components/usage/AldoWorkspaceUsage";
import { useAldoWorkspaceUsage } from "../state/aldoWorkspaceUsage";
import { AldoAvatar, profileName, useAldoProfile } from "./AldoAccountMenu";
import { AldoProviderLimitsSection, useAldoProviderLimits } from "./AldoProviderLimits";
import { AldoPlanEndedBanner } from "./AldoSettingsHome";
import { aldoEndedPlan } from "./settingsHome.logic";

export function AldoAccountPage() {
  const profile = useAldoProfile();
  const workspace = useAldoWorkspaceUsage();
  const limits = useAldoProviderLimits();
  const manage = profile ? (
    <Button render={<a href={profile.manageUrl} />} size="sm" variant="outline">
      Manage
      <ChevronRightIcon className="size-3.5" aria-hidden />
    </Button>
  ) : null;
  const ended = aldoEndedPlan(
    workspace.state.status === "unavailable" ? null : workspace.state.usage,
  );
  return (
    <SettingsPageContainer>
      {ended ? (
        <AldoPlanEndedBanner
          plan={ended}
          onChoose={() => scrollToSettingsTarget("aldo-plan-heading", { highlight: false })}
        />
      ) : null}
      <SettingsSection id="aldo-account" title="Profile" icon={<UserIcon className="size-4" />}>
        <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
          <AldoAvatar profile={profile} className="size-10" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {profile === undefined ? "…" : profileName(profile)}
            </p>
            {profile?.name ? (
              <p className="truncate text-muted-foreground text-xs">{profile.email}</p>
            ) : null}
          </div>
        </div>
        {profile ? (
          <SettingsRow
            title="Name, email and password"
            description="Your sign-in: your name and picture, email, password, two-step verification and the devices you're signed in on."
            control={manage}
          />
        ) : null}
      </SettingsSection>
      {workspace.state.status === "unavailable" ? null : (
        <SettingsSection id="aldo-plan" title="Plan and credits" hideTitle>
          <div className="flex flex-col gap-6 px-3 py-4 sm:px-4">
            <AldoWorkspaceUsageSection
              title="Credits"
              state={workspace.state}
              onChanged={workspace.refresh}
            />
            <Button
              render={<Link to="/usage" />}
              size="xs"
              variant="ghost"
              className="-mt-3 self-start"
            >
              <GaugeIcon className="size-3.5" aria-hidden />
              All usage
              <ChevronRightIcon className="size-3.5" aria-hidden />
            </Button>
          </div>
        </SettingsSection>
      )}
      {limits.state.status === "unavailable" ? null : (
        <SettingsSection id="aldo-subscription-limits" title="Plan limits" hideTitle>
          <div className="px-3 py-4 sm:px-4">
            <AldoProviderLimitsSection state={limits.state} />
          </div>
        </SettingsSection>
      )}
      {profile ? (
        <SettingsSection title="This device" icon={<LogOutIcon className="size-4" />}>
          <SettingsRow
            {...searchableSetting("aldo-sign-out")}
            description="Signs you out of Aldo in this browser. Your threads keep running."
            control={
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.location.assign(profile.signOutUrl)}
              >
                Sign out
              </Button>
            }
          />
        </SettingsSection>
      ) : null}
    </SettingsPageContainer>
  );
}
