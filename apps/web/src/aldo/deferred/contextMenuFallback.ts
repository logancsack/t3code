type Real = typeof import("../../contextMenuFallback");

// No menu can be open before the module that draws it has loaded.
let real: Real | null = null;
const load = () => import("../../contextMenuFallback").then((module) => (real = module));

export const isContextMenuOpen: Real["isContextMenuOpen"] = () =>
  real?.isContextMenuOpen() ?? false;

export const dismissContextMenu: Real["dismissContextMenu"] = (restoreFocus) =>
  real?.dismissContextMenu(restoreFocus);

export const showContextMenuFallback: Real["showContextMenuFallback"] = async (items, position) =>
  (await load()).showContextMenuFallback(items, position);
