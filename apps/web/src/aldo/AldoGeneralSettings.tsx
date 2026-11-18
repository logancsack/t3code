// Settings → General in Aldo: the few settings most people change on top
// (how quickly agents start, how the composer sends, what they hand Aldo),
// and T3's own rows folded under More settings, which a search for one of
// them opens. Theme and layout are Appearance's.

import { Link } from "@tanstack/react-router";
import { HomeIcon, SendIcon, ZapIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { searchableSetting } from "../components/settings/settingsSearch";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { Toggle, ToggleGroup } from "../components/ui/toggle-group";
import { useTheme } from "../hooks/useTheme";
import { AldoInterestChips } from "./AldoInterestChips";
import { AldoSettingsFold } from "./AldoSettingsShell";
import { saveAldoOnboarding, useAldoOnboardingState } from "./onboarding";
import { setAldoPreloadSettings, useAldoPreloadSettings } from "./preloadSettings";
import { setAldoSimpleMode, useAldoSimpleMode } from "./simpleMode";

const ALDO_THEME_MODES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

/** Light, dark, or the device's, for the account menu. */
export function AldoThemeToggle(props: { readonly className?: string }) {
  const { appearanceMode, setAppearanceMode } = useTheme();
  return (
    <ToggleGroup
      aria-label="Theme"
      variant="segmented"
      {...(props.className ? { className: props.className } : {})}
      value={[appearanceMode]}
      onValueChange={(next) => {
        const mode = ALDO_THEME_MODES.find((entry) => entry.value === next[0])?.value;
        if (mode) setAppearanceMode(mode);
      }}
    >
      {ALDO_THEME_MODES.map((entry) => (
        <Toggle key={entry.value} value={entry.value}>
          {entry.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

/** General's rows above More settings: a search for one of them leaves it folded. */
const ALDO_GENERAL_BASIC_IDS: ReadonlySet<string> = new Set([
  "aldo-preload",
  "send-shortcut",
  "aldo-interests",
  "about",
  "open-source-licenses",
  "aldo-keyboard-shortcuts",
]);

export function AldoGeneralBasics(props: { readonly sendShortcutRow: ReactNode }) {
  const preload = useAldoPreloadSettings();
  return (
    <>
      <SettingsSection title="Threads" icon={<ZapIcon className="size-4" />}>
        <SettingsRow
          {...searchableSetting("aldo-preload")}
          description="Start a thread’s computer when you open the thread, so replies start without waiting. One you don’t use goes back to sleep."
          inline
          control={
            <Switch
              checked={preload.newThreads && preload.openedThreads}
              onCheckedChange={(checked) =>
                setAldoPreloadSettings({ newThreads: checked, openedThreads: checked })
              }
              aria-label="Have agents ready"
            />
          }
        />
      </SettingsSection>
      <SettingsSection title="Composer" icon={<SendIcon className="size-4" />}>
        {props.sendShortcutRow}
      </SettingsSection>
      <AldoInterestsSection />
    </>
  );
}

/** Settings → Appearance's Layout in Aldo: the simple rail or every thread. */
export function AldoLayoutRow() {
  const simple = useAldoSimpleMode();
  return (
    <SettingsRow
      {...searchableSetting("aldo-simple-mode")}
      description="Simple shows Aldo, what needs you and your Library. Full adds every thread and the developer tools."
      control={
        <ToggleGroup
          aria-label="Layout"
          variant="segmented"
          value={[simple ? "simple" : "full"]}
          onValueChange={(next) => {
            if (next[0] === "simple" || next[0] === "full") setAldoSimpleMode(next[0] === "simple");
          }}
        >
          <Toggle value="simple">Simple</Toggle>
          <Toggle value="full">Full</Toggle>
        </ToggleGroup>
      }
    />
  );
}

/** What they told the welcome, to change; only on an Aldo that keeps it. */
function AldoInterestsSection() {
  const onboarding = useAldoOnboardingState();
  const [failed, setFailed] = useState(false);
  if (!onboarding) return null;
  return (
    <SettingsSection title="Home" icon={<HomeIcon className="size-4" />}>
      <SettingsRow
        {...searchableSetting("aldo-interests")}
        description="Picks the ideas on Home. Code and apps, or a connected git host, adds the developer tools: pull requests, Code settings, the terminal and the diff."
        {...(failed ? { status: "Couldn’t save that. Try again." } : {})}
      >
        <AldoInterestChips
          label="What you hand Aldo"
          className="pt-1 pb-2.5"
          value={onboarding.interests ?? []}
          onChange={(next) => {
            setFailed(false);
            void saveAldoOnboarding(next, { revert: true }).then((saved) => setFailed(!saved));
          }}
        />
      </SettingsRow>
    </SettingsSection>
  );
}

/** The rest of General, folded: it opens for a search that leads into it. */
export function AldoGeneralMore(props: { readonly children: ReactNode }) {
  return (
    <AldoSettingsFold
      title="More settings"
      hint="The thread list, how replies show, confirmations"
      opensFor={opensGeneralMore}
    >
      {props.children}
    </AldoSettingsFold>
  );
}

function opensGeneralMore(targetId: string): boolean {
  return !ALDO_GENERAL_BASIC_IDS.has(targetId);
}

/** General's footer row in Aldo: its shortcuts, which have no entry of their own in the nav. */
export function AldoKeyboardShortcutsRow() {
  return (
    <SettingsRow
      id="aldo-keyboard-shortcuts"
      title="Keyboard shortcuts"
      description="See and change the keys for Aldo's commands."
      control={
        <Button render={<Link to="/settings/keybindings" />} size="sm" variant="outline">
          View shortcuts
        </Button>
      }
    />
  );
}
