// @effect-diagnostics nodeBuiltinImport:off -- Isolated config fixtures, never the user's desktop.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import { afterEach, beforeEach, expect, it as test, vi } from "vite-plus/test";
import { CaptureShortcutConfig } from "./CaptureShortcutConfig.ts";

// oxlint-disable-next-line t3code/no-global-process-runtime -- Test collection checks the host before starting these Linux-native filesystem tests.
const it = test.runIf(process.platform === "linux");
let directory: string;
let path: string;
let setup: CaptureShortcutConfig;
const tools = {
  validateNiri: vi.fn<(path: string) => Promise<void>>(),
  hyprlandBindings:
    vi.fn<() => Promise<{ modmask: number; key: string; dispatcher: string; arg: string }[]>>(),
  reloadHyprland: vi.fn<() => Promise<void>>(),
};
const appId = "com.t3tools.T3Code";
const install = { operation: "install", chooseFile: false } as const;
const target = () => ({ desktop: "niri" as const, path, appId });
beforeEach(async () => {
  directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-capture-config-"));
  path = NodePath.join(directory, "config.kdl");
  await NodeFSP.writeFile(path, "binds {\n    Mod+Q { quit; }\n}\n", { mode: 0o640 });
  tools.validateNiri.mockReset().mockResolvedValue(undefined);
  tools.hyprlandBindings.mockReset().mockResolvedValue([]);
  tools.reloadHyprland.mockReset().mockResolvedValue(undefined);
  setup = new CaptureShortcutConfig(tools);
});
afterEach(async () => {
  await NodeFSP.rm(directory, { recursive: true, force: true });
});

it("reads without writing, then applies only the approved diff with a backup", async () => {
  const before = await NodeFSP.readFile(path, "utf8");
  const preview = await setup.preview(target(), install);
  expect(await NodeFSP.readFile(path, "utf8")).toBe(before);
  expect(await NodeFSP.readdir(directory)).toEqual(["config.kdl"]);
  expect(tools.validateNiri).not.toHaveBeenCalled();
  expect(preview.before).toBe(before);
  expect(preview.after).toContain("Ctrl+Shift+2");
  const applied = await setup.apply(preview.id, "niri");
  expect(await NodeFSP.readFile(path, "utf8")).toBe(preview.after);
  expect(await NodeFSP.readFile(applied.backupPath!, "utf8")).toBe(before);
  expect((await NodeFSP.stat(path)).mode & 0o777).toBe(0o640);
  expect(tools.validateNiri).toHaveBeenCalledOnce();
  await expect(setup.apply(preview.id, "niri")).rejects.toThrow("expired");
});
it("refuses apply without a preview or for the wrong desktop", async () => {
  await expect(setup.apply("invented", "niri")).rejects.toThrow("expired");
  const preview = await setup.preview(target(), install);
  await expect(setup.apply(preview.id, "hyprland")).rejects.toThrow("expired");
  expect(await NodeFSP.readFile(path, "utf8")).toBe(preview.before);
});
it("refuses direct and indirect conflicts introduced after preview", async () => {
  const preview = await setup.preview(target(), install);
  await NodeFSP.appendFile(path, "// edited elsewhere\n");
  await expect(setup.apply(preview.id, "niri")).rejects.toThrow("changed since");
  expect(await NodeFSP.readFile(path, "utf8")).toBe(preview.before + "// edited elsewhere\n");
  expect(await NodeFSP.readdir(directory)).toEqual(["config.kdl"]);
  await NodeFSP.writeFile(path, 'binds {}\ninclude optional=true "later.kdl"\n');
  const optional = await setup.preview(target(), install);
  await NodeFSP.writeFile(
    NodePath.join(directory, "later.kdl"),
    "binds { Ctrl+Shift+2 { quit; } }",
  );
  await expect(setup.apply(optional.id, "niri")).rejects.toThrow("changed since");
  expect(await NodeFSP.readFile(path, "utf8")).toBe(optional.before);
  const hypr = {
    ...target(),
    desktop: "hyprland" as const,
    path: NodePath.join(directory, "hyprland.conf"),
  };
  await NodeFSP.writeFile(hypr.path, "# unchanged\n");
  const live = await setup.preview(hypr, install);
  tools.hyprlandBindings.mockResolvedValue([
    { modmask: 5, key: "2", dispatcher: "exec", arg: "kitty" },
  ]);
  await expect(setup.apply(live.id, "hyprland")).rejects.toThrow("already used");
  expect(await NodeFSP.readFile(hypr.path, "utf8")).toBe(live.before);
});
it("rechecks after validation and cleans the staged file on concurrent edits", async () => {
  const preview = await setup.preview(target(), install);
  tools.validateNiri.mockImplementation(async () => {
    await NodeFSP.appendFile(path, "// keep this\n");
  });
  await expect(setup.apply(preview.id, "niri")).rejects.toThrow("changed since");
  expect(await NodeFSP.readdir(directory)).toEqual(["config.kdl"]);
  expect(await NodeFSP.readFile(path, "utf8")).toContain("keep this");
});
it("refuses a symlink retargeted since preview", async () => {
  const link = NodePath.join(directory, "linked.kdl");
  const other = NodePath.join(directory, "other.kdl");
  await NodeFSP.writeFile(other, "binds {}\n");
  await NodeFSP.symlink(path, link);
  const preview = await setup.preview({ ...target(), path: link }, install);
  await NodeFSP.unlink(link);
  await NodeFSP.symlink(other, link);
  await expect(setup.apply(preview.id, "niri")).rejects.toThrow("changed since");
  expect(await NodeFSP.readFile(other, "utf8")).toBe("binds {}\n");
});
it("does not apply invalid Niri configs", async () => {
  const preview = await setup.preview(target(), install);
  tools.validateNiri.mockRejectedValue(new Error("Invalid config"));
  await expect(setup.apply(preview.id, "niri")).rejects.toThrow("Invalid config");
  expect(await NodeFSP.readFile(path, "utf8")).toBe(preview.before);
  expect(await NodeFSP.readdir(directory)).toEqual(["config.kdl"]);
});
it("detects conflicts in included Niri configs without changing either file", async () => {
  await NodeFSP.appendFile(path, 'include "keys.kdl"\n');
  await NodeFSP.writeFile(NodePath.join(directory, "keys.kdl"), "binds { Shift+Ctrl+2 { quit; } }");
  await expect(setup.preview(target(), install)).rejects.toThrow("already used");
  expect((await NodeFSP.readdir(directory)).sort()).toEqual(["config.kdl", "keys.kdl"]);
});
it("does not edit Omarchy's shipped defaults", async () => {
  const defaults = NodePath.join(directory, "omarchy", "default", "hypr");
  await NodeFSP.mkdir(defaults, { recursive: true });
  const file = NodePath.join(defaults, "bindings.conf");
  await NodeFSP.writeFile(file, "# defaults\n");
  await expect(
    setup.preview({ ...target(), desktop: "hyprland", path: file }, install),
  ).rejects.toThrow("not system or Omarchy");
});
