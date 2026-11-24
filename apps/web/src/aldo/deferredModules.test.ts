// @effect-diagnostics-next-line nodeBuiltinImport:off -- Paths for a Vite plugin, which runs outside Effect.
import * as NodeFS from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Paths for a Vite plugin, which runs outside Effect.
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { expect, it } from "vite-plus/test";

import { aldoDeferredModulesPlugin } from "../../vite/aldoDeferred";

const SRC = NodeURL.fileURLToPath(new URL("../", import.meta.url));
const src = (file: string) => NodePath.join(SRC, file);

/** Resolves as the plugin would in a build, with relative imports resolving to source files. */
async function resolve(source: string, importer: string): Promise<string | null> {
  const plugin = aldoDeferredModulesPlugin();
  const hook = plugin.resolveId as (
    this: { resolve: (source: string, importer: string) => Promise<{ id: string }> },
    source: string,
    importer: string,
    options: object,
  ) => Promise<string | null>;
  const context = {
    resolve: async (id: string, from: string) => {
      const file = NodePath.resolve(NodePath.dirname(from), id);
      return { id: NodeFS.existsSync(`${file}.ts`) ? `${file}.ts` : `${file}.tsx` };
    },
  };
  return hook.call(context, source, src(importer), {});
}

it.each([
  ["./Sidebar", "components/AppSidebarLayout.tsx", "aldo/deferred/components/Sidebar.tsx"],
  ["../../../components/Sidebar", "aldo/deferred/components/Sidebar.tsx", null],
  [
    "../components/chat/GuestShareControls",
    "routes/__root.tsx",
    "aldo/deferred/components/chat/GuestShareControls.tsx",
  ],
  ["./chat/GuestShareControls", "components/ChatView.tsx", null],
  [
    "../components/settings/settingsSearch",
    "routes/_chat.settings.tsx",
    "aldo/deferred/components/settings/settingsSearch.ts",
  ],
  ["../components/settings/settingsSearch", "routes/_chat.settings.tsx?tsr-split=component", null],
  ["gt-react", "components/Sidebar.tsx", "aldo/gtEnglish.tsx"],
  ["gt-i18n", "../../../packages/shared/src/promptLinksCopy.ts", "aldo/gtEnglish.tsx"],
  ["./components/Sidebar.logic", "appInit.tsx", "components/Sidebar.logic.ts?own"],
  ["./Sidebar.logic", "components/Sidebar.tsx", null],
  ["@dnd-kit/sortable", "components/Sidebar.logic.ts?own", "\0aldo-unused:@dnd-kit/sortable"],
  ["@dnd-kit/sortable", "components/Sidebar.logic.ts", null],
])("resolves %s from %s", async (source, importer, standIn) => {
  const expected = standIn?.startsWith("\0") ? standIn : standIn && src(standIn);
  expect(await resolve(source, importer)).toBe(expected);
});

it("gives only the by-name icon lookup the whole icon set", async () => {
  expect(await resolve("lucide-react", "lib/lucideIconByName.ts")).toMatch(
    /cjs[\\/]lucide-react\.js$/,
  );
  expect(await resolve("lucide-react", "components/Sidebar.tsx")).toBeNull();
});
