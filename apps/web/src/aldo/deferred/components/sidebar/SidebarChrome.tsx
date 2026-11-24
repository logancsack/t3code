import { deferred } from "../../../deferred";

export const SidebarBrandWidthProbe = deferred(() =>
  import("../../../../components/sidebar/SidebarChrome").then((m) => m.SidebarBrandWidthProbe),
);
