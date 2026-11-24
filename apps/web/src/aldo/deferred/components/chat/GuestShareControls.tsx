import { useAtomValue } from "@effect/atom-react";

import { guestShareDialogThreadAtom } from "../../../../components/chat/guestShareDialogState";
import { deferred } from "../../../deferred";

const Host = deferred(() =>
  import("../../../../components/chat/GuestShareControls").then((m) => m.GuestShareDialogHost),
);

export function GuestShareDialogHost() {
  return useAtomValue(guestShareDialogThreadAtom) === null ? null : <Host />;
}
