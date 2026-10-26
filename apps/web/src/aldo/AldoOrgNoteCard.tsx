// What an organization's admins did to the user's work, said in the thread it
// touched (orgAdmin.logic.ts): over the composer, a note that their work is
// paused, or that an admin stopped this thread's machines, with the note they
// left. A stop's note goes once the thread starts again. Read only for
// someone in an organization (every minute while the thread is in view), so
// anyone else asks Aldo nothing new.

import { PauseCircleIcon, PowerIcon } from "lucide-react";
import { useEffect } from "react";

import { useAldoProfile } from "./AldoAccountMenu";
import { aldoOrgNoteFor } from "./orgAdmin.logic";
import { settingsOrgNotes } from "./settingsData";
import { useSettingsResource } from "./settingsResource";

export function AldoOrgNoteCard({ environmentId }: { environmentId: string }) {
  const inOrg = Boolean(useAldoProfile()?.organization);
  const { data: notes } = useSettingsResource(settingsOrgNotes, inOrg);
  const note = inOrg ? aldoOrgNoteFor(notes, environmentId) : null;
  // Look again now and then while the thread is in view: an admin may stop or pause the
  // work from elsewhere, and a note goes once the thread starts or work resumes.
  useEffect(() => {
    if (!inOrg) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void settingsOrgNotes.load().catch(() => undefined);
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [inOrg]);
  if (!note) return null;
  const Icon = note.kind === "paused" ? PauseCircleIcon : PowerIcon;
  return (
    <div
      role="status"
      className="mb-2 flex items-start gap-2.5 rounded-xl border border-border/70 bg-muted/50 px-3 py-2.5 text-sm"
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 space-y-1">
        <p className="text-foreground [overflow-wrap:anywhere]">{note.text}</p>
        {note.quote ? (
          <p className="text-muted-foreground [overflow-wrap:anywhere]">{note.quote}</p>
        ) : null}
      </div>
    </div>
  );
}
