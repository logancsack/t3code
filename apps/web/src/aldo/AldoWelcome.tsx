// The welcome on a new account's first visit to Home (onboarding.logic.ts):
// who Aldo is in a line, an optional question about their first work, then
// optional doors to the real spending, inbox and mail settings. Finishing ends it; it never comes
// back once Aldo has kept the answer. Its chips (AldoInterestChips.tsx) change
// the answer in Settings → General too. Someone who came in on an
// organization's invite is told they're in it.

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { useAldoProfile } from "./AldoAccountMenu";
import { AldoInterestChips } from "./AldoInterestChips";
import { AldoFrame } from "./AldoFrame";
import { saveAldoOnboarding } from "./onboarding";
import { aldoFirstName, type AldoInterest } from "./onboarding.logic";
import { settingsOrg } from "./settingsData";
import { useSettingsResource } from "./settingsResource";
import { FOCUS, PRIMARY } from "./surface";

/** The welcome, over the whole page until it's answered or skipped. */
export function AldoWelcome() {
  const navigate = useNavigate();
  const profile = useAldoProfile();
  const first = aldoFirstName(profile?.name ?? null);
  const org = useSettingsResource(settingsOrg, true, false).data;
  const [picked, setPicked] = useState<ReadonlyArray<AldoInterest>>([]);
  const [setup, setSetup] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const titleId = setup ? "aldo-setup-title" : "aldo-welcome-title";
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>(`#${titleId}`)?.focus();
  }, [titleId]);
  const finish = async (to?: "/settings/permissions" | "/settings/connections", hash?: string) => {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    const saved = await saveAldoOnboarding(picked, { revert: true, waitForSave: true });
    if (!saved) {
      setSaving(false);
      setFailed(true);
      return;
    }
    if (to) void navigate({ to, ...(hash ? { hash } : {}) });
  };
  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby="aldo-welcome-lead"
      tabIndex={-1}
      className="fixed inset-0 z-50 overflow-y-auto bg-background outline-none"
    >
      <div className="flex min-h-full items-center justify-center px-6 py-12">
        <div className="flex w-full max-w-[560px] flex-col items-center text-center">
          <AldoFrame size={56} aware />
          <h1
            id={titleId}
            tabIndex={-1}
            className="mt-6 mb-2 font-semibold text-[28px] text-foreground leading-tight tracking-[-0.025em] outline-none sm:text-[30px]"
          >
            {setup
              ? "A few choices, if you like."
              : first
                ? `Welcome to Aldo, ${first}.`
                : "Welcome to Aldo."}
          </h1>
          <p
            id="aldo-welcome-lead"
            className="mb-8 max-w-[470px] text-[15px] text-muted-foreground leading-6"
          >
            {setup ? (
              "You can start work now, or set these up first. Each opens in Settings, where you can come back later."
            ) : (
              <>
                {org ? (
                  <>
                    You’re in <span className="font-medium text-foreground">{org.name}</span>.{" "}
                  </>
                ) : null}
                Hand it real work: research, decks, spreadsheets, videos, sites. It works on a
                computer of its own and keeps you posted.
              </>
            )}
          </p>
          {setup ? (
            <>
              <ul className="w-full divide-y divide-border text-left">
                {(
                  [
                    [
                      "Set spending limit",
                      "Choose when Aldo should ask about spending. Until then, the first paid step asks you.",
                      "/settings/permissions",
                      "",
                    ],
                    [
                      "Choose agents’ email",
                      "An address your agents share for sign-ups and codes. Your own mail stays separate.",
                      "/settings/connections",
                      "aldo-agent-inbox",
                    ],
                    [
                      "Connect my mail",
                      "Connect Google or Microsoft for your mail and drafts. Nothing connects without your sign-in.",
                      "/settings/connections",
                      "",
                    ],
                  ] as const
                ).map(([label, description, to, hash]) => (
                  <li key={label}>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void finish(to, hash)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-3 py-4 text-left transition-colors hover:bg-foreground/[0.05] disabled:opacity-50",
                        FOCUS,
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-foreground text-sm">{label}</span>
                        <span className="mt-1 block text-muted-foreground text-sm leading-5">
                          {description}
                        </span>
                      </span>
                      <ChevronRightIcon
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    </button>
                  </li>
                ))}
              </ul>
              {failed ? (
                <p role="alert" className="mt-4 text-destructive-foreground text-sm">
                  Couldn’t save your choices. Try again by selecting an option or Skip for now.
                </p>
              ) : null}
              <div className="mt-6 flex flex-col items-center gap-2" aria-busy={saving}>
                <button
                  type="button"
                  disabled={saving}
                  className={cn(PRIMARY, "min-w-[220px]")}
                  onClick={() => void finish()}
                >
                  {saving ? "Saving…" : "Skip for now"}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  className={cn(
                    "min-h-11 rounded-full px-3 text-sm text-muted-foreground hover:text-foreground",
                    FOCUS,
                  )}
                  onClick={() => {
                    setSetup(false);
                    setFailed(false);
                  }}
                >
                  Back
                </button>
              </div>
            </>
          ) : (
            <>
              <p id="aldo-welcome-question" className="mb-3 font-medium text-foreground text-sm">
                What will you hand it first? Pick any.
              </p>
              <AldoInterestChips
                labelledBy="aldo-welcome-question"
                className="justify-center"
                value={picked}
                onChange={setPicked}
              />
              <div className="mt-8 flex flex-col items-center gap-2">
                <button
                  type="button"
                  className={cn(PRIMARY, "min-w-[220px]")}
                  onClick={() => setSetup(true)}
                >
                  Continue
                </button>
                <button
                  type="button"
                  className={cn(
                    "min-h-11 rounded-full px-3 py-1.5 text-[13.5px] text-muted-foreground transition-colors hover:text-foreground",
                    FOCUS,
                  )}
                  onClick={() => {
                    setPicked([]);
                    setSetup(true);
                  }}
                >
                  Skip
                </button>
              </div>
              <p className="mt-4 text-muted-foreground text-xs leading-5">
                Picking Code and apps adds the developer tools. You can change this anytime in
                Settings → About you.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
