// @effect-diagnostics-next-line nodeBuiltinImport:off -- A Vite plugin runs before any Effect runtime.
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- A Vite plugin runs before any Effect runtime.
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import type { Plugin } from "vite-plus";

const SRC = NodeURL.fileURLToPath(new URL("../src/", import.meta.url));
const STAND_INS = NodePath.join(SRC, "aldo/deferred/");

// Stand-ins that replace only what these files import; their other importers load with the
// thread view and keep the real module.
const ONLY_FROM: Readonly<Record<string, string>> = {
  "components/chat/GuestShareControls.tsx": "routes/__root.tsx",
  "components/sidebar/SidebarChrome.tsx": "components/AppSidebarLayout.tsx",
  "components/sidebar/updateEverythingRun.tsx": "appInit.tsx",
  // The route's own module, not the page component the router splits out of it.
  "components/settings/settingsSearch.ts": "routes/_chat.settings.tsx",
};

// Modules the home screen's own files take only pure functions from. Those files share one
// copy, shaken down to what they use; every other importer shares the real module, off Home.
// Never for a function that reads or writes its module's state: the copy has its own.
const OWN_COPY: Readonly<Record<string, ReadonlyArray<string>>> = {
  "components/SidebarStageBackdrop.tsx": ["components/AppSidebarLayout.tsx"],
  "components/Sidebar.logic.ts": [
    "aldo/preload.ts",
    "aldo/sidebarOrder.logic.ts",
    "appInit.tsx",
    "hooks/useHandleNewThread.ts",
    "routes/_chat.index.tsx?tsr-split=component",
    "shortcuts/chatRouteCommands.ts",
  ],
  "components/settings/scheduledTasksSettings.logic.ts": [
    "routes/_chat.settings.scheduled-tasks.tsx",
  ],
};

const OWN = "?own";
// What a copy imports but none of its kept functions call: resolved to nothing, so the library
// stays off Home. Another import from one of these fails the build until it is listed here.
const UNUSED_IN_COPY: Readonly<Record<string, ReadonlyArray<string>>> = {
  "@dnd-kit/sortable": ["defaultAnimateLayoutChanges"],
};
const UNUSED = "\0aldo-unused:";

// Aldo's cloud build ships English only: GT's runtime gives way to an English passthrough.
const GT_ENGLISH = NodePath.join(SRC, "aldo/gtEnglish.tsx");

const withoutQuery = (id: string) => id.replace(/\?.*$/, "");
// A route's split-out component keeps its query, so it is told apart from the route's module.
const importerFile = (id: string) => (id.includes("tsr-split=") ? id : withoutQuery(id));

/**
 * Keeps upstream modules Aldo's home screen doesn't show out of its first download. A module
 * under src/ with a stand-in at the same path under src/aldo/deferred/ resolves to the stand-in,
 * which loads the real one when it is first needed. A stand-in without an export its importers
 * ask for fails the build. Only the Aldo cloud build uses this.
 */
export function aldoDeferredModulesPlugin(): Plugin {
  const standIns = new Map<string, string>();
  for (const entry of NodeFS.readdirSync(STAND_INS, { recursive: true, encoding: "utf8" })) {
    if (NodeFS.existsSync(NodePath.join(SRC, entry)) && /\.tsx?$/.test(entry)) {
      standIns.set(NodePath.join(SRC, entry), NodePath.join(STAND_INS, entry));
    }
  }
  const names = new Set(
    [...standIns.keys(), ...Object.keys(OWN_COPY)].map((file) => NodePath.parse(file).name),
  );
  // lucide-react's one-file CommonJS build: the icon picker's by-name lookup needs every icon, and
  // importing the package there would put them all in the first download with the icons in use.
  const lucideWhole = NodeModule.createRequire(import.meta.url).resolve("lucide-react");

  // The dev server bundles nothing, so it has no use for copies; it keeps one module each.
  let building = true;

  return {
    name: "aldo:deferred-modules",
    enforce: "pre",
    configResolved(config) {
      building = config.command === "build";
    },
    async resolveId(source, importer, options) {
      if (!importer) return null;
      const from = importerFile(importer);
      if (source === "gt-react" || source === "gt-i18n") return GT_ENGLISH;
      if (importer.endsWith(OWN) && source in UNUSED_IN_COPY) return UNUSED + source;
      if (source === "lucide-react") {
        return from === NodePath.join(SRC, "lib/lucideIconByName.ts") ? lucideWhole : null;
      }
      if (!names.has(NodePath.parse(withoutQuery(source)).name)) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      const copiers =
        resolved && building ? OWN_COPY[NodePath.relative(SRC, resolved.id)] : undefined;
      if (resolved && copiers?.some((file) => from === NodePath.join(SRC, file))) {
        return resolved.id + OWN;
      }
      const standIn = resolved ? standIns.get(resolved.id) : undefined;
      if (!resolved || !standIn || from === standIn) return null;
      const only = ONLY_FROM[NodePath.relative(SRC, resolved.id)];
      return only === undefined || from === NodePath.join(SRC, only) ? standIn : null;
    },
    load(id) {
      if (!id.startsWith(UNUSED)) return null;
      const names = UNUSED_IN_COPY[id.slice(UNUSED.length)] ?? [];
      return names.map((name) => `export const ${name} = undefined;`).join("\n");
    },
  };
}
