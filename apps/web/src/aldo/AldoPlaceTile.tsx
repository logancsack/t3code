// A place's mark: General's empty dashed tile, or a project's own (its
// favicon or monogram, as the sidebar shows it); a project with no machine
// loaded yet gets the monogram its name would.

import { ProjectFavicon, type ProjectFaviconProject } from "../components/ProjectFavicon";
import { ProjectMonogram } from "../components/ProjectMonogram";
import { deriveProjectIdentity } from "../projectIdentity";
import { AldoGeneralTile } from "./AldoGeneralTile";
import type { AldoPlace } from "./places.logic";

export type AldoPickedPlace = AldoPlace<ProjectFaviconProject>;

export function AldoPlaceTile(props: {
  readonly place: Pick<AldoPickedPlace, "repos" | "name" | "project">;
  readonly className?: string | undefined;
}) {
  const { place, className } = props;
  if (place.repos.length === 0) return <AldoGeneralTile className={className} />;
  if (place.project) return <ProjectFavicon project={place.project} className={className} />;
  const identity = deriveProjectIdentity(place.name);
  return <ProjectMonogram text={identity.monogram} color={identity.color} className={className} />;
}
