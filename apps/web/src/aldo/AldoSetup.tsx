// Setup on the home screen. Agents run on Aldo's own models once the plan is
// active, so a subscription is an upgrade rather than a requirement, and a git
// host only matters for code: while either is missing, one quiet line says
// what's ready and offers both, in a sheet (AldoSetupLine). Only when nothing
// can run yet (no subscription, and Aldo's models aren't offered or the plan
// can't run) does the full card ask for one first (AldoSetupCard).

import { CheckCircle2Icon, ChevronRightIcon, CircleIcon, CodeIcon } from "lucide-react";
import { useState } from "react";

import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "../components/ui/sheet";
import { ALDO_ACCOUNT_SPECS, AldoAccountButton } from "./AldoAccountsPanel";
import type { AldoAccount, AldoAccountKind, AldoGitHostKind, AldoHostKind } from "./cloud";

export const AGENT_KINDS: ReadonlyArray<AldoAccountKind> = ["claude", "codex", "grok", "muse"];

type Accounts = Record<AldoAccountKind | AldoGitHostKind, AldoAccount>;

/** The subscriptions this Aldo connects (an older one doesn't list Muse Code). */
function agentKinds(accounts: Accounts): ReadonlyArray<AldoAccountKind> {
  return AGENT_KINDS.filter((kind) => kind in accounts);
}

/** ["Claude", "Codex"] → "Claude and Codex". */
function listed(names: ReadonlyArray<string>): string {
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The plans' names as people know them ("ChatGPT", not Codex). */
const PLAN_NAMES: Record<AldoAccountKind, string> = {
  github: "GitHub",
  claude: "Claude",
  codex: "ChatGPT",
  grok: "Grok",
  muse: "Muse",
};

function SetupRow(props: {
  readonly kind: AldoAccountKind;
  readonly connected: boolean;
  readonly label: string | null;
  readonly onConnected: () => void;
}) {
  const spec = ALDO_ACCOUNT_SPECS[props.kind];
  return (
    <li className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/30 px-4 py-3">
      {props.connected ? (
        <CheckCircle2Icon className="size-5 shrink-0 text-success-foreground" />
      ) : (
        <CircleIcon className="size-5 shrink-0 text-muted-foreground/60" />
      )}
      <div className="min-w-0 flex-1">
        <div className="font-medium text-sm">{spec.title}</div>
        <div className="truncate text-muted-foreground text-xs">
          {props.connected
            ? `Connected${props.label ? ` as ${props.label}` : ""}`
            : spec.description}
        </div>
      </div>
      {props.connected ? null : (
        <AldoAccountButton kind={props.kind} account={undefined} onConnected={props.onConnected} />
      )}
    </li>
  );
}

/** Nothing can run yet: connect a subscription (and, for code, a git host). */
export function AldoSetupCard(props: {
  readonly accounts: Accounts;
  readonly sourceHost: AldoHostKind | undefined;
  readonly general: boolean;
  readonly assistant: boolean;
  readonly onConnected: () => void;
}) {
  const { accounts } = props;
  const plans = listed(agentKinds(accounts).map((kind) => PLAN_NAMES[kind]));
  return (
    <section className="rounded-xl border border-border/60 bg-card/30 p-4">
      <h2 className="font-medium text-sm">{props.assistant ? "Set up Aldo" : "Welcome to Aldo"}</h2>
      <p className="mt-1 text-muted-foreground text-xs">
        {props.general
          ? `Connect your ${plans} plan, once${props.assistant ? ", so Aldo can start threads for you" : ""}. GitHub (or another git host in Settings → Git hosts) is for work on code.`
          : `Connect GitHub (or another git host in Settings → Git hosts) and your ${plans} plan, once${props.assistant ? ", so Aldo can start threads for you" : ""}.`}
      </p>
      <ol className="mt-3 space-y-2 text-left">
        {props.sourceHost && props.sourceHost !== "github" ? null : (
          <SetupRow
            kind="github"
            connected={props.sourceHost !== undefined}
            label={accounts.github.account}
            onConnected={props.onConnected}
          />
        )}
        {agentKinds(accounts).map((kind) => (
          <SetupRow
            key={kind}
            kind={kind}
            connected={accounts[kind].connected}
            label={accounts[kind].account}
            onConnected={props.onConnected}
          />
        ))}
      </ol>
    </section>
  );
}

/**
 * Agents can run: one line saying on what ("Ready now on Aldo's models"),
 * offering a subscription of the user's and, for code, a git host; both
 * open a sheet with the rows.
 */
export function AldoSetupLine(props: {
  readonly accounts: Accounts;
  /** Whether a git host is connected. */
  readonly sourceReady: boolean;
  readonly onConnected: () => void;
}) {
  const { accounts } = props;
  const [open, setOpen] = useState(false);
  const kinds = agentKinds(accounts);
  const connected = kinds.filter((kind) => accounts[kind].connected);
  const link = (label: string) => (
    <button
      type="button"
      className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
      onClick={() => setOpen(true)}
    >
      {label}
      <ChevronRightIcon className="size-3.5" />
    </button>
  );
  return (
    <>
      <div className="flex flex-wrap items-stretch gap-2 text-xs">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border/60 bg-card/30 px-3 py-2">
          <span className="flex items-center gap-2">
            <CheckCircle2Icon className="size-4 shrink-0 text-success-foreground" />
            <span>
              <span className="font-medium">Ready now</span>{" "}
              <span className="text-muted-foreground">
                {connected.length > 0
                  ? `on your ${listed(connected.map((kind) => PLAN_NAMES[kind]))} plan`
                  : "on Aldo's models"}
              </span>
            </span>
          </span>
          {connected.length === 0
            ? link(`Use your ${listed(kinds.map((kind) => PLAN_NAMES[kind]))} plan`)
            : null}
        </div>
        {props.sourceReady ? null : (
          <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/30 px-3 py-2">
            <CodeIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">For code</span>
            {link("Connect GitHub")}
          </div>
        )}
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetPopup side="right">
          <SheetHeader>
            <SheetTitle>Your accounts</SheetTitle>
            <SheetDescription>
              Agents already run on Aldo's models. Connect a plan of yours to run them on it
              instead, and GitHub so they can work on your code.
            </SheetDescription>
          </SheetHeader>
          <SheetPanel className="flex flex-col gap-5">
            <section>
              <h3 className="mb-2 font-medium text-muted-foreground text-xs">AI subscriptions</h3>
              <ol className="space-y-2">
                {kinds.map((kind) => (
                  <SetupRow
                    key={kind}
                    kind={kind}
                    connected={accounts[kind].connected}
                    label={accounts[kind].account}
                    onConnected={props.onConnected}
                  />
                ))}
              </ol>
            </section>
            <section>
              <h3 className="mb-2 font-medium text-muted-foreground text-xs">For code</h3>
              <ol className="space-y-2">
                <SetupRow
                  kind="github"
                  connected={accounts.github.connected}
                  label={accounts.github.account}
                  onConnected={props.onConnected}
                />
              </ol>
              <p className="mt-2 text-muted-foreground text-xs">
                GitLab, Bitbucket and Azure DevOps are in Settings → Git hosts.
              </p>
            </section>
          </SheetPanel>
        </SheetPopup>
      </Sheet>
    </>
  );
}
