import { RotateCcw } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Button } from "../components/ui/button";
import { getDemoPreviewDocument, resetDemoFiles, subscribeDemoPreview } from "./runtime";

export function LandingDemoPreviewPanel() {
  const document = useSyncExternalStore(
    subscribeDemoPreview,
    getDemoPreviewDocument,
    getDemoPreviewDocument,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-400" />
          <span className="truncate text-xs text-muted-foreground">
            Browser preview · browser memory
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Reset demo project"
          onClick={resetDemoFiles}
        >
          <RotateCcw className="size-3.5" />
        </Button>
      </div>
      <iframe
        srcDoc={document}
        title="Browser-local project preview"
        className="min-h-0 w-full flex-1 border-0 bg-white"
        sandbox=""
      />
    </div>
  );
}
