// Whether the call screen (AldoCallScreen.tsx) is folded away on a phone: the
// chevron folds it and the call goes on; the composer's talk button and the
// capsule bring it back, and each call opens it again.

import { create } from "zustand";

export const useAldoCallView = create<{ readonly minimized: boolean }>(() => ({
  minimized: false,
}));

export function showAldoCall(): void {
  useAldoCallView.setState({ minimized: false });
}

export function minimizeAldoCall(): void {
  useAldoCallView.setState({ minimized: true });
}
