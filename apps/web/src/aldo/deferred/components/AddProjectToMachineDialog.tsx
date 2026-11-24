import { deferredHost } from "../../deferred";

type Real = typeof import("../../../components/AddProjectToMachineDialog");

const dialog = deferredHost(
  () => import("../../../components/AddProjectToMachineDialog"),
  (m) => m.AddProjectToMachineDialogHost,
);

export function openAddProjectToMachine(
  ...args: Parameters<Real["openAddProjectToMachine"]>
): void {
  void dialog.use().then((m) => m.openAddProjectToMachine(...args));
}

export const AddProjectToMachineDialogHost = dialog.Host;
