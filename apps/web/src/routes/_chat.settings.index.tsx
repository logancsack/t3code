import { Navigate, createFileRoute } from "@tanstack/react-router";

import { AldoSettingsHome } from "../aldo/AldoSettingsHome";
import { isAldoCloud } from "../aldo/api";
import { useIsMobile } from "../hooks/useMediaQuery";

/**
 * Settings itself: on a phone in Aldo, the list of its pages; anywhere else
 * the first page (settings.tsx redirects there before this loads, and this
 * follows when a phone's window grows past a phone's width).
 */
function SettingsIndexRoute() {
  const isMobile = useIsMobile();
  if (isAldoCloud && isMobile) return <AldoSettingsHome />;
  return (
    <Navigate
      to={isAldoCloud ? "/settings/agents" : "/settings/general"}
      search={(previous) => previous}
      replace
    />
  );
}

export const Route = createFileRoute("/settings/")({
  component: SettingsIndexRoute,
});
