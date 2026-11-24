import { Toggle, ToggleGroup } from "../components/ui/toggle-group";
import { useTheme } from "../hooks/useTheme";

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
