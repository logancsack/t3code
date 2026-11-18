// @vitest-environment jsdom

import { ApprovalRequestId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";

it("dispatches the provider's approval decisions and blocks them while responding", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const requestId = ApprovalRequestId.make("approval-1");
  const respond = vi.fn(async () => undefined);
  const render = async (isResponding: boolean) => {
    await act(async () =>
      root.render(
        <ComposerPendingApprovalActions
          requestId={requestId}
          isResponding={isResponding}
          options={[
            { decision: "accept", label: "Allow once" },
            { decision: "decline", label: "Deny" },
            { decision: "acceptAlways", label: "Always allow Safari" },
          ]}
          onRespondToApproval={respond}
        />,
      ),
    );
  };
  const decision = (label: string) => {
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === label);
    expect(button, label).toBeDefined();
    return button!;
  };
  try {
    await render(false);
    expect(container.textContent).not.toContain("Always allow Safari");
    await act(async () => decision("Allow once").click());
    expect(respond).toHaveBeenLastCalledWith(requestId, "accept");
    await act(async () => decision("Deny").click());
    expect(respond).toHaveBeenLastCalledWith(requestId, "decline");

    await render(true);
    await act(async () => {
      decision("Allow once").click();
      decision("Deny").click();
      container.querySelector<HTMLButtonElement>('[aria-label="More approval options"]')!.click();
    });
    expect(respond).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
