import type { ScopedThreadRef } from "@t3tools/contracts";
import { CheckIcon, MinusIcon } from "lucide-react";
import ChatMarkdown from "../components/ChatMarkdown";
import type { TaskResult } from "./taskResult.logic";

/** Evidence the agent reported, kept distinct from independently verified actions. */
export default function AldoTaskResult(props: {
  readonly result: TaskResult;
  readonly compact?: boolean;
  readonly cwd?: string | undefined;
  readonly threadRef?: ScopedThreadRef | undefined;
}) {
  const r = props.result;
  const checks = (
    <>
      {r.checked.length > 0 ? (
        <div>
          <p className="font-medium">Checked</p>
          <ul className="space-y-1">
            {r.checked.map((line, i) => (
              <li key={`${i}:${line}`}>
                <ChatMarkdown cwd={props.cwd} threadRef={props.threadRef} text={line} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {r.notChecked.length > 0 ? (
        <div>
          <p className="font-medium">Not checked</p>
          <ul className="space-y-1">
            {r.notChecked.map((line, i) => (
              <li key={`${i}:${line}`}>
                <ChatMarkdown cwd={props.cwd} threadRef={props.threadRef} text={line} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {r.decided.length > 0 ? (
        <div>
          <p className="font-medium">Decisions</p>
          <ul className="space-y-2">
            {r.decided.map((d, i) => (
              <li key={`${i}:${d.what}`}>
                <ChatMarkdown cwd={props.cwd} threadRef={props.threadRef} text={d.what} />
                <p>{d.why}</p>
                <p>Undo: {d.undo}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
  return (
    <section
      aria-label="Task result"
      className="my-3 flex min-w-0 flex-col gap-3 break-words text-[13px] leading-5 [overflow-wrap:anywhere]"
    >
      <div>
        <p className="font-medium">
          {r.state === "finished"
            ? "Reported complete"
            : r.state === "blocked_on_user"
              ? "Needs you"
              : "Unfinished"}
        </p>
        <p className="text-muted-foreground">Agent’s report</p>
      </div>
      {r.problem ? (
        <p role="status" className="text-muted-foreground">
          {r.problem}
        </p>
      ) : null}
      <ul className="space-y-3">
        {r.doneWhen.map((item, i) => (
          <li key={`${i}:${item.criterion}`} className="flex min-w-0 gap-2">
            {item.met ? (
              <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-success-foreground" />
            ) : (
              <MinusIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                <span className="sr-only">{item.met ? "Met: " : "Not met: "}</span>
                {item.criterion}
              </p>
              <div className="text-muted-foreground">
                <ChatMarkdown cwd={props.cwd} threadRef={props.threadRef} text={item.evidence} />
              </div>
            </div>
          </li>
        ))}
      </ul>
      {r.checked.length + r.notChecked.length + r.decided.length > 0 ? (
        props.compact ? (
          <details>
            <summary className="min-h-10 cursor-pointer py-2">Checks and decisions</summary>
            <div className="flex flex-col gap-3">{checks}</div>
          </details>
        ) : (
          checks
        )
      ) : null}
    </section>
  );
}
