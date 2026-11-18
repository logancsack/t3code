import { settingsApprovalRules } from "./settingsData";
import { useSettingsResource } from "./settingsResource";
// What the user always allows ("Agents can send email to alex@example.com
// without asking"): the rules they made with "Always allow" on an approval
// (AldoApprovals.tsx), each with Remove: under "How Aldo works for you", and
// on Settings → Permissions.

import { useState } from "react";

import { toastManager } from "../components/ui/toast";
import { removeAldoApprovalRule, type AldoApprovalRule } from "./homeApi";

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
