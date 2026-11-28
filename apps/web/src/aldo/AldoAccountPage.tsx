// Settings → Account & billing: profile, sign-in & security, plan and credits,
// monthly extra usage cap, connected AI subscription quotas, Windows & GPU
// computers, and signing out.

import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, GaugeIcon, LogOutIcon, MonitorIcon, UserIcon } from "lucide-react";
import { useState } from "react";

import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  scrollToSettingsTarget,
} from "../components/settings/settingsLayout";
import { searchableSetting } from "../components/settings/settingsSearch";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Button } from "../components/ui/button";
import { toastManager } from "../components/ui/toast";
import {
  AldoExtraUsageCapRow,
  AldoWorkspaceUsageSection,
} from "../components/usage/AldoWorkspaceUsage";
import {
  aldoWindowsDiskCopy,
  formatCents,
  formatCredits,
} from "../components/usage/aldoWorkspaceUsageView";
import {
  useAldoWorkspaceUsage,
  type AldoActiveComputer,
  type AldoWindowsDisk,
  type AldoWorkspaceUsage,
  type AldoWorkspaceUsageState,
} from "../state/aldoWorkspaceUsage";
import { deleteAldoWindowsDisk } from "./accountApi";
import { AldoAvatar, profileName, useAldoProfile } from "./AldoAccountMenu";
import { AldoProviderLimitsSection, useAldoProviderLimits } from "./AldoProviderLimits";
import { AldoPlanEndedBanner } from "./AldoSettingsHome";
import { aldoEndedPlan } from "./settingsHome.logic";
import { stopAldoComputer } from "./workspaceApi";

function accountManageHref(url: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}from=settings`;
}

function LegacyWindowsDiskRow(props: {
  readonly disk: AldoWindowsDisk;
  readonly status: AldoWorkspaceUsageState["status"];
  readonly onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const message = await deleteAldoWindowsDisk();
      setOpen(false);
      toastManager.add({ type: "success", title: "Windows computer’s disk", description: message });
      props.onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SettingsRow
        title="Windows computer disk"
        description={aldoWindowsDiskCopy(props.disk)}
        inline
        control={
          <Button
            size="sm"
            variant="outline"
            disabled={props.status !== "ready" || busy}
            onClick={() => {
              setError(null);
              setOpen(true);
            }}
          >
            Delete
          </Button>
        }
      />
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !busy) setOpen(false);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your Windows computer’s disk?</AlertDialogTitle>
            <AlertDialogDescription>
              Its files, apps and Office sign-in go; it starts fresh next time.
            </AlertDialogDescription>
            {error ? (
              <p className="text-sm text-destructive-foreground" role="alert">
                {error}
              </p>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />} disabled={busy}>
              Cancel
            </AlertDialogClose>
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => void remove()}>
              {busy ? "Deleting…" : "Delete disk"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}

function ComputersSection(props: {
  readonly usage: AldoWorkspaceUsage;
  readonly status: AldoWorkspaceUsageState["status"];
  readonly onChanged: () => void;
}) {
  const { usage } = props;
  const windows = usage.computers?.windows ?? usage.windows ?? null;
  const gpu = usage.computers?.gpu ?? null;
  const active = usage.computers?.active ?? [];
  const [stopping, setStopping] = useState<string | null>(null);

  if (!windows && !usage.windowsDisk && !gpu?.configured && active.length === 0) return null;

  const stop = async (computer: AldoActiveComputer, key: string) => {
    if (!computer.environmentId) return;
    setStopping(key);
    try {
      const message = await stopAldoComputer(
        computer.environmentId,
        computer.kind,
        computer.t3ThreadId,
      );
      toastManager.add({
        type: "success",
        title: computer.kind === "gpu" ? "GPU computer stopped" : "Windows computer stopped",
        description: message,
      });
      props.onChanged();
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Couldn’t stop computer",
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setStopping(null);
    }
  };

  const activeWindows = active.filter((item) => item.kind === "windows");
  const activeGpu = active.filter((item) => item.kind === "gpu");

  return (
    <SettingsSection
      id="aldo-computers"
      title="Computers"
      icon={<MonitorIcon className="size-4" />}
    >
      {windows ? (
        <SettingsRow
          title="Windows computers"
          description={
            usage.metered
              ? `${formatCredits(windows.creditsPerHour)} credits/hour while running (${formatCents(Math.round(windows.extraHourlyUsd * 100))}/hour within your extra usage cap). Up to ${windows.concurrentLimit} at once; each thread starts fresh and is deleted after use.`
              : `Up to ${windows.concurrentLimit} at once. Your complimentary account isn’t billed.`
          }
          status={
            activeWindows.length > 0
              ? `${activeWindows.length} running now`
              : "Starts only when you approve an agent’s request"
          }
        />
      ) : null}
      {usage.windowsDisk ? (
        <LegacyWindowsDiskRow
          disk={usage.windowsDisk}
          status={props.status}
          onChanged={props.onChanged}
        />
      ) : null}
      {gpu?.configured ? (
        <SettingsRow
          title="GPU computers"
          description={
            usage.metered
              ? `${formatCredits(gpu.creditsPerHour)} credits/hour while running. Stops automatically after ${gpu.idleMinutes} minutes idle.`
              : `Stops automatically after ${gpu.idleMinutes} minutes idle. Your complimentary account isn’t billed.`
          }
          status={
            activeGpu.length > 0
              ? `${activeGpu.length} running now`
              : "Starts only when you approve an agent’s request"
          }
        />
      ) : null}
      {active.map((computer, index) => {
        const key = `${computer.kind}:${computer.environmentId ?? "none"}:${computer.t3ThreadId ?? index}`;
        return (
          <SettingsRow
            key={key}
            title={computer.kind === "gpu" ? "Running GPU computer" : "Running Windows computer"}
            description={`Status: ${computer.status}`}
            inline
            control={
              computer.environmentId ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={stopping !== null}
                  onClick={() => void stop(computer, key)}
                >
                  {stopping === key ? "Stopping…" : "Stop"}
                </Button>
              ) : undefined
            }
          />
        );
      })}
    </SettingsSection>
  );
}

export function AldoAccountPage() {
  const profile = useAldoProfile();
  const workspace = useAldoWorkspaceUsage();
  const limits = useAldoProviderLimits();
  const manage = profile ? (
    <Button render={<a href={accountManageHref(profile.manageUrl)} />} size="sm" variant="outline">
      Manage
      <ChevronRightIcon className="size-3.5" aria-hidden />
    </Button>
  ) : null;
  const usage = workspace.state.status === "unavailable" ? null : workspace.state.usage;
  const ended = aldoEndedPlan(usage);

  // Only show connected 3rd-party AI subscription quotas here; Aldo's own credits are right above.
  const externalProviders =
    limits.state.status === "ready"
      ? limits.state.providers.filter((provider) => provider.id !== "aldo")
      : limits.state.status === "unavailable"
        ? null
        : (limits.state.providers?.filter((provider) => provider.id !== "aldo") ?? null);
  const showSubscriptionQuotas =
    limits.state.status !== "unavailable" &&
    (limits.state.status === "loading" ||
      limits.state.status === "error" ||
      (externalProviders !== null && externalProviders.length > 0));

  const externalLimitsState =
    limits.state.status === "unavailable"
      ? limits.state
      : limits.state.status === "ready"
        ? { ...limits.state, providers: externalProviders ?? [] }
        : { ...limits.state, providers: externalProviders };

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
            title="Sign-in, security and account"
            description="Your name, email, password, two-step verification, active devices and deleting your account."
            inline
            control={manage}
          />
        ) : null}
      </SettingsSection>
      {workspace.state.status === "unavailable" ? null : (
        <SettingsSection
          id="aldo-plan"
          title="Plan and credits"
          headerAction={
            <Button render={<Link to="/usage" />} size="xs" variant="ghost">
              <GaugeIcon className="size-3.5" aria-hidden />
              All usage
              <ChevronRightIcon className="size-3.5" aria-hidden />
            </Button>
          }
        >
          <div className="flex flex-col gap-6 px-3 py-4 sm:px-4">
            <AldoWorkspaceUsageSection
              title="Credits"
              hideHeaderLimit
              state={workspace.state}
              onChanged={workspace.refresh}
            />
          </div>
          {usage?.bill && !ended ? (
            <AldoExtraUsageCapRow usage={usage} onChanged={workspace.refresh} />
          ) : null}
        </SettingsSection>
      )}
      {showSubscriptionQuotas ? (
        <SettingsSection id="aldo-subscription-limits" title="AI subscription quotas">
          <div className="px-3 py-4 sm:px-4">
            <AldoProviderLimitsSection hideHeading state={externalLimitsState} />
          </div>
        </SettingsSection>
      ) : null}
      {usage ? (
        <ComputersSection
          usage={usage}
          status={workspace.state.status}
          onChanged={workspace.refresh}
        />
      ) : null}
      {profile ? (
        <SettingsSection title="This device" icon={<LogOutIcon className="size-4" />}>
          <SettingsRow
            {...searchableSetting("aldo-sign-out")}
            description="Signs you out of Aldo in this browser. Your threads keep running."
            inline
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
