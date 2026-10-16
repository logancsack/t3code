// Settings → Permissions: what agents may do without asking. Their access in
// a thread (T3's own row), what they may spend, how they merge and answer
// reviews, how they pick media tools, and what the user always allows. Each
// rule is the user's for all their workspaces, with the workspaces that
// answered otherwise under it (AldoPolicy.tsx).

import { CheckCheckIcon, CodeXmlIcon, ImageIcon, ShieldCheckIcon, WalletIcon } from "lucide-react";
import { useState } from "react";

import { ProjectDefaultsSettings } from "../components/settings/ProjectDefaultsSettings";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../components/settings/settingsLayout";
import { searchableSetting } from "../components/settings/settingsSearch";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useAldoApprovalRules } from "./AldoApprovalRules";
import {
  ALDO_POLICY_ASK_AN_AGENT,
  AldoPolicyRuleRow,
  AldoPolicySelect,
  AldoPolicySubList,
  AldoPolicySubRow,
  useAldoPolicy,
  type AldoPolicyState,
} from "./AldoPolicy";
import {
  ALDO_MEDIA_TASKS,
  ALDO_MERGE_METHODS,
  ALDO_UNDECIDED,
  aldoMediaDefaults,
  aldoMergeMethodEdits,
  aldoMergeMethods,
} from "./policy.logic";

/** Repositories shown before "Show all": most people work in a few. */
const MERGE_METHODS_SHOWN = 6;

function MergeMethodRow(props: { readonly policy: AldoPolicyState }) {
  const { view, saving, edit } = props.policy;
  const [all, setAll] = useState(false);
  const row = searchableSetting("aldo-merge-method");
  const description = "How each repository's pull requests merge.";
  if (!view) {
    return (
      <SettingsRow
        {...row}
        description={description}
        {...(view === null ? { status: ALDO_POLICY_ASK_AN_AGENT } : {})}
      />
    );
  }
  const methods = aldoMergeMethods(view);
  if (methods.length === 0) {
    return (
      <SettingsRow
        {...row}
        description={description}
        status="Agents ask the first time they merge in a repository."
      />
    );
  }
  const shown = all ? methods : methods.slice(0, MERGE_METHODS_SHOWN);
  return (
    <SettingsRow {...row} description={description}>
      <AldoPolicySubList>
        {shown.map((method) => (
          <AldoPolicySubRow
            key={method.repo}
            label={method.repo}
            control={
              <AldoPolicySelect
                value={method.value}
                options={[{ value: ALDO_UNDECIDED, label: "Not decided" }, ...ALDO_MERGE_METHODS]}
                label={`Merge method for ${method.repo}`}
                disabled={saving}
                onChange={(value) => void edit(aldoMergeMethodEdits(view, method.repo, value))}
              />
            }
          />
        ))}
        {methods.length > shown.length ? (
          <Button size="xs" variant="ghost" className="self-start" onClick={() => setAll(true)}>
            Show all {methods.length}
          </Button>
        ) : null}
      </AldoPolicySubList>
    </SettingsRow>
  );
}

function MediaDefaultsRow(props: { readonly policy: AldoPolicyState }) {
  const { view, saving, edit } = props.policy;
  const [task, setTask] = useState<string>(ALDO_MEDIA_TASKS[0]!.value);
  const [tool, setTool] = useState("");
  const description =
    "A tool to use for a kind of media, in your words (“Runway”, “Codex”). Agents use it as if you'd named it each time.";
  if (!view) {
    return (
      <SettingsRow
        id="aldo-media-defaults"
        title="Your media tools"
        description={description}
        {...(view === null ? { status: ALDO_POLICY_ASK_AN_AGENT } : {})}
      />
    );
  }
  const defaults = aldoMediaDefaults(view);
  const add = async () => {
    const name = tool.trim();
    if (!name) return;
    await edit([{ set: { mediaDefaults: { [task]: name } } }]);
    setTool("");
  };
  return (
    <SettingsRow id="aldo-media-defaults" title="Your media tools" description={description}>
      <AldoPolicySubList>
        {defaults.map((entry) => (
          <AldoPolicySubRow
            key={entry.task}
            label={
              <>
                {entry.label}: <span className="text-muted-foreground">{entry.tool}</span>
              </>
            }
            control={
              <Button
                size="xs"
                variant="ghost"
                disabled={saving}
                onClick={() => void edit([{ clear: [["mediaDefaults", entry.task]] }])}
              >
                Remove
              </Button>
            }
          />
        ))}
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <AldoPolicySelect
            value={task}
            options={ALDO_MEDIA_TASKS}
            label="Kind of media"
            className="w-36"
            onChange={setTask}
          />
          <Input
            size="sm"
            className="min-w-0 flex-1 sm:max-w-56"
            value={tool}
            onChange={(event) => setTool(event.target.value)}
            placeholder="Tool, e.g. Runway"
            aria-label="Tool"
          />
          <Button size="sm" variant="outline" type="submit" disabled={saving || !tool.trim()}>
            {defaults.some((entry) => entry.task === task) ? "Change" : "Add"}
          </Button>
        </form>
      </AldoPolicySubList>
    </SettingsRow>
  );
}

function AlwaysAllowedSection() {
  const { rules, removing, remove } = useAldoApprovalRules();
  return (
    <SettingsSection
      {...searchableSetting("aldo-always-allowed")}
      icon={<CheckCheckIcon className="size-4" />}
    >
      {rules && rules.length > 0 ? (
        rules.map((rule) => (
          <SettingsRow
            key={rule.id}
            title={rule.text}
            control={
              <Button
                size="sm"
                variant="ghost"
                disabled={removing === rule.id}
                onClick={() => void remove(rule)}
                aria-label={`Stop allowing: ${rule.text}`}
              >
                {removing === rule.id ? "Removing…" : "Remove"}
              </Button>
            }
          />
        ))
      ) : (
        <p className="px-3 py-3 text-muted-foreground text-sm sm:px-4">
          Nothing yet. When an agent asks you to approve something, Always allow on it adds it here.
        </p>
      )}
    </SettingsSection>
  );
}

export function AldoPermissionsPage() {
  const policy = useAldoPolicy();
  return (
    <SettingsPageContainer>
      <SettingsSection
        id="aldo-access"
        title="In a thread"
        icon={<ShieldCheckIcon className="size-4" />}
      >
        <ProjectDefaultsSettings category="general" aldoPart="permissions" />
      </SettingsSection>
      {policy.error ? (
        <p className="px-3 text-destructive-foreground text-sm sm:px-4">{policy.error}</p>
      ) : null}
      <SettingsSection title="Money" icon={<WalletIcon className="size-4" />}>
        <AldoPolicyRuleRow
          rule="spendThreshold"
          setting="aldo-spend-threshold"
          policy={policy}
          description="What an agent may spend at once, or in a month (a paid plan, a domain, a service's usage), before asking you. Not decided, it asks you the first time."
        />
        <AldoPolicyRuleRow
          rule="paidFallback"
          setting="aldo-paid-fallback"
          policy={policy}
          description="When your subscriptions run out, whether the threads Aldo starts may go on to Aldo's credits, Claude's extra usage or Codex credits."
        />
        <SettingsRow
          id="aldo-payments"
          title="Payments"
          description="Before an agent pays, books or cancels anything, it shows you what it is and the total, for you to approve each time."
        />
      </SettingsSection>
      <SettingsSection title="Code" icon={<CodeXmlIcon className="size-4" />}>
        <AldoPolicyRuleRow
          rule="merge"
          setting="aldo-merge"
          policy={policy}
          description="Once a pull request isn't a draft and its checks have passed, Aldo merges it, or leaves that to you. Not decided, an agent asks."
        />
        <MergeMethodRow policy={policy} />
        <AldoPolicyRuleRow
          rule="reviews"
          setting="aldo-reviews"
          policy={policy}
          description="What agents do with Codex's and other reviewers' comments: fix what matters (security, correctness, data loss, what you'd hit) and answer the rest, or fix every one."
        />
      </SettingsSection>
      <SettingsSection title="Media" icon={<ImageIcon className="size-4" />}>
        <AldoPolicyRuleRow
          rule="mediaRouting"
          setting="aldo-media-routing"
          policy={policy}
          description="For media you don't name a tool for: agents choose, from what your plans include first, or show you the options each time."
        />
        <MediaDefaultsRow policy={policy} />
      </SettingsSection>
      <AlwaysAllowedSection />
    </SettingsPageContainer>
  );
}
