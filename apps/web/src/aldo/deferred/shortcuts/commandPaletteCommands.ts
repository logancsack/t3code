type Real = typeof import("../../../shortcuts/commandPaletteCommands");

export const installCommandPaletteCommands: Real["installCommandPaletteCommands"] = (...args) => {
  const installed = import("../../../shortcuts/commandPaletteCommands").then((m) =>
    m.installCommandPaletteCommands(...args),
  );
  return () => void installed.then((dispose) => dispose());
};
