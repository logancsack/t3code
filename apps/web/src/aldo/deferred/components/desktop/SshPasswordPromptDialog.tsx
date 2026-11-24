import { deferred } from "../../../deferred";

const load = () => import("../../../../components/desktop/SshPasswordPromptDialog");
const Dialog = deferred(() => load().then((m) => m.SshPasswordPromptDialog));

export function startSshPasswordPromptQueue(): () => void {
  if (!window.desktopBridge) return () => undefined;
  const stop = load().then((m) => m.startSshPasswordPromptQueue());
  return () => void stop.then((dispose) => dispose());
}

export function SshPasswordPromptDialog() {
  return window.desktopBridge ? <Dialog /> : null;
}
