import { CheckCircle2Icon, CircleIcon, PlusIcon } from "lucide-react";

import { Button } from "../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { ALDO_ACCOUNT_SPECS, AldoAccountButton, useAldoAccounts } from "./AldoAccountsPanel";
import type { AldoAccountKind } from "./cloud";
import { openAldoRepositoryPicker } from "./AldoRepositoryDialog";

const AGENT_KINDS: ReadonlyArray<AldoAccountKind> = ["claude", "codex", "grok"];

/**
 * The landing screen under Aldo. Until GitHub and at least one agent are
 * connected it walks through setup; after that it's a single "start a thread"
 * prompt. Existing threads are in the sidebar.
 */
export function AldoHome() {
  const { accounts, refresh } = useAldoAccounts();
  const githubReady = accounts?.github.connected === true;
  const agentReady = AGENT_KINDS.some((kind) => accounts?.[kind].connected === true);
  const setupDone = githubReady && agentReady;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-background">
        <Empty className="flex-1">
          <div className="w-full max-w-lg px-6 py-12">
            <EmptyHeader className="max-w-none">
              <EmptyTitle className="text-foreground text-2xl sm:text-3xl">
                {setupDone ? "What should we work on?" : "Welcome to Aldo"}
              </EmptyTitle>
              <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
                {setupDone
                  ? "Each thread runs in its own cloud sandbox with a fresh clone of your repository."
                  : "Connect GitHub and at least one of your agent subscriptions. You only do this once."}
              </EmptyDescription>
            </EmptyHeader>

            {accounts && !setupDone ? (
              <ol className="mt-8 space-y-2 text-left">
                <SetupRow
                  kind="github"
                  connected={githubReady}
                  label={accounts.github.account}
                  onConnected={refresh}
                />
                {AGENT_KINDS.map((kind) => (
                  <SetupRow
                    key={kind}
                    kind={kind}
                    connected={accounts[kind].connected}
                    label={accounts[kind].account}
                    onConnected={refresh}
                  />
                ))}
              </ol>
            ) : null}

            <div className="mt-8 flex justify-center">
              <Button onClick={openAldoRepositoryPicker} disabled={!githubReady}>
                <PlusIcon className="size-4" />
                Start a thread
              </Button>
            </div>
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}

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
