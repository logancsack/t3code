// Exact paths from public-aldo/brand/aldo-mark.svg, shared by every Aldo mark.
export const ALDO_MARK_PATHS = [
  "M1 28 13.4 4h8.7L10.6 28H1Z",
  "M23.9 4h8.7L41 28h-9.6L23.9 4Z",
] as const;

export function AldoMark({ className }: { readonly className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 42 32" fill="currentColor">
      {ALDO_MARK_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
