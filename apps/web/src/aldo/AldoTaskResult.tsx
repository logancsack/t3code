import type { ScopedThreadRef } from "@t3tools/contracts";
import { lazy, Suspense } from "react";
import type { TaskResult } from "./taskResult.logic";
const Details = lazy(() => import("./AldoTaskResultDetails"));
export default function AldoTaskResult(props: {
  readonly result: TaskResult;
  readonly compact?: boolean;
  readonly cwd?: string | undefined;
  readonly threadRef?: ScopedThreadRef | undefined;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Reading result…</p>}>
      <Details {...props} />
    </Suspense>
  );
}
