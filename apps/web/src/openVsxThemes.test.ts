import { sha256 } from "@noble/hashes/sha2";
import JSZip from "jszip";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { importOpenVsxThemeExtension, type OpenVsxThemeExtension } from "./openVsxThemes";

afterEach(() => vi.unstubAllGlobals());

it("imports a verified VSIX and rejects the same package with a mismatched registry checksum", async () => {
  const root = "https://open-vsx.org/api/demo/theme/1.0.0/file";
  const extension: OpenVsxThemeExtension = {
    collectionId: "open-vsx:demo.theme",
    id: "demo.theme",
    name: "Demo Theme",
    publisher: "demo",
    description: "",
    downloadCount: 1,
    iconUrl: null,
    sourceUrl: null,
    license: "MIT",
    version: "1.0.0",
    manifestUrl: `${root}/package.json`,
    sha256Url: `${root}/theme.sha256`,
    vsixUrl: `${root}/theme.vsix`,
  };
  const manifest = {
    name: "theme",
    publisher: "demo",
    version: "1.0.0",
    license: "MIT",
    contributes: { themes: [{ label: "Demo Dark", uiTheme: "vs-dark", path: "./theme.json" }] },
  };
  const zip = new JSZip();
  zip.file("extension/package.json", JSON.stringify(manifest));
  zip.file(
    "extension/theme.json",
    JSON.stringify({
      name: "Demo Dark",
      type: "dark",
      colors: { "editor.background": "#101010", "editor.foreground": "#eeeeee" },
      tokenColors: [],
    }),
  );
  const bytes = await zip.generateAsync({ type: "uint8array" });
  let checksum = [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === extension.manifestUrl) return new Response(JSON.stringify(manifest));
      if (url === extension.sha256Url) return new Response(`${checksum}  theme.vsix`);
      if (url === extension.vsixUrl) return new Response(new Uint8Array(bytes));
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
  expect(await importOpenVsxThemeExtension(extension)).toHaveLength(1);
  checksum = "0".repeat(64);
  await expect(importOpenVsxThemeExtension(extension)).rejects.toThrow("integrity check");
});
