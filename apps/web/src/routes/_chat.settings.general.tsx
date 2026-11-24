import { createFileRoute } from "@tanstack/react-router";

import { AldoGeneralPage } from "../aldo/AldoGeneralPage";
import { isAldoCloud } from "../aldo/api";
import { GeneralSettingsPanel } from "../components/settings/SettingsPanels";

function SettingsGeneralRoute() {
  return isAldoCloud ? <AldoGeneralPage /> : <GeneralSettingsPanel />;
}

export const Route = createFileRoute("/_chat/settings/general")({
  component: SettingsGeneralRoute,
});
