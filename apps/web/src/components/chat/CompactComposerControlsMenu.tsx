import { ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { memo, type ReactNode } from "react";
import { EllipsisIcon } from "lucide-react";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";
import { ComposerControl, ComposerControlIcon } from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import { useComposerMenuState } from "./useComposerMenuState";

const RUNTIME_MODE_LABELS: Record<RuntimeMode, string> = {
  "approval-required": "Supervised",
  "auto-accept-edits": "Auto-accept edits",
  auto: "Auto",
  "full-access": "Full access",
};
const ALL_RUNTIME_MODES = Object.keys(RUNTIME_MODE_LABELS) as RuntimeMode[];

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  interactionMode: ProviderInteractionMode;
  runtimeMode: RuntimeMode;
  supportedRuntimeModes: ReadonlyArray<RuntimeMode>;
  showInteractionModeToggle: boolean;
  traitsMenuContent?: ReactNode;
  size?: "sm" | "xs";
  /**
   * The resting strip keeps this menu mounted out of flow while every block
   * fits inline. Its portaled popup would outlive that transition, so an
   * open menu closes when its trigger hides.
   */
  hidden?: boolean;
  onToggleInteractionMode: () => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const composerFloatingLayerProps = useComposerMenuProps();
  const size = props.size ?? "sm";
  const [open, setOpen] = useComposerMenuState(props.hidden);
  const supportedRuntimeModes =
    props.supportedRuntimeModes.length > 0 ? props.supportedRuntimeModes : ALL_RUNTIME_MODES;
  const displayedRuntimeMode = supportedRuntimeModes.includes(props.runtimeMode)
    ? props.runtimeMode
    : (supportedRuntimeModes[0] ?? "full-access");
  const isRuntimeModeFixed = supportedRuntimeModes.length === 1;

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <ComposerControl
            size={size}
            className="shrink-0"
            aria-label={
              isRuntimeModeFixed
                ? `More composer controls; ${RUNTIME_MODE_LABELS[displayedRuntimeMode]} required`
                : "More composer controls"
            }
            data-composer-shortcut={
              props.traitsMenuContent ? "composer.mode composer.effort" : "composer.mode"
            }
          />
        }
      >
        <ComposerControlIcon icon={EllipsisIcon} size={size} />
      </MenuTrigger>
      <MenuPopup align="start" {...composerFloatingLayerProps}>
        {props.traitsMenuContent ? (
          <>
            {props.traitsMenuContent}
            <MenuDivider />
          </>
        ) : null}
        {props.showInteractionModeToggle ? (
          <>
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Mode</div>
            <MenuRadioGroup
              value={props.interactionMode}
              onValueChange={(value) => {
                if (!value || value === props.interactionMode) return;
                props.onToggleInteractionMode();
              }}
            >
              <MenuRadioItem value="default">Chat</MenuRadioItem>
              <MenuRadioItem value="plan">Plan</MenuRadioItem>
            </MenuRadioGroup>
            <MenuDivider />
          </>
        ) : null}
        <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Access</div>
        {isRuntimeModeFixed ? (
          <MenuItem disabled aria-label={`${RUNTIME_MODE_LABELS[displayedRuntimeMode]} required`}>
            <span>{RUNTIME_MODE_LABELS[displayedRuntimeMode]}</span>
            <span className="ms-auto text-muted-foreground text-xs">Required</span>
          </MenuItem>
        ) : (
          <MenuRadioGroup
            value={displayedRuntimeMode}
            onValueChange={(value) => {
              if (!value || value === displayedRuntimeMode) return;
              props.onRuntimeModeChange(value as RuntimeMode);
            }}
          >
            {supportedRuntimeModes.map((mode) => (
              <MenuRadioItem key={mode} value={mode}>
                {RUNTIME_MODE_LABELS[mode]}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        )}
      </MenuPopup>
    </Menu>
  );
});
