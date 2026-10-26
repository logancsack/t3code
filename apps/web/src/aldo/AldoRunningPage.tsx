// Settings → Members → Running now (orgAdmin.logic.ts), for owners and admins:
// every machine running in the organization's threads, priciest first, each
// thread with its Stop, and stopping all of them at once. Owners' threads
// stop only for owners; Aldo says so when it refuses.

import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { SettingsSection } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import { aldoOrgAdmin } from "./accountApi";
import { RunningRow, StopAllSheet, StopSheet, useOrgRead } from "./AldoOrgAdminParts";
import { useLoadedOrg } from "./AldoOrgParts";
import { aldoClock, aldoRunningLine, type AldoRunningThread } from "./orgAdmin.logic";
import { aldoOrgManages, type AldoOrg } from "./organization.logic";

export function AldoRunningPage() {
  const { org, fallback } = useLoadedOrg();
  const navigate = useNavigate();
  const manages = org ? aldoOrgManages(org) : null;
  useEffect(() => {
    if (manages === false) void navigate({ to: "/settings/members", replace: true });
  }, [manages, navigate]);
  if (!org) return fallback;
  if (!manages) return null;
  return <RunningNow org={org} />;
}

type Sheet =
  | { readonly kind: "stop"; readonly thread: AldoRunningThread }
  | { readonly kind: "all" };

function RunningNow({ org }: { org: AldoOrg }) {
  const { data, error, reload } = useOrgRead(aldoOrgAdmin.machines, 30_000);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const close = () => setSheet(null);
  const changed = () => void reload();

  if (data === undefined) {
    return error ? <TryAgain error={error} onRetry={changed} /> : null;
  }
  if (data === null) {
    return (
      <p className="px-1 text-muted-foreground text-sm">
        Running now isn’t available for {org.name} yet.
      </p>
    );
  }

  const threads = data.threads;
  const machines = threads.reduce((sum, t) => sum + t.machines.length, 0);
  const perHour = threads.reduce((sum, t) => sum + t.perHour, 0);
  const stoppable = threads.filter((t) => t.canStop);

  return (
    <>
      <SettingsSection
        title={aldoRunningLine({ machines, perHour })}
        headerAction={
          stoppable.length > 1 ? (
            <Button size="xs" variant="ghost" onClick={() => setSheet({ kind: "all" })}>
              Stop all {stoppable.length}
            </Button>
          ) : null
        }
      >
        {threads.length ? (
          threads.map((t) => (
            <RunningRow
              key={t.id}
              thread={t}
              whose
              you={org.you}
              onStop={(thread) => setSheet({ kind: "stop", thread })}
            />
          ))
        ) : (
          <p className="px-3 py-3 text-muted-foreground text-sm sm:px-4">
            No machines are running in {org.name}’s threads. They sleep when their work is done, so
            this is often empty.
          </p>
        )}
      </SettingsSection>
      <p className="px-1 text-muted-foreground text-xs">
        {threads.length > 1 ? "Most expensive first. " : ""}Updated {aldoClock(data.updatedAt)}.
        {error ? ` ${error}` : ""}
      </p>

      {sheet?.kind === "stop" ? (
        <StopSheet thread={sheet.thread} you={org.you} onClose={close} onStopped={changed} />
      ) : null}
      {sheet?.kind === "all" ? (
        <StopAllSheet threads={threads} onClose={close} onStopped={changed} />
      ) : null}
    </>
  );
}

function TryAgain({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <SettingsSection title="Running now" hideTitle>
      <div className="flex flex-wrap items-center gap-3 px-3 py-3 sm:px-4">
        <p className="min-w-0 flex-1 text-destructive-foreground text-sm">{error}</p>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </SettingsSection>
  );
}
