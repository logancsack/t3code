// noVNC ships no types; Aldo's Desktop view uses this much of RFB.
declare module "@novnc/novnc" {
  export default class RFB extends EventTarget {
    constructor(
      target: HTMLElement,
      url: string,
      options?: { shared?: boolean; credentials?: Record<string, string> },
    );
    scaleViewport: boolean;
    resizeSession: boolean;
    focusOnClick: boolean;
    viewOnly: boolean;
    background: string;
    disconnect(): void;
    focus(): void;
  }
}
