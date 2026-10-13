// Aldo's own keys, listed on the Keybindings page beside T3's (which come
// from keybindings.json and can be changed; these can't).

import { Kbd } from "../components/ui/kbd";
import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { ALDO_SUMMON_LABEL, ALDO_TALK_LABEL } from "./summon.logic";

const KEYS: ReadonlyArray<{ readonly keys: ReadonlyArray<string>; readonly what: string }> = [
  { keys: [ALDO_SUMMON_LABEL], what: "Aldo, from any screen" },
  { keys: [ALDO_TALK_LABEL], what: "Talk to Aldo" },
  { keys: ["/"], what: "Type to Aldo, on the home screen" },
  { keys: ["j", "k"], what: "Move through the board" },
  { keys: ["↵"], what: "Open what's selected on the board" },
  { keys: ["Esc"], what: "Close a thread peeked at beside Aldo" },
];

export function AldoKeysSection() {
  return (
    <SettingsSection title="Aldo's keys">
      {KEYS.map((key) => (
        <SettingsRow
          key={key.what}
          title={key.what}
          control={
            <span className="flex items-center gap-1">
              {key.keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
          }
        />
      ))}
    </SettingsSection>
  );
}
