import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";

// Regression guard for the uniwind platform-variant leak (audit #15 / #13161):
// Tailwind groups every `ios:` (or `android:`) utility into one shared
// `@media ios { ... }` block, and uniwind's CSS processor used to drop the
// block's media queries after its first nested rule. Everything past the first
// utility compiled unguarded and shipped to both platforms. These tests run
// the installed (patched) uniwind compiler over real Tailwind output, per
// platform, and assert what each bundle receives. The compiler itself runs in
// a plain Node child process (uniwind-platform-variants.fixture.cjs) so no
// test-runner module transforms sit between the test and the shipped code.

interface CompiledStyle {
  native: boolean;
  minWidth: number;
  maxWidth: number;
  active: boolean | null;
  focus: boolean | null;
  disabled: boolean | null;
  dataAttributes: Record<string, string> | null;
}

interface FixtureOutput {
  tailwindChecks: {
    iosBlocks: number;
    androidBlocks: number;
    iosUtilities: number;
    androidUtilities: number;
  };
  transformerCheck: {
    reinitPayload: boolean;
    fingerprintArg: boolean;
    themesArg: boolean;
  };
  platforms: Record<
    string,
    {
      styles: Record<string, CompiledStyle[] | undefined>;
      payloadIncludesAllCompiled: boolean;
      payloadLeaks: string[];
    }
  >;
}

// Mirrors the classNames the audits flagged: multiple platform utilities per
// block (only the first one used to keep its guard), a base utility overridden
// by an `ios:` variant (NewTaskDraftScreen), and opposing `ios:`/`android:`
// font families (worktree-setup-card).
const FIXTURE_SOURCE = `export const Probe = () => (
  <div className="android:shrink android:grow-0 ios:flex-1 pt-12 ios:pt-[72px] ios:font-[family-name:Menlo] android:font-mono flex-1 sm:p-6 sm:text-lg container-x foo-x active:opacity-50 disabled:opacity-50 data-x:underline aria-disabled:text-red-500" />
);
`;

const IOS_CLASSES = ["ios:flex-1", "ios:pt-[72px]", "ios:font-[family-name:Menlo]"];
const ANDROID_CLASSES = ["android:shrink", "android:grow-0", "android:font-mono"];
const SHARED_CLASSES = ["flex-1", "pt-12"];
const RESPONSIVE_CLASSES = ["sm:p-6", "sm:text-lg"];

const runFixture = (globalCss: string, probeSource: string): FixtureOutput => {
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "uniwind-platform-"));
  try {
    // So `@import "tailwindcss"` and `@import "uniwind"` resolve like in the app.
    NodeFS.symlinkSync(
      NodeFS.realpathSync(new URL("../../node_modules", import.meta.url)),
      NodePath.join(tempDir, "node_modules"),
      "dir",
    );
    NodeFS.writeFileSync(NodePath.join(tempDir, "global.css"), globalCss);
    NodeFS.writeFileSync(NodePath.join(tempDir, "Probe.tsx"), probeSource);

    const fixture = NodeURL.fileURLToPath(
      new URL("./uniwind-platform-variants.fixture.cjs", import.meta.url),
    );
    const stdout = NodeChildProcess.execFileSync(process.execPath, [fixture, tempDir], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: 60_000,
    });
    // The fixture's compiler may log warnings to stdout before the JSON payload.
    const start = stdout.indexOf('{"tailwindChecks"');
    if (start === -1) {
      throw new Error(`Fixture produced no JSON:\n${stdout}`);
    }
    return JSON.parse(stdout.slice(start)) as FixtureOutput;
  } finally {
    NodeFS.rmSync(tempDir, { recursive: true, force: true });
  }
};

it("the shipped compiler preserves platform, breakpoint and selector guards in native bundles", () => {
  const output = runFixture(
    [
      '@import "tailwindcss";',
      '@import "uniwind";',
      ".container-x { width: 100%; @media (width >= 40rem) { max-width: 40rem; } }",
      "@utility foo-x { padding: 2px; @variant ios { padding: 3px; } }",
    ].join("\n"),
    FIXTURE_SOURCE,
  );
  // Multiple utilities in one media block are necessary to reproduce the leak.
  expect(output.tailwindChecks.iosBlocks).toBeGreaterThan(0);
  expect(output.tailwindChecks.androidBlocks).toBeGreaterThan(0);
  expect(output.tailwindChecks).toMatchObject({
    iosUtilities: 3,
    androidUtilities: 3,
  });
  for (const [platform, own, foreign] of [
    ["ios", IOS_CLASSES, ANDROID_CLASSES],
    ["android", ANDROID_CLASSES, IOS_CLASSES],
  ] as const) {
    const bundle = output.platforms[platform]!;
    for (const name of own) {
      expect(bundle.styles[name]?.length, `${platform} lacks ${name}`).toBeGreaterThan(0);
      expect(bundle.styles[name]?.every((style) => style.native)).toBe(true);
    }
    for (const name of foreign)
      expect(bundle.styles[name], `${platform} leaks ${name}`).toBeUndefined();
    for (const name of [...SHARED_CLASSES, ...RESPONSIVE_CLASSES]) {
      expect(bundle.styles[name]?.length).toBeGreaterThan(0);
      expect(bundle.styles[name]?.every((style) => !style.native)).toBe(true);
    }
    for (const name of RESPONSIVE_CLASSES)
      expect(bundle.styles[name]?.at(-1)?.minWidth).toBeGreaterThan(0);
    const nested = bundle.styles["container-x"];
    expect(nested?.some((style) => !style.native && style.minWidth === 0)).toBe(true);
    expect(nested?.some((style) => !style.native && style.minWidth > 0)).toBe(true);
    expect(bundle.styles["foo-x"]?.some((style) => !style.native)).toBe(true);
    expect(bundle.styles["foo-x"]?.some((style) => style.native)).toBe(platform === "ios");
    for (const name of ["active:opacity-50", "disabled:opacity-50", "data-x:underline"]) {
      expect(bundle.styles[name]?.length).toBeGreaterThan(0);
    }
    expect(bundle.styles["active:opacity-50"]?.every((style) => style.active === true)).toBe(true);
    expect(bundle.styles["disabled:opacity-50"]?.every((style) => style.disabled === true)).toBe(
      true,
    );
    expect(
      bundle.styles["data-x:underline"]?.every((style) => style.dataAttributes?.["data-x"]),
    ).toBe(true);
    expect(bundle.styles).not.toHaveProperty("aria-disabled:text-red-500");
    expect(bundle.payloadIncludesAllCompiled).toBe(true);
    expect(bundle.payloadLeaks).toEqual([]);
  }
  expect(output.transformerCheck).toEqual({
    reinitPayload: true,
    fingerprintArg: true,
    themesArg: true,
  });
}, 60_000);
