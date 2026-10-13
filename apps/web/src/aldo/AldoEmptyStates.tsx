// Aldo's words for empty lists in T3's own panels: what will show there and
// how it gets there, in Aldo's terms (a thread's helpers, not subagents).

/** The thread's helpers (T3's Agents panel), before its agent starts any. */
export const ALDO_HELPERS_EMPTY = {
  title: "No helpers yet",
  description:
    "When this thread's agent starts helpers to work alongside it, they show here with what each is doing.",
};

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
