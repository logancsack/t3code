import { beforeEach, expect, it, vi } from "vite-plus/test";

const io = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("./api", () => ({
  api: (...args: unknown[]) => io.api(...args),
  AldoApiError: class extends Error {},
  threadIdForEnvironment: () => "t",
}));
vi.mock("./directory", () => ({ aldoEnvironmentIdFor: (id: string) => `aldo-${id}` }));

import { holdAldoTurn } from "./threadApi";
import { ALDO_INLINE_MAX_CHARS } from "./held.logic";

beforeEach(() => io.api.mockReset().mockResolvedValue({}));

it("keeps an immediate image message immediate after uploading its image", async () => {
  const command = {
    type: "thread.turn.start",
    commandId: "c",
    threadId: "t",
    message: {
      text: "Look",
      attachments: [
        {
          type: "image",
          id: "a",
          name: "shot.png",
          mimeType: "image/png",
          sizeBytes: 1,
          dataUrl: `data:image/png;base64,${"A".repeat(ALDO_INLINE_MAX_CHARS)}`,
        },
      ],
    },
  };
  await holdAldoTurn("aldo-t", command, null, true);
  const call = io.api.mock.calls.find(([path]) => path.endsWith("/turns"));
  const held = JSON.parse(call![1].body).command;
  expect(held.aldoNow).toBe(true);
  expect(held.message.attachments[0].aldoUpload).toBeDefined();
  expect(held.message.attachments[0].dataUrl).toBeUndefined();
});
