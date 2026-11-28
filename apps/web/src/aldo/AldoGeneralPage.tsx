import {
  DEFAULT_UNIFIED_SETTINGS,
  ScreenReaderAnnouncements,
  type ChatWidth,
} from "@t3tools/contracts/settings";
import { Link } from "@tanstack/react-router";
import {
  LayoutGridIcon,
  PaletteIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  TypeIcon,
} from "lucide-react";
import { useContext } from "react";

import { SendShortcutRow, useSettingsRestore } from "../components/settings/SettingsPanels";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../components/settings/settingsLayout";
import { searchableSetting } from "../components/settings/settingsSearch";
import {
  useScopedSettings,
  useUpdateScopedSettings,
} from "../components/settings/useScopedSettings";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { Toggle, ToggleGroup } from "../components/ui/toggle-group";
import { useIsMobile } from "../hooks/useMediaQuery";
import { useTheme } from "../hooks/useTheme";
import { ensureLocalApi, readLocalApi } from "../localApi";
import { cn } from "~/lib/utils";
import type { ThemePreferenceMode } from "../themePalette";
import { AldoKeyboardShortcutsRow } from "./AldoGeneralSettings";
import { AldoSettingsFold } from "./AldoSettingsFold";
import { setAldoSound, useAldoSound } from "./chime";
import {
  getAldoDeveloperToolsOverride,
  setAldoDeveloperTools,
  useAldoDeveloperTools,
} from "./developerTools";
import { setAldoPreloadSettings, useAldoPreloadSettings } from "./preloadSettings";
import { AldoSettingsRestoredContext } from "./settings.logic";
import {
  hasAldoSimpleModeOverride,
  resetAldoSimpleMode,
  setAldoSimpleMode,
  useAldoSimpleMode,
} from "./simpleMode";

const TEXT_SIZES = [
  { id: "small", label: "Small", px: 14 },
  { id: "default", label: "Default", px: 16 },
  { id: "large", label: "Large", px: 18 },
] as const;

const CHAT_WIDTH_OPTIONS: ReadonlyArray<{ readonly value: ChatWidth; readonly label: string }> = [
  { value: "comfortable", label: "Comfortable" },
  { value: "wide", label: "Wide" },
  { value: "full", label: "Full" },
];

const TIME_FORMAT_OPTIONS = [
  { value: "locale", label: "System default" },
  { value: "12-hour", label: "12-hour" },
  { value: "24-hour", label: "24-hour" },
] as const;

const SCREEN_READER_LABELS: Record<ScreenReaderAnnouncements, string> = {
  status: "Status only",
  messages: "Status and messages",
  everything: "Everything",
};

const FOLD_TARGET_IDS: ReadonlySet<string> = new Set([
  "delete-confirmation",
  "screen-reader-announcements",
  "screen-reader-window-title",
]);

function AppearanceWireframe({ mode }: { readonly mode: ThemePreferenceMode }) {
  if (mode === "system") {
    return (
      <span
        aria-hidden="true"
        className="relative block h-14 w-full overflow-hidden rounded-md border border-border/80"
      >
        <span className="absolute inset-y-0 left-0 w-1/2 bg-[#ffffff] p-2">
          <span className="block h-1.5 w-7 rounded-full bg-[#18181b]/80" />
          <span className="mt-1.5 block h-1 w-9 rounded-full bg-[#18181b]/20" />
          <span className="mt-2 block h-3 w-full rounded-sm border border-[#e4e4e7] bg-[#f4f4f5]" />
        </span>
        <span className="absolute inset-y-0 right-0 w-1/2 border-l border-border/70 bg-[#141416] p-2">
          <span className="block h-1.5 w-7 rounded-full bg-[#f4f4f5]/80" />
          <span className="mt-1.5 block h-1 w-9 rounded-full bg-[#f4f4f5]/25" />
          <span className="mt-2 block h-3 w-full rounded-sm border border-[#27272a] bg-[#1e1e22]" />
        </span>
      </span>
    );
  }
  const dark = mode === "dark";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block h-14 w-full overflow-hidden rounded-md border p-2",
        dark ? "border-[#27272a] bg-[#141416]" : "border-[#e4e4e7] bg-[#ffffff]",
      )}
    >
      <span
        className={cn(
          "block h-1.5 w-10 rounded-full",
          dark ? "bg-[#f4f4f5]/80" : "bg-[#18181b]/80",
        )}
      />
      <span
        className={cn(
          "mt-1.5 block h-1 w-16 rounded-full",
          dark ? "bg-[#f4f4f5]/25" : "bg-[#18181b]/20",
        )}
      />
      <span
        className={cn(
          "mt-2 flex items-center justify-between rounded-sm border px-1.5 py-1",
          dark ? "border-[#27272a] bg-[#1e1e22]" : "border-[#e4e4e7] bg-[#f4f4f5]",
        )}
      >
        <span
          className={cn("block h-1 w-8 rounded-full", dark ? "bg-[#f4f4f5]/35" : "bg-[#18181b]/30")}
        />
        <span className="block size-2 rounded-full bg-[#1b4ed8]" />
      </span>
    </span>
  );
}

function AldoAppearanceSection() {
  const { appearanceMode, setAppearanceMode, theme, setTheme, themeHalves, clearThemeHalves } =
    useTheme();
  const hasCustomTheme =
    themeHalves !== null || (theme !== "system" && theme !== "light" && theme !== "dark");
  const modes: ReadonlyArray<{ readonly value: ThemePreferenceMode; readonly label: string }> = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "System" },
  ];

  return (
    <SettingsSection
      id="aldo-appearance"
      title="Appearance"
      icon={<PaletteIcon className="size-4" />}
    >
      <div id="theme" className="px-3 py-3 sm:px-4">
        <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-3 gap-2.5">
          {modes.map((option) => {
            const active = appearanceMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setAppearanceMode(option.value)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border p-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary bg-primary/5 ring-1 ring-primary/25"
                    : "border-border/80 bg-background hover:bg-accent/40",
                )}
              >
                <AppearanceWireframe mode={option.value} />
                <span
                  className={cn(
                    "text-xs font-medium",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {hasCustomTheme ? (
        <SettingsRow
          title="Custom color theme"
          description="A custom palette from earlier is still active on this device."
          control={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                clearThemeHalves();
                setTheme("system");
              }}
            >
              Restore Aldo theme
            </Button>
          }
        />
      ) : null}
    </SettingsSection>
  );
}

/**
 * Settings → Preferences: appearance, view, text readability, behavior,
 * accessibility, shortcuts, licenses and device reset — unified on one page.
 */
export function AldoGeneralPage() {
  const isMobile = useIsMobile();
  const simple = useAldoSimpleMode();
  const preload = useAldoPreloadSettings();
  const developerTools = useAldoDeveloperTools();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();

  const textSizeChoice =
    settings.fontSizeInterface <= 14
      ? "small"
      : settings.fontSizeInterface >= 18
        ? "large"
        : "default";
  const highContrast = settings.appearanceContrast >= 120;

  return (
    <SettingsPageContainer>
      <AldoAppearanceSection />

      <SettingsSection title="View" icon={<LayoutGridIcon className="size-4" />}>
        <SettingsRow
          {...searchableSetting("aldo-simple-mode")}
          title="Layout"
          description="Simple shows Aldo, Needs you and Library. Full adds the thread sidebar."
          control={
            <ToggleGroup
              aria-label="View"
              variant="segmented"
              value={[simple ? "simple" : "full"]}
              onValueChange={(next) => {
                if (next[0] === "simple" || next[0] === "full") {
                  setAldoSimpleMode(next[0] === "simple");
                }
              }}
            >
              <Toggle value="simple">Simple</Toggle>
              <Toggle value="full">Full</Toggle>
            </ToggleGroup>
          }
        />
      </SettingsSection>

      <SettingsSection title="Text and readability" icon={<TypeIcon className="size-4" />}>
        <SettingsRow
          {...searchableSetting("aldo-text-size")}
          description="Adjust the size of interface text on this device."
          resetAction={
            settings.fontSizeInterface !== DEFAULT_UNIFIED_SETTINGS.fontSizeInterface ? (
              <SettingResetButton
                ariaLabel="Reset text size to default"
                onClick={() =>
                  updateSettings({ fontSizeInterface: DEFAULT_UNIFIED_SETTINGS.fontSizeInterface })
                }
              />
            ) : null
          }
          control={
            <ToggleGroup
              aria-label="Text size"
              variant="segmented"
              value={[textSizeChoice]}
              onValueChange={(next) => {
                const picked = TEXT_SIZES.find((option) => option.id === next[0]);
                if (picked) updateSettings({ fontSizeInterface: picked.px });
              }}
            >
              {TEXT_SIZES.map((option) => (
                <Toggle key={option.id} value={option.id}>
                  {option.label}
                </Toggle>
              ))}
            </ToggleGroup>
          }
        />
        <SettingsRow
          {...searchableSetting("aldo-contrast")}
          description="Stronger borders and text contrast across the app."
          inline
          resetAction={
            settings.appearanceContrast !== DEFAULT_UNIFIED_SETTINGS.appearanceContrast ? (
              <SettingResetButton
                ariaLabel="Reset contrast to default"
                onClick={() =>
                  updateSettings({
                    appearanceContrast: DEFAULT_UNIFIED_SETTINGS.appearanceContrast,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={highContrast}
              onCheckedChange={(checked) =>
                updateSettings({ appearanceContrast: checked ? 125 : 100 })
              }
              aria-label="Higher contrast"
            />
          }
        />
        {!isMobile ? (
          <>
            <SettingsRow
              {...searchableSetting("chat-width")}
              description="How wide conversations grow on large screens."
              resetAction={
                settings.chatWidth !== DEFAULT_UNIFIED_SETTINGS.chatWidth ? (
                  <SettingResetButton
                    ariaLabel="Reset chat width to default"
                    onClick={() =>
                      updateSettings({ chatWidth: DEFAULT_UNIFIED_SETTINGS.chatWidth })
                    }
                  />
                ) : null
              }
              control={
                <Select
                  value={settings.chatWidth}
                  onValueChange={(value) => {
                    if (value === "comfortable" || value === "wide" || value === "full") {
                      updateSettings({ chatWidth: value });
                    }
                  }}
                >
                  <SelectTrigger size="sm" className="w-40" aria-label="Chat width">
                    <SelectValue>
                      {CHAT_WIDTH_OPTIONS.find((option) => option.value === settings.chatWidth)
                        ?.label ?? "Comfortable"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {CHAT_WIDTH_OPTIONS.map((option) => (
                      <SelectItem hideIndicator key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              }
            />
            <SettingsRow
              {...searchableSetting("time-format")}
              description="System default follows your browser or device clock."
              resetAction={
                settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat ? (
                  <SettingResetButton
                    ariaLabel="Reset time format to default"
                    onClick={() =>
                      updateSettings({ timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat })
                    }
                  />
                ) : null
              }
              control={
                <Select
                  value={settings.timestampFormat}
                  onValueChange={(value) => {
                    if (value === "locale" || value === "12-hour" || value === "24-hour") {
                      updateSettings({ timestampFormat: value });
                    }
                  }}
                >
                  <SelectTrigger size="sm" className="w-40" aria-label="Time format">
                    <SelectValue>
                      {TIME_FORMAT_OPTIONS.find(
                        (option) => option.value === settings.timestampFormat,
                      )?.label ?? "System default"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    {TIME_FORMAT_OPTIONS.map((option) => (
                      <SelectItem hideIndicator key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              }
            />
          </>
        ) : null}
      </SettingsSection>

      <SettingsSection title="Behavior" icon={<SlidersHorizontalIcon className="size-4" />}>
        <SettingsRow
          {...searchableSetting("aldo-preload")}
          description="Start a thread’s computer when you open it so replies begin without waiting."
          inline
          control={
            <Switch
              checked={preload.newThreads && preload.openedThreads}
              onCheckedChange={(checked) =>
                setAldoPreloadSettings({ newThreads: checked, openedThreads: checked })
              }
              aria-label="Keep agents ready"
            />
          }
        />
        <SettingsRow
          {...searchableSetting("aldo-developer-tools")}
          description="Show Code settings, pull requests, terminal, diffs and code hosts."
          inline
          control={
            <Switch
              checked={developerTools}
              onCheckedChange={(checked) => setAldoDeveloperTools(checked)}
              aria-label="Developer tools"
            />
          }
        />
        {!isMobile ? <SendShortcutRow /> : null}
      </SettingsSection>

      <AldoSettingsFold
        title="Confirmations and accessibility"
        hint="Delete confirmation, screen reader"
        opensFor={(id) => FOLD_TARGET_IDS.has(id)}
      >
        <SettingsSection title="Confirmations and accessibility" hideTitle>
          <SettingsRow
            {...searchableSetting("delete-confirmation")}
            description="Ask before deleting a thread and its history."
            inline
            resetAction={
              settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete ? (
                <SettingResetButton
                  ariaLabel="Reset delete confirmation to default"
                  onClick={() =>
                    updateSettings({
                      confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
                    })
                  }
                />
              ) : null
            }
            control={
              <Switch
                checked={settings.confirmThreadDelete}
                onCheckedChange={(checked) =>
                  updateSettings({ confirmThreadDelete: Boolean(checked) })
                }
                aria-label="Confirm before deleting a thread"
              />
            }
          />
          <SettingsRow
            {...searchableSetting("screen-reader-announcements")}
            description="What a screen reader hears while a thread runs."
            resetAction={
              settings.screenReaderAnnouncements !==
              DEFAULT_UNIFIED_SETTINGS.screenReaderAnnouncements ? (
                <SettingResetButton
                  ariaLabel="Reset screen reader announcements to default"
                  onClick={() =>
                    updateSettings({
                      screenReaderAnnouncements: DEFAULT_UNIFIED_SETTINGS.screenReaderAnnouncements,
                    })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={settings.screenReaderAnnouncements}
                onValueChange={(value) => {
                  if (value === "status" || value === "messages" || value === "everything") {
                    updateSettings({ screenReaderAnnouncements: value });
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-48"
                  aria-label="Screen reader announcements"
                >
                  <SelectValue>
                    {SCREEN_READER_LABELS[settings.screenReaderAnnouncements]}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {ScreenReaderAnnouncements.literals.map((value) => (
                    <SelectItem hideIndicator key={value} value={value}>
                      {SCREEN_READER_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
          {!isMobile ? (
            <SettingsRow
              {...searchableSetting("screen-reader-window-title")}
              description="Start the window title with the thread’s status so screen readers read it first."
              inline
              resetAction={
                settings.screenReaderWindowTitle !==
                DEFAULT_UNIFIED_SETTINGS.screenReaderWindowTitle ? (
                  <SettingResetButton
                    ariaLabel="Reset screen reader window title to default"
                    onClick={() =>
                      updateSettings({
                        screenReaderWindowTitle: DEFAULT_UNIFIED_SETTINGS.screenReaderWindowTitle,
                      })
                    }
                  />
                ) : null
              }
              control={
                <Switch
                  checked={settings.screenReaderWindowTitle}
                  onCheckedChange={(checked) =>
                    updateSettings({ screenReaderWindowTitle: Boolean(checked) })
                  }
                  aria-label="Screen reader window title"
                />
              }
            />
          ) : null}
        </SettingsSection>
      </AldoSettingsFold>

      <SettingsSection title="Shortcuts, licenses and reset">
        {!isMobile ? <AldoKeyboardShortcutsRow /> : null}
        <SettingsRow
          id="open-source-licenses"
          title="Open-source licenses"
          description="Notices for the dependencies and tools Aldo uses."
          control={
            <Button
              render={<Link to="/settings/open-source-licenses" />}
              size="sm"
              variant="outline"
            >
              View licenses
            </Button>
          }
        />
        <AldoResetDeviceSettingsRow />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

/** Resets every device-local preference on this browser (Aldo + T3 defaults). */
function AldoResetDeviceSettingsRow() {
  const onRestored = useContext(AldoSettingsRestoredContext);
  const sound = useAldoSound();
  const preload = useAldoPreloadSettings();
  const simpleOverride = hasAldoSimpleModeOverride();
  const devToolsOverride = getAldoDeveloperToolsOverride() !== null;

  const resetAldoLocal = () => {
    resetAldoSimpleMode();
    setAldoSound(false);
    setAldoPreloadSettings({ newThreads: true, openedThreads: true });
    setAldoDeveloperTools(null);
    onRestored?.();
  };

  const { changedSettingLabels, restoreDefaults } = useSettingsRestore(resetAldoLocal);

  const aldoChangedLabels = [
    ...(simpleOverride ? ["View"] : []),
    ...(sound ? ["Notification chime"] : []),
    ...(preload.newThreads && preload.openedThreads ? [] : ["Keep agents ready"]),
    ...(devToolsOverride ? ["Developer tools"] : []),
  ];
  const hasChanges = changedSettingLabels.length > 0 || aldoChangedLabels.length > 0;

  const handleReset = async () => {
    if (changedSettingLabels.length > 0) {
      await restoreDefaults();
      return;
    }
    if (aldoChangedLabels.length === 0) return;
    const api = readLocalApi();
    const confirmed = await (api ?? ensureLocalApi()).dialogs.confirm(
      ["Reset this device’s settings?", `This will reset: ${aldoChangedLabels.join(", ")}.`].join(
        "\n",
      ),
      { variant: "destructive" },
    );
    if (confirmed) resetAldoLocal();
  };

  return (
    <SettingsRow
      {...searchableSetting("aldo-reset-device")}
      description={
        hasChanges
          ? "Restore appearance, text size, view and other preferences saved on this device."
          : "All settings on this device are already at their defaults."
      }
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={!hasChanges}
          onClick={() => void handleReset()}
        >
          <RotateCcwIcon className="size-3.5" />
          Reset
        </Button>
      }
    />
  );
}
