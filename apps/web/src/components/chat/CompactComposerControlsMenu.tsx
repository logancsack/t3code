import { ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { memo, type ReactNode } from "react";
import { EllipsisIcon, ListTodoIcon } from "lucide-react";
import { Button } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";

const RUNTIME_MODE_LABELS: Record<RuntimeMode, string> = {
  "approval-required": "Supervised",
  "auto-accept-edits": "Auto-accept edits",
  auto: "Auto",
  "full-access": "Full access",
};
const ALL_RUNTIME_MODES = Object.keys(RUNTIME_MODE_LABELS) as RuntimeMode[];

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  activePlan: boolean;
  interactionMode: ProviderInteractionMode;
  planSidebarLabel: string;
  planSidebarOpen: boolean;
  runtimeMode: RuntimeMode;
  supportedRuntimeModes: ReadonlyArray<RuntimeMode>;
  showInteractionModeToggle: boolean;
  traitsMenuContent?: ReactNode;
  onToggleInteractionMode: () => void;
  onTogglePlanSidebar: () => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const supportedRuntimeModes =
    props.supportedRuntimeModes.length > 0 ? props.supportedRuntimeModes : ALL_RUNTIME_MODES;
  const displayedRuntimeMode = supportedRuntimeModes.includes(props.runtimeMode)
    ? props.runtimeMode
    : (supportedRuntimeModes[0] ?? "full-access");
  const isRuntimeModeFixed = supportedRuntimeModes.length === 1;

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 px-2 text-muted-foreground/70 hover:text-foreground/80"
            aria-label={
              isRuntimeModeFixed
                ? `More composer controls; ${RUNTIME_MODE_LABELS[displayedRuntimeMode]} required`
                : "More composer controls"
            }
          />
        }
      >
        <EllipsisIcon aria-hidden="true" className="size-4" />
      </MenuTrigger>
      <MenuPopup align="start">
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
        {props.activePlan ? (
          <>
            <MenuDivider />
            <MenuItem onClick={props.onTogglePlanSidebar}>
              <ListTodoIcon className="size-4 shrink-0" />
              {props.planSidebarOpen
                ? `Hide ${props.planSidebarLabel.toLowerCase()} sidebar`
                : `Show ${props.planSidebarLabel.toLowerCase()} sidebar`}
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
});
