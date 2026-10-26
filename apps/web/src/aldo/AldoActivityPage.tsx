// Settings → Activity (orgAdmin.logic.ts): each change to the organization and
// what its admins did, newest first, under their days. Owners and admins read
// all of it, or one person's; a member reads what they did and what was done
// to their work.

import { useNavigate } from "@tanstack/react-router";
import { TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { SettingsSection } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { aldoOrgAdmin } from "./accountApi";
import { useLoadedOrg } from "./AldoOrgParts";
import {
  aldoActivityDays,
  aldoActivityNote,
  aldoActivitySentence,
  aldoClock,
  type AldoActivityLine,
} from "./orgAdmin.logic";
import { aldoOrgManages, type AldoOrg } from "./organization.logic";

const EVERYONE = "everyone";

const messageOf = (cause: unknown) =>
  cause instanceof Error && cause.message ? cause.message : "Something went wrong. Try again.";

export function AldoActivityPage({ person }: { person: string | null }) {
  const { org, fallback } = useLoadedOrg();
  if (!org) return fallback;
  const manages = aldoOrgManages(org);
  // A member reads their own, whatever the address says.
  return (
    <Activity key={manages ? (person ?? "") : org.you} org={org} person={manages ? person : null} />
  );
}

type Page = { lines: ReadonlyArray<AldoActivityLine>; more: boolean };

function Activity({ org, person }: { org: AldoOrg; person: string | null }) {
  const navigate = useNavigate();
  const manages = aldoOrgManages(org);
  const [page, setPage] = useState<Page | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pages = useRef(1);
  const ticket = useRef(0);

  const first = useCallback(async () => {
    const mine = ++ticket.current;
    try {
      const next = await aldoOrgAdmin.activity({ person });
      if (mine !== ticket.current) return;
      pages.current = 1;
      setPage(next);
      setError(null);
    } catch (cause) {
      if (mine === ticket.current) setError(messageOf(cause));
    }
  }, [person]);

  useEffect(() => {
    void first();
    // New lines on coming back, unless older pages are open below.
    const onFocus = () => pages.current === 1 && void first();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      ticket.current++;
    };
  }, [first]);

  const more = () => {
    const last = page?.lines.at(-1);
    if (!page || !last) return;
    setBusy(true);
    const mine = ++ticket.current;
    aldoOrgAdmin
      .activity({ person, before: last.id })
      .then(
        (next) => {
          if (mine !== ticket.current || !next) return;
          pages.current++;
          setPage({ lines: [...page.lines, ...next.lines], more: next.more });
          setError(null);
        },
        (cause: unknown) => mine === ticket.current && setError(messageOf(cause)),
      )
      .finally(() => setBusy(false));
  };

  const people = [...org.members].sort((a, b) =>
    a.id === org.you ? -1 : b.id === org.you ? 1 : a.email.localeCompare(b.email),
  );
  const chosen = person ? people.find((m) => m.id === person) : null;
  const filter = manages ? (
    <Select
      value={person ?? EVERYONE}
      onValueChange={(value) => {
        if (typeof value !== "string" || value === (person ?? EVERYONE)) return;
        void navigate({
          to: "/settings/activity",
          search: value === EVERYONE ? {} : { person: value },
          replace: true,
        });
      }}
    >
      <SelectTrigger size="sm" className="w-44 max-w-full" aria-label="Whose activity">
        <SelectValue>
          {chosen
            ? chosen.id === org.you
              ? "You"
              : chosen.email
            : person
              ? "Someone who left"
              : "Everyone"}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        <SelectItem hideIndicator value={EVERYONE}>
          Everyone
        </SelectItem>
        {people.map((m) => (
          <SelectItem hideIndicator key={m.id} value={m.id}>
            {m.id === org.you ? "You" : m.email}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  ) : null;

  if (page === undefined) {
    return error ? (
      <SettingsSection title="Activity" hideTitle>
        <div className="flex flex-wrap items-center gap-3 px-3 py-3 sm:px-4">
          <p className="min-w-0 flex-1 text-destructive-foreground text-sm">{error}</p>
          <Button size="sm" variant="outline" onClick={() => void first()}>
            Try again
          </Button>
        </div>
      </SettingsSection>
    ) : null;
  }
  if (page === null) {
    return (
      <p className="px-1 text-muted-foreground text-sm">
        Activity isn’t available for {org.name} yet.
      </p>
    );
  }

  const days = aldoActivityDays(page.lines);
  return (
    <>
      {filter ? <div className="flex justify-end">{filter}</div> : null}
      {days.length ? null : (
        <p className="rounded-xl border border-border/60 bg-card/40 px-3 py-3.5 text-muted-foreground text-sm sm:px-4">
          {manages
            ? person
              ? "Nothing yet for them. Invites, role changes, stops, pauses and limits show here as they happen."
              : "Nothing yet. Invites, role changes, stops, pauses and limits show here as they happen."
            : "Nothing yet. When an admin changes your role, limit or work, it shows here, with who did it."}
        </p>
      )}
      {days.map((d) => (
        <SettingsSection key={d.day} title={d.day}>
          {d.lines.map((line) => (
            <ActivityRow key={line.id} line={line} you={org.you} />
          ))}
        </SettingsSection>
      ))}
      {error ? (
        <p role="alert" className="px-1 text-destructive-foreground text-sm">
          {error}
        </p>
      ) : null}
      {page.more ? (
        <div className="flex justify-center">
          <Button size="sm" variant="outline" disabled={busy} onClick={more}>
            Show older
          </Button>
        </div>
      ) : null}
    </>
  );
}

function ActivityRow({ line, you }: { line: AldoActivityLine; you: string }) {
  const note = aldoActivityNote(line);
  return (
    <div className="flex min-h-12 items-start gap-3 px-3 py-2.5 sm:px-4">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-foreground text-sm [overflow-wrap:anywhere]">
          {aldoActivitySentence(line, you)}
        </span>
        {note ? (
          <span className="text-muted-foreground text-xs [overflow-wrap:anywhere]">{note}</span>
        ) : null}
        {line.outcome ? (
          <span className="flex items-start gap-1.5 text-warning-foreground text-xs">
            <TriangleAlertIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            {line.outcome}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 pt-px text-muted-foreground text-xs tabular-nums">
        {aldoClock(line.at)}
      </span>
    </div>
  );
}
