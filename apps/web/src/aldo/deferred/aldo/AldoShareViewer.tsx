import { deferred } from "../../deferred";
import { useAldoOpenShare } from "../../shareViewer";

const Viewer = deferred(async () => (await import("../../AldoShareViewer")).AldoShareViewerHost);

export function AldoShareViewerHost() {
  return useAldoOpenShare() ? <Viewer /> : null;
}
