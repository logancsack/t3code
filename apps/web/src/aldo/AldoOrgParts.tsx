// What Settings → Organization and Members share (organization.logic.ts):
// the organization once it's loaded, a change and Aldo's refusal of it, the
// rows and tiles both pages use, and a yes before a change to the user's own
// place.

import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { SettingsSection } from "../components/settings/settingsLayout";
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
import { cn } from "../lib/utils";
import { aldoOrgInitials, type AldoOrg } from "./organization.logic";
import { settingsOrg } from "./settingsData";
import { useSettingsResource } from "./settingsResource";

export type OrgAnswer = { readonly org: AldoOrg | null; readonly link: string | null };

const messageOf = (cause: unknown) =>
  cause instanceof Error && cause.message ? cause.message : "Something went wrong. Try again.";

/**
 * The organization for a page, or null while it loads or after it fails (with
 * Try again). Out of it (left, removed, deleted), Settings has no page for it.
 */
export function useLoadedOrg(): { readonly org: AldoOrg | null; readonly fallback: ReactNode } {
  const navigate = useNavigate();
  const { data: org, error } = useSettingsResource(settingsOrg);
  useEffect(() => {
    if (org === null) void navigate({ to: "/settings", replace: true });
  }, [navigate, org]);
  if (org) return { org, fallback: null };
  const fallback =
    org === undefined && error ? (
      <SettingsSection title="Organization" hideTitle>
        <div className="flex flex-wrap items-center gap-3 px-3 py-3 sm:px-4">
          <p className="min-w-0 flex-1 text-destructive-foreground text-sm">
            Couldn’t load your organization.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void settingsOrg.refresh().catch(() => undefined)}
          >
            Try again
          </Button>
        </div>
      </SettingsSection>
    ) : null;
  return { org: null, fallback };
}

/** A change from one place: busy while it runs, and Aldo's refusal kept to show there. */
export function useOrgChange() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (work: () => Promise<OrgAnswer>): Promise<OrgAnswer | null> => {
    setBusy(true);
    setError(null);
    try {
      const answer = await work();
      settingsOrg.set(answer.org);
      return answer;
    } catch (cause) {
      setError(messageOf(cause));
      // Refused because it changed meanwhile (a role, a removal): show it as it is now.
      void settingsOrg.refresh().catch(() => undefined);
      return null;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run };
}

export function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-destructive-foreground text-sm">
      {error}
    </p>
  ) : null;
}

/** A person's or the organization's letters on a round tile. */
export function Initials({ of, className }: { of: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted font-semibold text-muted-foreground text-xs",
        className,
      )}
    >
      {aldoOrgInitials(of)}
    </span>
  );
}

/** A row that opens something when there's something to open: a title, its value, and a chevron. */
export function OpenRow(props: {
  leading?: ReactNode;
  title: ReactNode;
  value?: ReactNode;
  description?: ReactNode;
  onOpen: (() => void) | null;
  /** Off where something sits beside the row, such as a button. */
  chevron?: boolean;
  className?: string;
}) {
  const body = (
    <>
      {props.leading}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-foreground text-sm [overflow-wrap:anywhere]">{props.title}</span>
        {props.description ? (
          <span className="text-muted-foreground text-xs">{props.description}</span>
        ) : null}
      </span>
      {props.value ? (
        <span className="min-w-0 max-w-[55%] truncate text-muted-foreground text-sm">
          {props.value}
        </span>
      ) : null}
    </>
  );
  const row = cn(
    "flex min-h-12 w-full items-center gap-3 px-3 py-2.5 text-left sm:px-4",
    props.className,
  );
  if (!props.onOpen) return <div className={row}>{body}</div>;
  return (
    <button
      type="button"
      className={cn(
        row,
        "outline-none transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-accent/40 focus-visible:bg-accent/40 active:bg-accent/60",
      )}
      onClick={props.onOpen}
    >
      {body}
      {props.chevron === false ? null : (
        <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground/70" />
      )}
    </button>
  );
}

/** Makes a change to the user's own place and shows the organization as it is after it. */
export async function changeOwn(work: () => Promise<OrgAnswer>): Promise<void> {
  try {
    settingsOrg.set((await work()).org);
  } catch (cause) {
    void settingsOrg.refresh().catch(() => undefined);
    throw cause;
  }
}

/** A yes before a change to the user's own place: leaving, deleting. */
export function Confirm(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  action: string;
  onConfirm: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(open) => {
        if (busy) return;
        setError(null);
        props.onOpenChange(open);
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.description}</AlertDialogDescription>
          <ErrorLine error={error} />
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />} disabled={busy}>
            Cancel
          </AlertDialogClose>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              props
                .onConfirm()
                .then(
                  () => props.onOpenChange(false),
                  (cause: unknown) => setError(messageOf(cause)),
                )
                .finally(() => setBusy(false));
            }}
          >
            {props.action}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
