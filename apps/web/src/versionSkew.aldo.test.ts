import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("./aldo/cloud", () => ({ isAldoCloud: true }));
vi.mock("./branding", () => ({ APP_VERSION: "0.0.44" }));

import { resolveVersionMismatch } from "./versionSkew";

describe("versionSkew in Aldo", () => {
  it("reports no update for an older server, since Aldo updates its machines", () => {
    expect(resolveVersionMismatch("0.0.38")).toBeNull();
  });
});
