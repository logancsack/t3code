import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerFooterModeControls } from "./ChatComposer";
import { CompactComposerControlsMenu } from "./CompactComposerControlsMenu";

const noop = () => undefined;

describe("provider-constrained runtime mode controls", () => {
  it("renders desktop Prime access as a disabled Full access state", () => {
    const markup = renderToStaticMarkup(
      <ComposerFooterModeControls
        showInteractionModeToggle={false}
        interactionMode="default"
        runtimeMode="full-access"
        supportedRuntimeModes={["full-access"]}
        showPlanToggle={false}
        planSidebarLabel="Plan"
        planSidebarOpen={false}
        onToggleInteractionMode={noop}
        onRuntimeModeChange={noop}
        onTogglePlanSidebar={noop}
      />,
    );

    expect(markup).toContain("Full access");
    expect(markup).toContain("Required");
    expect(markup).toContain("Runtime mode: Full access (required by provider)");
    expect(markup).toContain("disabled");
  });

  it("labels the compact composer with Prime's fixed Full access requirement", () => {
    const markup = renderToStaticMarkup(
      <CompactComposerControlsMenu
        activePlan={false}
        interactionMode="default"
        planSidebarLabel="Plan"
        planSidebarOpen={false}
        runtimeMode="full-access"
        supportedRuntimeModes={["full-access"]}
        showInteractionModeToggle={false}
        onToggleInteractionMode={noop}
        onTogglePlanSidebar={noop}
        onRuntimeModeChange={noop}
      />,
    );

    expect(markup).toContain("More composer controls; Full access required");
  });
});
