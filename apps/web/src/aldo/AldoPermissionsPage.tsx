// Settings → Permissions: pure safety and authority controls for knowledge
// workers — purchase approval limit, acting in your name (sign-ups, publishing),
// computer access, media tool defaults, and always-allowed rules. Code PR rules
// live in Code (AldoCodePage.tsx) and reuse AldoCodePolicySection exported here.

import { Link } from "@tanstack/react-router";
import {
  CheckCheckIcon,
  CodeXmlIcon,
  ImageIcon,
  LockIcon,
  ShieldCheckIcon,
  UserRoundCheckIcon,
  WalletIcon,
} from "lucide-react";
import { Fragment, useState } from "react";

import { ProjectDefaultsSettings } from "../components/settings/ProjectDefaultsSettings";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../components/settings/settingsLayout";
import { searchableSetting } from "../components/settings/settingsSearch";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { useAldoApprovalRules } from "./AldoApprovalRules";
import {
  ALDO_POLICY_ASK_AN_AGENT,
  AldoPolicyRuleRow,
  AldoPolicySelect,
  AldoPolicySubList,
  AldoPolicySubRow,
  useAldoPolicy,
  useAldoWorkspaceNames,
  type AldoPolicyState,
} from "./AldoPolicy";
import {
  ALDO_MEDIA_TASKS,
  ALDO_MERGE_METHODS,
  ALDO_SAME_AS_EVERYWHERE,
  ALDO_UNDECIDED,
  ALDO_UNDECIDED_LABEL,
  aldoMediaDefaults,
  aldoMergeMethodEdits,
  aldoMergeMethods,
  aldoRuleShown,
  aldoWorkspaceLabel,
} from "./policy.logic";

/** Repositories shown before "Show all": most people work in a few. */
const MERGE_METHODS_SHOWN = 6;

function MergeMethodRow(props: { readonly policy: AldoPolicyState }) {
  const { view, saving, edit } = props.policy;
  const [all, setAll] = useState(false);
  const row = searchableSetting("aldo-merge-method");
  const description = "How each repository’s pull requests merge, in every project it’s in.";
  const names = useAldoWorkspaceNames(Boolean(view && view.repos.length > 0));
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
  if (methods.length === 0) return null;
  const shown = all ? methods : methods.slice(0, MERGE_METHODS_SHOWN);
  return (
    <SettingsRow {...row} description={description}>
      <AldoPolicySubList bordered>
        {shown.map((method) => (
          <Fragment key={method.repo}>
            <AldoPolicySubRow
              label={<RepositoryLabel repo={method.repo} names={names} />}
              control={
                <AldoPolicySelect
                  value={method.value}
                  options={[
                    { value: ALDO_UNDECIDED, label: ALDO_UNDECIDED_LABEL },
                    ...ALDO_MERGE_METHODS,
                  ]}
                  label={`Merge method for ${aldoWorkspaceLabel([method.repo], names)}`}
                  disabled={saving}
                  onChange={(value) => void edit(aldoMergeMethodEdits(view, method.repo, value))}
                />
              }
            />
            {method.differences.length > 0 ? (
              <AldoPolicySubList heading="Different in">
                {method.differences.map((difference) => {
                  const workspace = aldoWorkspaceLabel(difference.repos, names);
                  return (
                    <AldoPolicySubRow
                      key={difference.repos.join(",")}
                      label={workspace}
                      control={
                        <AldoPolicySelect
                          value={difference.value}
                          options={[
                            { value: ALDO_SAME_AS_EVERYWHERE, label: "Same as everywhere" },
                            ...ALDO_MERGE_METHODS,
                          ]}
                          label={`Merge method for ${aldoWorkspaceLabel([method.repo], names)} in ${workspace}`}
                          disabled={saving}
                          onChange={(value) =>
                            void edit(
                              aldoMergeMethodEdits(view, method.repo, value, difference.repos),
                            )
                          }
                        />
                      }
                    />
                  );
                })}
              </AldoPolicySubList>
            ) : null}
          </Fragment>
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

/** Pull request auto-merge, merge method and automated reviews — rendered in Settings → Code. */
export function AldoCodePolicySection() {
  const policy = useAldoPolicy();
  return (
    <SettingsSection title="Pull requests" icon={<CodeXmlIcon className="size-4" />}>
      {policy.error ? (
        <p className="px-3 pt-2 text-destructive-foreground text-sm sm:px-4">{policy.error}</p>
      ) : null}
      <AldoPolicyRuleRow
        rule="merge"
        setting="aldo-merge"
        policy={policy}
        description="Once a pull request isn’t a draft and its checks have passed, Aldo merges it automatically or leaves that to you."
      />
      <MergeMethodRow policy={policy} />
      <AldoPolicyRuleRow
        rule="reviews"
        setting="aldo-reviews"
        policy={policy}
        selectClassName="w-full sm:w-64"
        description="What agents do with automated review comments. What matters: security, correctness, data loss and real user bugs."
      />
    </SettingsSection>
  );
}

/** A repository by its project's name, with its address beside it where the two differ. */
function RepositoryLabel(props: {
  readonly repo: string;
  readonly names: ReadonlyMap<string, string>;
}) {
  const name = props.names.get(props.repo);
  if (!name) return <>{props.repo}</>;
  return (
    <>
      {name} <span className="text-muted-foreground text-xs">{props.repo}</span>
    </>
  );
}

function MediaDefaultsRow(props: { readonly policy: AldoPolicyState }) {
  const { view, saving, edit } = props.policy;
  const [task, setTask] = useState<string>(ALDO_MEDIA_TASKS[0]!.value);
  const [tool, setTool] = useState("");
  const description =
    "Name a tool for a kind of media (“Runway”, “ElevenLabs”), and agents use it automatically whenever you ask for that kind.";
  const defaults = view ? aldoMediaDefaults(view) : [];
  const names = useAldoWorkspaceNames(defaults.some((entry) => entry.repos));
  if (!view) {
    return (
      <SettingsRow
        id="aldo-media-defaults"
        title="Tools you always use"
        description={description}
        {...(view === null ? { status: ALDO_POLICY_ASK_AN_AGENT } : {})}
      />
    );
  }
  const add = async () => {
    const name = tool.trim();
    if (!name) return;
    if (await edit([{ set: { mediaDefaults: { [task]: name } } }])) setTool("");
  };
  return (
    <SettingsRow id="aldo-media-defaults" title="Tools you always use" description={description}>
      <AldoPolicySubList bordered={defaults.length > 0}>
        {defaults.map((entry) => (
          <AldoPolicySubRow
            key={`${entry.task} ${entry.repos?.join(",") ?? ""}`}
            label={
              <>
                {entry.label}
                {entry.repos ? ` in ${aldoWorkspaceLabel(entry.repos, names)}` : ""}:{" "}
                <span className="text-muted-foreground">{entry.tool ?? "none"}</span>
              </>
            }
            control={
              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() =>
                  void edit([
                    {
                      ...(entry.repos ? { repos: entry.repos } : {}),
                      clear: [["mediaDefaults", entry.task]],
                    },
                  ])
                }
              >
                Remove
              </Button>
            }
          />
        ))}
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <AldoPolicySelect
            value={task}
            options={ALDO_MEDIA_TASKS}
            label="Kind of media"
            className="w-full sm:w-40"
            onChange={setTask}
          />
          <Input
            size="sm"
            className="min-w-0 flex-1 sm:max-w-56"
            value={tool}
            onChange={(event) => setTool(event.target.value)}
            placeholder="Tool, e.g. Runway"
            maxLength={80}
            aria-label="Tool"
          />
          <Button size="sm" variant="outline" type="submit" disabled={saving || !tool.trim()}>
            {defaults.some((entry) => entry.task === task && !entry.repos) ? "Change" : "Add"}
          </Button>
        </form>
      </AldoPolicySubList>
    </SettingsRow>
  );
}

/** Accounts and publishing in the user's name: only on an Aldo that says it takes them. */
function InYourNameSection(props: { readonly policy: AldoPolicyState }) {
  const { view } = props.policy;
  const accounts = aldoRuleShown(view, "accounts");
  const publishing = aldoRuleShown(view, "publishing");
  if (!accounts && !publishing) return null;
  return (
    <SettingsSection title="Acting in your name" icon={<UserRoundCheckIcon className="size-4" />}>
      {accounts ? (
        <AldoPolicyRuleRow
          rule="accounts"
          setting="aldo-accounts"
          policy={props.policy}
          description="Create free accounts with your name and email when you ask, saving the login to your vault. “Ask me first” confirms each one; “Never” gives you the steps instead."
        />
      ) : null}
      {publishing ? (
        <AldoPolicyRuleRow
          rule="publishing"
          setting="aldo-publishing"
          policy={props.policy}
          description="Publish posts, pages and listings you asked for once checked. “Show me first” always waits for your approval before anything goes live."
        />
      ) : null}
    </SettingsSection>
  );
}

function AlwaysAllowedSection() {
  const { rules, loading, removing, remove } = useAldoApprovalRules();
  return (
    <SettingsSection
      {...searchableSetting("aldo-always-allowed")}
      icon={<CheckCheckIcon className="size-4" />}
    >
      {loading ? (
        <div className="space-y-2.5 px-3 py-3 sm:px-4" aria-busy="true">
          <Skeleton className="h-5 w-3/4 rounded" />
          <Skeleton className="h-5 w-1/2 rounded" />
        </div>
      ) : rules && rules.length > 0 ? (
        rules.map((rule) => (
          <SettingsRow
            key={rule.id}
            title={rule.text}
            inline
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
          Nothing yet. When an agent asks for permission, tapping “Always allow” saves the rule here
          so you can revoke it anytime.
        </p>
      )}
    </SettingsSection>
  );
}

export function AldoPermissionsPage() {
  const policy = useAldoPolicy();
  return (
    <SettingsPageContainer>
      {policy.error ? (
        <p className="px-3 text-destructive-foreground text-sm sm:px-4">{policy.error}</p>
      ) : null}
      <SettingsSection title="Spending" icon={<WalletIcon className="size-4" />}>
        <AldoPolicyRuleRow
          rule="spendThreshold"
          setting="aldo-spend-threshold"
          policy={policy}
          description={
            policy.view?.spending?.scope === "account"
              ? `Maximum an agent may spend per purchase without asking you, across all projects. A separate $${policy.view.spending.monthlyLimit} monthly safety net always applies.`
              : "Maximum an agent may spend before asking you: a paid plan, domain or service usage."
          }
        />
        <SettingsRow
          id="aldo-payments"
          title="Payments and commitments"
          description={
            policy.view?.spending?.scope === "account"
              ? "Purchases above either limit, paid sign-ups, bookings and cancellations always ask for your approval."
              : "Agents always show you what it is and the total with fees before you approve."
          }
          inline
          control={
            <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
              <LockIcon aria-hidden="true" className="size-3.5" />
              Always asks you
            </span>
          }
        />
        <p className="px-3 py-2.5 text-muted-foreground text-xs sm:px-4">
          Looking for your monthly cap on extra Aldo credits?{" "}
          <Link
            to="/settings/account"
            hash="aldo-extra-usage-cap"
            className="text-foreground underline underline-offset-2 hover:text-primary"
          >
            Manage in Account & billing
          </Link>
          .
        </p>
      </SettingsSection>
      <InYourNameSection policy={policy} />
      <SettingsSection
        id="aldo-access"
        title="Agent access"
        icon={<ShieldCheckIcon className="size-4" />}
      >
        <ProjectDefaultsSettings category="general" aldoPart="permissions" />
      </SettingsSection>
      <SettingsSection title="Media tools" icon={<ImageIcon className="size-4" />}>
        <AldoPolicyRuleRow
          rule="mediaRouting"
          setting="aldo-media-routing"
          policy={policy}
          description="When you don’t name a tool for images, video, audio or 3D, agents pick from what your plans include first or ask you each time."
        />
        <MediaDefaultsRow policy={policy} />
      </SettingsSection>
      <AlwaysAllowedSection />
    </SettingsPageContainer>
  );
}
