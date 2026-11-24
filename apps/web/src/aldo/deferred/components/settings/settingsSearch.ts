/** For the settings route's guard alone, which awaits it; the pages themselves load the index. */
export const movedSettingsPath = async (pathname: string, hash: string) =>
  (await import("../../../../components/settings/settingsSearch")).movedSettingsPath(
    pathname,
    hash,
  );
