// Aldo's words for empty lists in T3's own panels: what will show there and how it gets there.

/** Settings → Archive, with nothing archived. */
export const ALDO_ARCHIVE_EMPTY = "Threads you archive show here, ready to bring back.";

/** Over the Files panel's tree while the thread's folder is empty. */
export function AldoFilesEmpty() {
  return (
    <p className="px-4 py-3 text-muted-foreground text-xs leading-relaxed">
      No files yet. What the agent makes and works with shows here as it goes.
    </p>
  );
}
