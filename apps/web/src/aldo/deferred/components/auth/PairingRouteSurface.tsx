import { deferred } from "../../../deferred";

const load = () => import("../../../../components/auth/PairingRouteSurface");

export const PairingPendingSurface = deferred(async () => (await load()).PairingPendingSurface);
export const PairingRouteSurface = deferred(async () => (await load()).PairingRouteSurface);
export const HostedPairingRouteSurface = deferred(
  async () => (await load()).HostedPairingRouteSurface,
);
