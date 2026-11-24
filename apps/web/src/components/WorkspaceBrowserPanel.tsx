"use client";

import { AldoBrowserPanel } from "~/aldo/AldoBrowserPanel";
import { isAldoCloud } from "~/aldo/api";
import { isLandingDemo } from "~/landingDemo/mode";
import { LandingDemoPreviewPanel } from "~/landingDemo/PreviewPanel";

export function WorkspaceBrowserPanel({
  environmentId,
}: { environmentId?: string | undefined } = {}) {
  if (isLandingDemo()) {
    return <LandingDemoPreviewPanel />;
  }
  if (isAldoCloud && environmentId) {
    return <AldoBrowserPanel key={environmentId} environmentId={environmentId} />;
  }
  return null;
}
