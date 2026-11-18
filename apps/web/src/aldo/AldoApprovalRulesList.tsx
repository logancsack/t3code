import { useAldoApprovalRules } from "./AldoApprovalRules";

/** The rules, each with Remove, under "How Aldo works for you"; nothing until there's one. */
export function AldoApprovalRules() {
  const { rules, removing, remove } = useAldoApprovalRules();
  if (!rules || rules.length === 0) return null;
  return (
    <div className="mt-2 border-border/50 border-t pt-2">
      <p className="text-muted-foreground text-xs">What you always allow</p>
      <ul className="mt-1 flex flex-col gap-1 text-xs">
        {rules.map((rule) => (
          <li key={rule.id} className="flex items-start gap-2">
            <span className="min-w-0 flex-1">{rule.text}</span>
            <button
              type="button"
              className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-60"
              disabled={removing === rule.id}
              onClick={() => void remove(rule)}
              aria-label={`Stop allowing: ${rule.text}`}
            >
              {removing === rule.id ? "Removing…" : "Remove"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
