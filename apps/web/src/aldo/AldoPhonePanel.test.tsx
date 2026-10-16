import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { type AldoPhoneSettings } from "./accountApi";

const cloud = vi.hoisted(() => ({ read: vi.fn(), verify: vi.fn() }));
vi.mock("./accountApi", () => ({ aldoPhone: { verify: cloud.verify } }));
vi.mock("./settingsData", async () => {
  const { createSettingsResource } = await import("./settingsResource");
  return { settingsPhone: createSettingsResource<AldoPhoneSettings | null>(cloud.read) };
});
vi.mock("../components/settings/settingsLayout", () => ({
  SettingsSection: "section",
  SettingsRow: "div",
}));
vi.mock("../components/ui/button", () => ({ Button: "button" }));
vi.mock("../components/ui/input", () => ({ Input: "input" }));
vi.mock("../components/ui/switch", () => ({ Switch: "input" }));

import { AldoPhonePanel } from "./AldoPhonePanel";
import { settingsPhone } from "./settingsData";

let renderer: ReactTestRenderer;
afterEach(async () => {
  if (renderer) await act(() => renderer.unmount());
  vi.unstubAllGlobals();
});

it("clears a phone action error after a successful refresh while retaining the form", async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const settings: AldoPhoneSettings = {
    available: true,
    prototype: false,
    number: null,
    sms: true,
    voice: true,
    verified: false,
    phone: null,
    smsEnabled: false,
    voiceEnabled: false,
    hasPin: false,
    error: null,
    events: [],
    deliveries: [],
    calls: [],
  };
  settingsPhone.set(settings);
  cloud.verify.mockRejectedValue(new Error("Verification unavailable"));
  await act(() => {
    renderer = create(<AldoPhonePanel />);
  });
  const phone = () => renderer.root.findByType("input");
  await act(() => phone().props.onChange({ target: { value: "+14155550123" } }));
  await act(() => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  const alert = () => renderer.root.findAllByProps({ role: "alert" });
  expect(alert()).toHaveLength(1);
  expect(alert()[0]!.props.children).toContain("Verification unavailable");
  const refresh = () =>
    renderer.root.findAllByType("button").find((button) => button.props.children === "Refresh")!;
  cloud.read.mockRejectedValueOnce(new Error("Still offline"));
  await act(() => refresh().props.onClick());
  expect(alert()).toHaveLength(1);
  cloud.read.mockResolvedValueOnce(settings);
  await act(() => refresh().props.onClick());
  expect(alert()).toHaveLength(0);
  expect(phone().props.value).toBe("+14155550123");
});
