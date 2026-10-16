// The rules agents follow, as Settings shows and changes them (Permissions,
// and two of Agents'): the user's own answer for all their workspaces, and
// each workspace that answered otherwise, with a picker that can make it
// follow the user's own again (policy.logic.ts). An Aldo that doesn't let the
// user change them here still says how to.

import { useCallback, useState, type ReactNode } from "react";

import { settingsPolicy } from "./settingsData";
import { useSettingsResource } from "./settingsResource";
import { optimisticPolicyEdit } from "./policy.logic";
import { SettingsRow } from "../components/settings/settingsLayout";
import {
  searchableSetting,
  type SettingsSearchItemId,
} from "../components/settings/settingsSearch";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { toastManager } from "../components/ui/toast";
import { editAldoPolicy, type AldoPolicyView } from "./cloud";
import { refreshAldoHome } from "./homeFeed";
import {
  aldoRuleDifferences,
  aldoRuleEdit,
  aldoRuleOptions,
  aldoRuleValue,
  aldoWorkspaceLabel,
  type AldoPolicyEdit,
  type AldoPolicyOption,
  type AldoPolicyRuleId,
} from "./policy.logic";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Said where a rule can't be changed here: an agent records the user's answer. */
export const ALDO_POLICY_ASK_AN_AGENT = "To change it, tell an agent in any thread.";

export interface AldoPolicyState {
  /** Undefined while it's read; null on an Aldo that doesn't let the user change the rules here. */
  readonly view: AldoPolicyView | null | undefined;
  readonly saving: boolean;
  readonly error: string | null;
  /** Makes each change in turn, showing the rules as each leaves them; false if one failed. */
  readonly edit: (edits: ReadonlyArray<AldoPolicyEdit>) => Promise<boolean>;
}

export function useAldoPolicy(): AldoPolicyState {
  const { data: view, error } = useSettingsResource(settingsPolicy);
  const [saving, setSaving] = useState(false);
  const edit = useCallback(async (edits: ReadonlyArray<AldoPolicyEdit>) => {
    if (edits.length === 0) return true;
    setSaving(true);
    try {
      for (const change of edits) {
        await settingsPolicy.mutate(
          (before) => (before ? optimisticPolicyEdit(before, change) : before),
          () => editAldoPolicy(change),
        );
      }
      return true;
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Couldn't change the rule",
        description: messageOf(cause),
      });
      // The changes before it were made: show the rules as they are.
      void settingsPolicy.refresh().catch(() => undefined);
      return false;
    } finally {
      setSaving(false);
      // Home's "How Aldo works for you" says the same rules.
      void refreshAldoHome();
    }
  }, []);
  return { view, saving, error, edit };
}

export function AldoPolicySelect(props: {
  readonly value: string;
  readonly options: ReadonlyArray<AldoPolicyOption>;
  readonly label: string;
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly className?: string;
  readonly onChange: (value: string) => void;
}) {
  const selected = props.options.find((option) => option.value === props.value);
  return (
    <Select
      value={props.value}
      onValueChange={(value) => {
        if (typeof value === "string" && value !== props.value) props.onChange(value);
      }}
    >
      <SelectTrigger
        size="sm"
        className={props.className ?? "w-full sm:w-48"}
        aria-label={props.label}
        disabled={props.disabled}
      >
        <SelectValue>{selected?.label ?? props.placeholder ?? props.value}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {props.options.map((option) => (
          <SelectItem hideIndicator key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

/** A list under a rule: one line each, a name and its own control. */
export function AldoPolicySubList(props: {
  readonly heading?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="space-y-1.5 pt-1 pb-2.5">
      {props.heading ? <p className="text-muted-foreground text-xs">{props.heading}</p> : null}
      <div className="flex flex-col gap-1.5 border-border/60 border-s ps-3">{props.children}</div>
    </div>
  );
}

export function AldoPolicySubRow(props: {
  readonly label: ReactNode;
  readonly control: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
      <span className="min-w-0 truncate text-sm">{props.label}</span>
      {props.control}
    </div>
  );
}

/**
 * One rule: the user's own answer, and under it each workspace that answered
 * otherwise. Read-only, with how to change it, where Aldo can't change it here.
 */
export function AldoPolicyRuleRow(props: {
  readonly rule: AldoPolicyRuleId;
  readonly setting: SettingsSearchItemId;
  readonly description: ReactNode;
  readonly policy: AldoPolicyState;
}) {
  const { view, saving, edit } = props.policy;
  const row = searchableSetting(props.setting);
  if (view === null) {
    return (
      <SettingsRow {...row} description={props.description} status={ALDO_POLICY_ASK_AN_AGENT} />
    );
  }
  const value = view ? aldoRuleValue(props.rule, view.everywhere) : "";
  const differences = view ? aldoRuleDifferences(view, props.rule) : [];
  const change = (next: string, repos?: ReadonlyArray<string>) => {
    const change = aldoRuleEdit(props.rule, next, repos);
    if (change) void edit([change]);
  };
  return (
    <SettingsRow
      {...row}
      description={props.description}
      control={
        <AldoPolicySelect
          value={value}
          options={view ? aldoRuleOptions(props.rule, value) : []}
          label={row.title}
          {...(view ? {} : { placeholder: "…" })}
          disabled={!view || saving}
          onChange={(next) => change(next)}
        />
      }
    >
      {differences.length > 0 ? (
        <AldoPolicySubList heading="Different in">
          {differences.map((difference) => (
            <AldoPolicySubRow
              key={difference.repos.join(",")}
              label={aldoWorkspaceLabel(difference.repos)}
              control={
                <AldoPolicySelect
                  value={difference.value}
                  options={aldoRuleOptions(props.rule, difference.value, { workspace: true })}
                  label={`${row.title} in ${aldoWorkspaceLabel(difference.repos)}`}
                  disabled={saving}
                  onChange={(next) => change(next, difference.repos)}
                />
              }
            />
          ))}
        </AldoPolicySubList>
      ) : null}
    </SettingsRow>
  );
}
