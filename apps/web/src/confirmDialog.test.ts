import { afterEach, expect, it } from "vite-plus/test";

import {
  completeConfirmDialogClose,
  readConfirmDialogState,
  registerConfirmDialogHost,
  requestConfirmDialog,
  resetConfirmDialogForTests,
  respondToConfirmDialog,
} from "./confirmDialog";

afterEach(resetConfirmDialogForTests);

it("keeps concurrent and closing-transition confirmations paired with their callers", async () => {
  const unregister = registerConfirmDialogHost();
  const first = requestConfirmDialog("Delete project A?", { variant: "destructive" });
  const second = requestConfirmDialog("Delete project B?", { variant: "destructive" });
  expect(first).toBeInstanceOf(Promise);
  expect(second).toBeInstanceOf(Promise);
  let secondResolved = false;
  void second?.then(() => {
    secondResolved = true;
  });

  respondToConfirmDialog(false);
  await expect(first).resolves.toBe(false);
  const third = requestConfirmDialog("Delete project C?");
  respondToConfirmDialog(true);
  expect(secondResolved).toBe(false);
  expect(readConfirmDialogState().status).toBe("closing");

  completeConfirmDialogClose();
  expect(readConfirmDialogState()).toMatchObject({
    status: "confirming",
    message: "Delete project B?",
  });
  respondToConfirmDialog(true);
  await expect(second).resolves.toBe(true);
  completeConfirmDialogClose();
  expect(readConfirmDialogState()).toMatchObject({
    status: "confirming",
    message: "Delete project C?",
  });

  unregister();
  await expect(third).resolves.toBe(false);
  expect(readConfirmDialogState().status).toBe("idle");
});
