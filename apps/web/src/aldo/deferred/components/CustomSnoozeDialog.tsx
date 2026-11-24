import { deferredHost } from "../../deferred";

type Real = typeof import("../../../components/CustomSnoozeDialog");

const dialog = deferredHost(
  () => import("../../../components/CustomSnoozeDialog"),
  (m) => m.CustomSnoozeDialogHost,
);

export const requestCustomSnooze: Real["requestCustomSnooze"] = () =>
  dialog.use().then((m) => m.requestCustomSnooze());

export const CustomSnoozeDialogHost = dialog.Host;
