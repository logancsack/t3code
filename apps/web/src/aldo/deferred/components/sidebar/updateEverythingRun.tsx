type Real = typeof import("../../../../components/sidebar/updateEverythingRun");

export const startDesktopUpdateLaunchNotice: Real["startDesktopUpdateLaunchNotice"] = () => {
  const stop = import("../../../../components/sidebar/updateEverythingRun").then((m) =>
    m.startDesktopUpdateLaunchNotice(),
  );
  return () => void stop.then((dispose) => dispose());
};
