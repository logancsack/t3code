import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { afterEach, expect, it } from "vite-plus/test";

import { selectThreadTerminalUiState, useTerminalUiStateStore } from "./terminalUiStateStore";

function reset() {
  useTerminalUiStateStore.persist.clearStorage();
  useTerminalUiStateStore.setState({
    terminalUiStateByThreadKey: {},
    suppressedTerminalIdsByThreadKey: {},
  });
}
afterEach(reset);

it("isolates terminal selection and cleanup when environments reuse a thread id", () => {
  reset();
  const thread = ThreadId.make("same-thread");
  const a = scopeThreadRef(EnvironmentId.make("environment-a"), thread);
  const b = scopeThreadRef(EnvironmentId.make("environment-b"), thread);
  const store = useTerminalUiStateStore.getState();
  const read = (ref: typeof a) =>
    selectThreadTerminalUiState(useTerminalUiStateStore.getState().terminalUiStateByThreadKey, ref);

  store.newTerminal(a, "terminal-a");
  store.newTerminal(b, "terminal-b");
  store.setTerminalOpen(b, false);
  expect(read(a)).toMatchObject({
    terminalOpen: true,
    terminalIds: ["terminal-a"],
    activeTerminalId: "terminal-a",
  });
  expect(read(b)).toMatchObject({
    terminalOpen: false,
    terminalIds: ["terminal-b"],
    activeTerminalId: "terminal-b",
  });

  store.clearTerminalUiState(a);
  expect(read(a).terminalIds).toEqual([]);
  expect(read(b).activeTerminalId).toBe("terminal-b");
});
