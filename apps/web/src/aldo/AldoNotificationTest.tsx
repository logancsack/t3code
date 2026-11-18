// A test notification and what came of it, for the offer under a thread's
// working line and for Settings → Notifications: "Sent a test. It arrived.",
// or where to look when it didn't (notifications.ts testAldoNotifications).

import { useCallback, useEffect, useRef, useState } from "react";

import { testAldoNotifications, type AldoBrowser, type AldoTestState } from "./notifications";
import { aldoNotSeenHint, aldoTestMessage, aldoTestPending } from "./notifications.logic";

/**
 * Runs a test (again replaces the last), and stops listening when the component goes. `onGone`
 * hears when the test found this browser's subscription gone, so notifications are off here.
 */
export function useAldoNotificationTest(onGone?: () => void): {
  readonly state: AldoTestState | null;
  readonly run: () => void;
} {
  const [state, setState] = useState<AldoTestState | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const gone = useRef(onGone);
  useEffect(() => {
    gone.current = onGone;
  });
  useEffect(() => () => stop.current?.(), []);
  const run = useCallback(() => {
    stop.current?.();
    stop.current = testAldoNotifications((next) => {
      setState(next);
      if (next.phase === "failed" && next.gone) gone.current?.();
    });
  }, []);
  return { state, run };
}

const LINK = "font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-50";

/**
 * What the test says, announced as it changes. Once it arrived, "Didn't see
 * it?" opens where to look (the system can hide what the browser showed);
 * without a word from the device, it says where to look and offers another.
 */
export function AldoNotificationTestNote(props: {
  readonly state: AldoTestState;
  readonly browser: AldoBrowser;
  readonly onAgain: () => void;
}) {
  const [help, setHelp] = useState(false);
  const message = aldoTestMessage(props.state, props.browser);
  return (
    <span role="status" aria-live="polite">
      {message.text}
      {props.state.phase === "arrived" ? (
        help ? (
          ` ${aldoNotSeenHint(props.browser)}`
        ) : (
          <>
            {" "}
            <button type="button" className={LINK} onClick={() => setHelp(true)}>
              Didn’t see it?
            </button>
          </>
        )
      ) : null}
      {message.again ? (
        <>
          {" "}
          <button
            type="button"
            className={LINK}
            disabled={aldoTestPending(props.state)}
            onClick={props.onAgain}
          >
            Send another
          </button>
        </>
      ) : null}
    </span>
  );
}
