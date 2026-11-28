// Shared Aldo pieces used in Appearance (layout toggle) and General (shortcuts row).

import { Link } from "@tanstack/react-router";

import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { searchableSetting } from "../components/settings/settingsSearch";
import { Button } from "../components/ui/button";
import { Toggle, ToggleGroup } from "../components/ui/toggle-group";
import { setAldoSimpleMode, useAldoSimpleMode } from "./simpleMode";

/** Settings → Appearance's Layout in Aldo: the simple rail or every thread. */
export function AldoLayoutSection() {
  const simple = useAldoSimpleMode();
  return (
    <SettingsSection title="Layout" hideTitle>
      <SettingsRow
        {...searchableSetting("aldo-simple-mode")}
        description="Simple shows Aldo, what needs you and your Library. Full adds every thread and the developer tools."
        control={
          <ToggleGroup
            aria-label="Layout"
            variant="segmented"
            value={[simple ? "simple" : "full"]}
            onValueChange={(next) => {
              if (next[0] === "simple" || next[0] === "full")
                setAldoSimpleMode(next[0] === "simple");
            }}
          >
            <Toggle value="simple">Simple</Toggle>
            <Toggle value="full">Full</Toggle>
          </ToggleGroup>
        }
      />
    </SettingsSection>
  );
}

/** General's footer row in Aldo: its shortcuts, which have no entry of their own in the nav. */
export function AldoKeyboardShortcutsRow() {
  return (
    <SettingsRow
      id="aldo-keyboard-shortcuts"
      title="Keyboard shortcuts"
      description="View every shortcut Aldo supports."
      control={
        <Button render={<Link to="/settings/keybindings" />} size="sm" variant="outline">
          View shortcuts
        </Button>
      }
    />
  );
}
