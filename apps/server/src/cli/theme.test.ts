// @effect-diagnostics nodeBuiltinImport:off - CLI integration exercises the filesystem boundary.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/unstable/cli";

import { cli } from "../bin.ts";
import { symlinksSupported } from "@t3tools/shared/testing/symlinks";

const runCli = (args: ReadonlyArray<string>) =>
  Command.runWith(cli, { version: "0.0.0" })(args).pipe(
    Effect.provide(Layer.mergeAll(NodeServices.layer, NetService.layer, TestConsole.layer)),
  );

const NIGHTFALL_THEME_JSON = `${JSON.stringify({
  name: "Nightfall",
  appearance: "dark",
  canvas: "#1a1b26",
  accent: "#7aa2f7",
})}\n`;
it.effect.skipIf(!symlinksSupported)(
  "theme publishing never writes through a planted staging symlink",
  () =>
    Effect.gen(function* () {
      const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-theme-cli-"));
      try {
        const themesDir = NodePath.join(baseDir, "userdata", "themes");
        NodeFS.mkdirSync(themesDir, { recursive: true });
        const victim = NodePath.join(baseDir, "victim.txt");
        NodeFS.writeFileSync(victim, "precious");
        NodeFS.symlinkSync(
          victim,
          NodePath.join(themesDir, `nightfall.json.staging-${process.pid}`),
        );
        const themeFile = NodePath.join(baseDir, "nightfall.json");
        NodeFS.writeFileSync(themeFile, NIGHTFALL_THEME_JSON);
        NodeFS.writeFileSync(
          NodePath.join(baseDir, "userdata", "settings.json"),
          '{"futureSetting":{"keep":true}}',
        );
        yield* runCli(["theme", "set", themeFile, "--base-dir", baseDir]);
        assert.equal(NodeFS.readFileSync(victim, "utf8"), "precious");
        const settings = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(
            Schema.Struct({
              defaultTheme: Schema.String,
              futureSetting: Schema.Struct({ keep: Schema.Boolean }),
            }),
          ),
        )(NodeFS.readFileSync(NodePath.join(baseDir, "userdata", "settings.json"), "utf8"));
        assert.equal(settings.defaultTheme, "nightfall");
        assert.deepEqual(settings.futureSetting, { keep: true });
      } finally {
        NodeFS.rmSync(baseDir, { recursive: true, force: true });
      }
    }),
);
