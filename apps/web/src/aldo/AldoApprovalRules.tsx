import { settingsApprovalRules } from "./settingsData";
import { useSettingsResource } from "./settingsResource";
// What the user always allows ("Agents can send email to alex@example.com
// without asking"): the rules they made with "Always allow" on an approval
// (AldoApprovals.tsx), each with Remove: under "How Aldo works for you", and
// on Settings → Permissions.

import { useState } from "react";

import { toastManager } from "../components/ui/toast";
import { removeAldoApprovalRule, type AldoApprovalRule } from "./cloud";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Lists on screen, read again when a rule is made or undone here. */
/** Says a rule was made or removed elsewhere on the page (Always allow, its Undo). */
export function aldoApprovalRulesChanged(): void {
  void settingsApprovalRules.refresh().catch(() => undefined);
}

/**
 * What the user always allows, and Remove for each: null until it's read, or
 * on an Aldo without rules. Read again when the page comes back, so a rule
 * made on another device shows, and when one is made or undone here.
 */
export function useAldoApprovalRules() {
  const { data } = useSettingsResource(settingsApprovalRules);
  const rules = data ?? null;
  const [removing, setRemoving] = useState<string | null>(null);
  const remove = async (rule: AldoApprovalRule) => {
    setRemoving(rule.id);
    try {
      await removeAldoApprovalRule(rule.id);
      settingsApprovalRules.set(
        (settingsApprovalRules.getSnapshot().data ?? []).filter((r) => r.id !== rule.id),
      );
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Couldn't remove the rule",
        description: messageOf(cause),
      });
    } finally {
      setRemoving(null);
    }
  };
  return { rules, removing, remove };
}

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
