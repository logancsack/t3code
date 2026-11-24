import type { EnvironmentId } from "@t3tools/contracts";

import { deferredHost } from "../../../deferred";

const dialog = deferredHost(
  () => import("../../../../components/mcp/UseInAnotherAppDialog"),
  (m) => m.UseInAnotherAppDialogHost,
);

export function openUseInAnotherApp(environmentId: EnvironmentId | null): void {
  void dialog.use().then((m) => m.openUseInAnotherApp(environmentId));
}

export const UseInAnotherAppDialogHost = dialog.Host;
