// Settings → General in Aldo: the few settings most people change on top
// (theme, layout, how quickly agents start), and T3's own rows folded under
// More settings, which a search for one of them opens.

import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, PaletteIcon, PanelLeftIcon, ZapIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  SettingsRow,
  SettingsSection,
  useSettingsSearchTargetId,
} from "../components/settings/settingsLayout";
import { searchableSetting } from "../components/settings/settingsSearch";
import { Button } from "../components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../components/ui/collapsible";
import { Switch } from "../components/ui/switch";
import { Toggle, ToggleGroup } from "../components/ui/toggle-group";
import { useTheme } from "../hooks/useTheme";
import { setAldoPreloadSettings, useAldoPreloadSettings } from "./preloadSettings";
import { setAldoSimpleMode, useAldoSimpleMode } from "./simpleMode";

export const ALDO_THEME_MODES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

/** Light, dark, or the device's: the same control in General and the account menu. */
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
  "aldo-theme",
  "aldo-customize-theme",
  "aldo-simple-mode",
  "send-shortcut",
  "aldo-preload",
  "about",
  "open-source-licenses",
  "aldo-keyboard-shortcuts",
]);

export function AldoGeneralBasics(props: { readonly sendShortcutRow: ReactNode }) {
  const simple = useAldoSimpleMode();
  const preload = useAldoPreloadSettings();
  return (
    <>
      <SettingsSection title="Appearance" icon={<PaletteIcon className="size-4" />}>
        <SettingsRow
          id="aldo-theme"
          title="Theme"
          description="Light, dark, or whichever this device uses."
          control={<AldoThemeToggle />}
        />
        <SettingsRow
          id="aldo-customize-theme"
          title="Themes and fonts"
          description="Pick a theme or make your own, and choose fonts."
          control={
            <Button render={<Link to="/settings/appearance" />} size="sm" variant="outline">
              Customize
            </Button>
          }
        />
      </SettingsSection>
      <SettingsSection title="Layout" icon={<PanelLeftIcon className="size-4" />}>
        <SettingsRow
          {...searchableSetting("aldo-simple-mode")}
          description="A narrow rail in place of the sidebar, with just Aldo, what needs you, and your Library. Only on this device."
          control={
            <Switch
              checked={simple}
              onCheckedChange={(checked) => setAldoSimpleMode(checked)}
              aria-label="Simple mode"
            />
          }
        />
        {props.sendShortcutRow}
      </SettingsSection>
      <SettingsSection title="Speed" icon={<ZapIcon className="size-4" />}>
        <SettingsRow
          {...searchableSetting("aldo-preload")}
          description="Start a new thread's computer as soon as the thread opens, and wake a thread's when you open it, so replies start without waiting. One you don't use goes back to sleep."
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
    </>
  );
}

/** The rest of General, folded: it opens for a search that leads into it. */
export function AldoGeneralMore(props: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const targetId = useSettingsSearchTargetId();
  // Unfold once per search jump, so the user can fold it again while the target is still set.
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (targetId === null) {
      openedFor.current = null;
      return;
    }
    if (ALDO_GENERAL_BASIC_IDS.has(targetId) || openedFor.current === targetId) return;
    openedFor.current = targetId;
    setOpen(true);
  }, [targetId]);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex min-h-8 w-full items-center gap-2 px-3 sm:px-4">
        <h2 className="text-sm font-normal text-foreground/70 transition-colors group-hover:text-foreground">
          More settings
        </h2>
        <ChevronRightIcon className="size-4 text-muted-foreground transition-transform duration-200 group-data-panel-open:rotate-90" />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="flex flex-col gap-8 pt-6">{props.children}</div>
      </CollapsiblePanel>
    </Collapsible>
  );
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
