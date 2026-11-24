import { deferred } from "../../deferred";

export const HostedEmptyState = deferred(() =>
  import("../../../components/HostedEmptyState").then((m) => m.HostedEmptyState),
);
