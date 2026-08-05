import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { MuseSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  buildInitialMuseProviderSnapshot,
  checkMuseProviderStatus,
  hasStoredMuseCredential,
  parseMuseCliVersion,
  parseMuseSkillsListOutput,
} from "./MuseProvider.ts";

const decodeMuseSettings = Schema.decodeSync(MuseSettings);
const encodeUnknownJson = Schema.encodeUnknownSync(Schema.UnknownFromJsonString);

describe("buildInitialMuseProviderSnapshot", () => {
  it.effect("publishes the built-in Muse model and reasoning controls", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialMuseProviderSnapshot(decodeMuseSettings({}));
      expect(snapshot.displayName).toBe("Muse Code");
      expect(snapshot.badgeLabel).toBe("Beta");
      expect(snapshot.showInteractionModeToggle).toBe(true);
      expect(snapshot.status).toBe("warning");
      expect(snapshot.models).toHaveLength(1);
      expect(snapshot.models[0]).toMatchObject({
        slug: "muse-spark-1.2",
        name: "Muse Spark 1.2",
        isDefault: true,
      });
      expect(snapshot.models[0]?.capabilities?.optionDescriptors).toEqual([
        {
          id: "reasoningEffort",
          label: "Reasoning",
          type: "select",
          options: [
            { id: "none", label: "None" },
            { id: "minimal", label: "Minimal" },
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "high", label: "High", isDefault: true },
            { id: "xhigh", label: "Extra high" },
            { id: "ultra", label: "Ultra" },
          ],
          currentValue: "high",
        },
      ]);
    }),
  );

  it.effect("returns a disabled snapshot when Muse is disabled", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialMuseProviderSnapshot(
        decodeMuseSettings({ enabled: false }),
      );
      expect(snapshot.enabled).toBe(false);
      expect(snapshot.status).toBe("disabled");
      expect(snapshot.installed).toBe(false);
      expect(snapshot.message).toContain("disabled");
    }),
  );
});

describe("parseMuseCliVersion", () => {
  it("prefers Meta's release build identifier", () => {
    expect(parseMuseCliVersion("Muse Code 0.1.0 (0.1.0-R708.1)")).toBe("0.1.0-R708.1");
  });
});

describe("parseMuseSkillsListOutput", () => {
  it("maps Muse skill metadata and activation states", () => {
    expect(
      parseMuseSkillsListOutput(
        encodeUnknownJson({
          diagnostics: [],
          skills: [
            {
              activation: "on",
              description: "Create a grounded plan.",
              display_name: "Plan",
              name: "plan",
              path: "bundled://muse-core/skills/plan/SKILL.md",
              scope: "bundled",
              short_description: "Plan before implementing",
            },
            {
              activation: "user-invocable-only",
              name: "doctor",
              path: "/config/muse/skills/doctor/SKILL.md",
              scope: "user",
            },
            {
              activation: "off",
              name: "disabled-skill",
              path: "/workspace/.muse/skills/disabled-skill/SKILL.md",
              scope: "project",
            },
            { activation: "on", name: "missing-path" },
          ],
        }),
      ),
    ).toEqual([
      {
        name: "plan",
        path: "bundled://muse-core/skills/plan/SKILL.md",
        enabled: true,
        description: "Create a grounded plan.",
        scope: "bundled",
        displayName: "Plan",
        shortDescription: "Plan before implementing",
      },
      {
        name: "doctor",
        path: "/config/muse/skills/doctor/SKILL.md",
        enabled: true,
        scope: "user",
      },
      {
        name: "disabled-skill",
        path: "/workspace/.muse/skills/disabled-skill/SKILL.md",
        enabled: false,
        scope: "project",
      },
    ]);
  });

  it("treats malformed output as an empty inventory", () => {
    expect(parseMuseSkillsListOutput("not-json")).toEqual([]);
    expect(parseMuseSkillsListOutput(encodeUnknownJson({ skills: "not-an-array" }))).toEqual([]);
  });
});

it.layer(NodeServices.layer)("checkMuseProviderStatus", (it) => {
  it.effect("reports a missing Muse binary", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkMuseProviderStatus(
        decodeMuseSettings({ binaryPath: "/definitely/not/installed/muse" }),
      );
      expect(snapshot.installed).toBe(false);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toContain("not installed");
    }),
  );

  it.effect("probes the full release version without allowing auto-update", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-muse-version-" });
        const binaryPath = path.join(directory, "muse");
        yield* fs.writeFileString(
          binaryPath,
          [
            "#!/bin/sh",
            '[ "$MUSE_NO_AUTO_UPDATE" = "1" ] || exit 9',
            'printf "%s\\n" "Muse Code 0.1.0 (0.1.0-R708.1)"',
            "",
          ].join("\n"),
        );
        yield* fs.chmod(binaryPath, 0o755);

        const snapshot = yield* checkMuseProviderStatus(
          decodeMuseSettings({ binaryPath, customModels: ["muse-spark-preview"] }),
          { ...process.env, META_API_KEY: "test-key-not-logged" },
        );
        expect(snapshot.installed).toBe(true);
        expect(snapshot.status).toBe("ready");
        expect(snapshot.version).toBe("0.1.0-R708.1");
        expect(snapshot.auth).toEqual({
          status: "authenticated",
          type: "meta",
          label: "Meta API key",
        });
        expect(snapshot.models.map((model) => model.slug)).toEqual([
          "muse-spark-1.2",
          "muse-spark-preview",
        ]);
      }),
    ),
  );

  it.effect("discovers native skills with the instance binary, environment, and workspace", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-muse-skills-" });
        const workspace = path.join(directory, "workspace");
        const binaryPath = path.join(directory, "muse");
        yield* fs.makeDirectory(workspace, { recursive: true });
        yield* fs.writeFileString(
          binaryPath,
          [
            "#!/bin/sh",
            '[ "$MUSE_NO_AUTO_UPDATE" = "1" ] || exit 9',
            '[ "$MUSE_INSTANCE_MARKER" = "instance-env" ] || exit 8',
            'if [ "$1" = "--version" ]; then',
            '  printf "%s\\n" "Muse Code 0.1.0 (0.1.0-R708.1)"',
            "  exit 0",
            "fi",
            '[ "$PWD" = "$MUSE_EXPECTED_WORKSPACE" ] || exit 7',
            '[ "$#" -eq 8 ] || exit 6',
            '[ "$1" = "skills" ] && [ "$2" = "list" ] || exit 5',
            '[ "$3" = "--json" ] && [ "$4" = "--source" ] && [ "$5" = "all" ] || exit 4',
            '[ "$6" = "--workspace" ] && [ "$7" = "$MUSE_EXPECTED_WORKSPACE" ] || exit 3',
            '[ "$8" = "--trust-workspace" ] || exit 2',
            `printf '%s\\n' '${encodeUnknownJson({
              diagnostics: [],
              skills: [
                {
                  activation: "on",
                  description: "Import another coding-agent session.",
                  display_name: "Import",
                  name: "import",
                  path: "bundled://muse-core/skills/import/SKILL.md",
                  scope: "bundled",
                  short_description: "Import a prior session",
                },
              ],
            })}'`,
            "",
          ].join("\n"),
        );
        yield* fs.chmod(binaryPath, 0o755);

        const snapshot = yield* checkMuseProviderStatus(
          decodeMuseSettings({ binaryPath }),
          {
            ...process.env,
            META_API_KEY: "test-key-not-logged",
            MUSE_EXPECTED_WORKSPACE: workspace,
            MUSE_INSTANCE_MARKER: "instance-env",
          },
          workspace,
        );

        expect(snapshot.status).toBe("ready");
        expect(snapshot.skills).toEqual([
          {
            name: "import",
            path: "bundled://muse-core/skills/import/SKILL.md",
            enabled: true,
            description: "Import another coding-agent session.",
            scope: "bundled",
            displayName: "Import",
            shortDescription: "Import a prior session",
          },
        ]);
      }),
    ),
  );

  it.effect("reports configured Muse credentials without exposing their values", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-muse-auth-" });
        const configHome = path.join(directory, "config");
        const authDirectory = path.join(configHome, "muse");
        const binaryPath = path.join(directory, "muse");
        yield* fs.makeDirectory(authDirectory, { recursive: true });
        yield* fs.writeFileString(
          path.join(authDirectory, "auth.json"),
          encodeUnknownJson({
            schema_version: 1,
            providers: { meta: { oauth: { refresh_token: "stored-secret" } } },
          }),
        );
        yield* fs.writeFileString(
          binaryPath,
          ["#!/bin/sh", 'printf "%s\\n" "Muse Code 0.1.0 (0.1.0-R708.1)"', ""].join("\n"),
        );
        yield* fs.chmod(binaryPath, 0o755);

        const environment = { ...process.env, XDG_CONFIG_HOME: configHome, META_API_KEY: "" };
        expect(yield* hasStoredMuseCredential(environment)).toBe(true);
        const snapshot = yield* checkMuseProviderStatus(
          decodeMuseSettings({ binaryPath }),
          environment,
        );
        expect(snapshot.auth).toEqual({
          status: "authenticated",
          type: "meta",
          label: "Meta credentials",
        });
        expect(encodeUnknownJson(snapshot)).not.toContain("stored-secret");
      }),
    ),
  );

  it.effect("reports definitively absent Muse credentials as unauthenticated", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-muse-no-auth-" });
        const configHome = path.join(directory, "config");
        const binaryPath = path.join(directory, "muse");
        yield* fs.makeDirectory(configHome, { recursive: true });
        yield* fs.writeFileString(
          binaryPath,
          ["#!/bin/sh", 'printf "%s\\n" "Muse Code 0.1.0 (0.1.0-R708.1)"', ""].join("\n"),
        );
        yield* fs.chmod(binaryPath, 0o755);

        const snapshot = yield* checkMuseProviderStatus(decodeMuseSettings({ binaryPath }), {
          ...process.env,
          XDG_CONFIG_HOME: configHome,
          META_API_KEY: "",
        });

        expect(snapshot.status).toBe("error");
        expect(snapshot.auth).toEqual({ status: "unauthenticated" });
        expect(snapshot.message).toContain("Use Connect");
      }),
    ),
  );

  it.effect("preserves unknown auth when no credential root can be resolved", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({
          prefix: "t3code-muse-auth-unknown-",
        });
        const binaryPath = path.join(directory, "muse");
        yield* fs.writeFileString(
          binaryPath,
          ["#!/bin/sh", 'printf "%s\\n" "Muse Code 0.1.0 (0.1.0-R708.1)"', ""].join("\n"),
        );
        yield* fs.chmod(binaryPath, 0o755);

        const snapshot = yield* checkMuseProviderStatus(decodeMuseSettings({ binaryPath }), {
          HOME: "",
          XDG_CONFIG_HOME: "",
          META_API_KEY: "",
        });

        expect(snapshot.status).toBe("ready");
        expect(snapshot.auth).toEqual({ status: "unknown" });
      }),
    ),
  );

  it.effect("preserves unknown auth for an unfamiliar credential schema", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-muse-auth-schema-" });
        const configHome = path.join(directory, "config");
        const authDirectory = path.join(configHome, "muse");
        const binaryPath = path.join(directory, "muse");
        yield* fs.makeDirectory(authDirectory, { recursive: true });
        yield* fs.writeFileString(
          path.join(authDirectory, "auth.json"),
          encodeUnknownJson({ schema_version: 2, providers: {} }),
        );
        yield* fs.writeFileString(
          binaryPath,
          ["#!/bin/sh", 'printf "%s\\n" "Muse Code 0.1.0 (0.1.0-R708.1)"', ""].join("\n"),
        );
        yield* fs.chmod(binaryPath, 0o755);

        const snapshot = yield* checkMuseProviderStatus(decodeMuseSettings({ binaryPath }), {
          ...process.env,
          XDG_CONFIG_HOME: configHome,
          META_API_KEY: "",
        });

        expect(snapshot.status).toBe("ready");
        expect(snapshot.auth).toEqual({ status: "unknown" });
      }),
    ),
  );

  it.effect("preserves unknown auth when the credential record is unreadable", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-muse-auth-mode-" });
        const configHome = path.join(directory, "config");
        const authDirectory = path.join(configHome, "muse");
        const authPath = path.join(authDirectory, "auth.json");
        const binaryPath = path.join(directory, "muse");
        yield* fs.makeDirectory(authDirectory, { recursive: true });
        yield* fs.writeFileString(
          authPath,
          encodeUnknownJson({
            schema_version: 1,
            providers: { meta: { api_key: "must-not-be-inspected" } },
          }),
        );
        yield* fs.chmod(authPath, 0o000);
        yield* fs.writeFileString(
          binaryPath,
          ["#!/bin/sh", 'printf "%s\\n" "Muse Code 0.1.0 (0.1.0-R708.1)"', ""].join("\n"),
        );
        yield* fs.chmod(binaryPath, 0o755);

        const snapshot = yield* checkMuseProviderStatus(decodeMuseSettings({ binaryPath }), {
          ...process.env,
          XDG_CONFIG_HOME: configHome,
          META_API_KEY: "",
        });
        yield* fs.chmod(authPath, 0o600);

        expect(snapshot.status).toBe("ready");
        expect(snapshot.auth).toEqual({ status: "unknown" });
      }),
    ),
  );

  it.effect("does not treat an empty or malformed Muse auth file as authenticated", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-muse-auth-empty-" });
        const configHome = path.join(directory, "config");
        const authDirectory = path.join(configHome, "muse");
        yield* fs.makeDirectory(authDirectory, { recursive: true });
        yield* fs.writeFileString(
          path.join(authDirectory, "auth.json"),
          encodeUnknownJson({ schema_version: 1, providers: {} }),
        );

        expect(
          yield* hasStoredMuseCredential({ ...process.env, XDG_CONFIG_HOME: configHome }),
        ).toBe(false);
        yield* fs.writeFileString(path.join(authDirectory, "auth.json"), "not-json");
        expect(
          yield* hasStoredMuseCredential({ ...process.env, XDG_CONFIG_HOME: configHome }),
        ).toBe(false);
      }),
    ),
  );
});
