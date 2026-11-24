import { deferred } from "../../deferred";

export const ProjectCloneToastCoordinator = deferred(() =>
  import("../../../components/ProjectCloneToastCoordinator").then(
    (m) => m.ProjectCloneToastCoordinator,
  ),
);
