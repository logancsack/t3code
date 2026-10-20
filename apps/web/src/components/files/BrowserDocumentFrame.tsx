import { ExternalLinkIcon } from "lucide-react";

import { Button } from "../ui/button";
import { canShowPdfInFrame } from "./filePreviewMode";

/**
 * Chromium's viewer opens with its own toolbar, a thumbnail rail and a small
 * zoom. The panel header is the only chrome we want, so ask for the page
 * alone, fitted to the panel width. Pinch and keyboard zoom, scrolling, text
 * selection and find still work inside the frame.
 */
const PDF_VIEWER_FRAGMENT = "#toolbar=0&view=FitH";

export const isPdfPreviewFile = (path: string): boolean =>
  /\.pdf$/i.test(path.split(/[?#]/, 1)[0] ?? "");

/**
 * Renders an HTML or PDF document from its URL. HTML runs in a sandboxed frame
 * with an opaque origin, so a page cannot reach the app's session or storage.
 * The built-in PDF viewer needs an unsandboxed frame; a PDF runs no scripts.
 */
export function BrowserDocumentFrame(props: {
  readonly src: string;
  readonly title: string;
  readonly pdf: boolean;
}) {
  const className = "min-h-0 flex-1 border-0 bg-white";
  if (props.pdf && !canShowPdfInFrame(typeof navigator === "undefined" ? undefined : navigator)) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-muted-foreground text-sm">This browser can’t show the PDF here.</p>
        <Button
          variant="outline"
          size="sm"
          render={<a href={props.src} target="_blank" rel="noopener noreferrer" />}
        >
          <ExternalLinkIcon />
          Open the PDF
        </Button>
      </div>
    );
  }
  return props.pdf ? (
    // oxlint-disable-next-line react/iframe-missing-sandbox
    <iframe
      key={props.src}
      src={`${props.src}${PDF_VIEWER_FRAGMENT}`}
      title={props.title}
      className={className}
    />
  ) : (
    <iframe
      key={props.src}
      src={props.src}
      title={props.title}
      className={className}
      sandbox="allow-scripts allow-forms allow-popups allow-modals"
    />
  );
}
