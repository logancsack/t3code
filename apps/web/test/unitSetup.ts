import type { ReactNode } from "react";
import { vi } from "vite-plus/test";

// GT's hooks need its provider and browser entry; unit tests that render get the source text.
vi.mock("gt-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("gt-react")>()),
  useGT:
    () =>
    (text: string, values: Record<string, unknown> = {}) =>
      text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key])),
  useMessages: () => (text: string) => text,
  T: ({ children }: { children: ReactNode }) => children,
  Var: ({ children }: { children: ReactNode }) => children,
}));
