import { settingsInbox } from "./settingsData";
import { useSettingsResource } from "./settingsResource";
// Settings → Agents → Your agents' email: the address agents share (their
// agent inbox), claimed once with a handle the user picks, and the name its
// mail goes out under, which the user changes as they like.

import { useNavigate } from "@tanstack/react-router";
import { CheckCircle2Icon, CopyIcon, InboxIcon, LoaderIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { SettingsRow } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../components/ui/input-group";
import { toastManager } from "../components/ui/toast";
import {
  checkAldoAgentHandle,
  claimAldoAgentAddress,
  fetchAldoAgentInbox,
  renameAldoAgentInbox,
  type AldoAgentHandleCheck,
  type AldoAgentInboxAddress,
} from "./accountApi";
import {
  agentHandleProblem,
  handleFieldValue,
  normalizeAgentHandle,
  normalizeSenderName,
  senderNameProblem,
} from "./agentInbox.logic";

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const AGENT_INBOX_DESCRIPTION =
  "Your agents' own email address, shared by all your threads: for signing up for things, getting codes and links, and writing to people for a task. It isn't your mail.";

/** Picking the agents' address: a handle at Aldo's mail domain, checked as it's typed, claimed for good. */
function ClaimAgentAddress(props: {
  readonly domain: string;
  readonly onClaimed: (inbox: AldoAgentInboxAddress) => void;
}) {
  const [typed, setTyped] = useState("");
  const [check, setCheck] = useState<AldoAgentHandleCheck | null>(null);
  // The handle whose check didn't get an answer, and a count Try again bumps to ask again.
  const [unchecked, setUnchecked] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const handle = normalizeAgentHandle(typed);
  const problem = handle ? agentHandleProblem(handle) : null;
  useEffect(() => {
    setConfirming(false);
    if (!handle || problem) return;
    let live = true;
    // Asked once the typing pauses; only the answer for what's typed now shows.
    const timer = window.setTimeout(() => {
      checkAldoAgentHandle(handle)
        .then((next) => {
          if (live) setCheck(next);
        })
        .catch(() => {
          if (live) setUnchecked(handle);
        });
    }, 350);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [handle, problem, attempt]);
  const current = check?.handle === handle ? check : null;
  const address = `${handle}@${props.domain}`;
  const claim = async () => {
    setClaiming(true);
    try {
      props.onClaimed(await claimAldoAgentAddress(handle));
    } catch (cause) {
      // A claim whose answer went missing may have gone through: Aldo's record decides.
      const latest = await fetchAldoAgentInbox().catch(() => null);
      if (latest?.inbox) {
        props.onClaimed(latest.inbox);
      } else {
        setConfirming(false);
        setCheck({ handle, address, available: false, reason: messageOf(cause) });
      }
    } finally {
      setClaiming(false);
    }
  };
  const status = !handle ? (
    "Pick a handle, like one on a social site. It's yours for good: an address can't be changed or given up, so mail meant for it never reaches someone else."
  ) : problem ? (
    <span className="text-warning-foreground">{problem}</span>
  ) : !current && unchecked === handle ? (
    <span className="inline-flex items-center gap-1.5 text-warning-foreground">
      Couldn't check that handle.
      <Button
        size="micro"
        variant="outline"
        onClick={() => {
          setUnchecked(null);
          setAttempt((count) => count + 1);
        }}
      >
        Try again
      </Button>
    </span>
  ) : !current ? (
    "Checking…"
  ) : current.available ? (
    <span className="inline-flex items-center gap-1 text-success-foreground">
      <CheckCircle2Icon className="size-3.5" />
      {current.address} is available
    </span>
  ) : (
    <span className="text-warning-foreground">
      {current.reason ?? "That one can't be claimed."}
    </span>
  );
  return (
    <SettingsRow
      id="aldo-agent-inbox"
      title="Agent inbox"
      description={AGENT_INBOX_DESCRIPTION}
      status={
        confirming ? (
          <span className="text-foreground">
            Claim {address} for good? You can't change it later.
          </span>
        ) : (
          status
        )
      }
      control={
        confirming ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={claiming}
              onClick={() => setConfirming(false)}
            >
              Keep editing
            </Button>
            <Button size="sm" disabled={claiming} onClick={() => void claim()}>
              {claiming ? <LoaderIcon className="size-3.5 animate-spin" /> : null}
              Claim it
            </Button>
          </>
        ) : (
          <form
            className="flex w-full gap-2 sm:w-auto"
            onSubmit={(event) => {
              event.preventDefault();
              if (current?.available) setConfirming(true);
            }}
          >
            <InputGroup className="min-w-0 flex-1 sm:w-72">
              <InputGroupInput
                aria-label="Handle for your agents' address"
                placeholder="handle"
                autoComplete="off"
                spellCheck={false}
                value={typed}
                onChange={(event) => setTyped(handleFieldValue(event.currentTarget.value))}
              />
              <InputGroupAddon align="inline-end">
                <span className="line-clamp-1 leading-none text-muted-foreground">
                  @{props.domain}
                </span>
              </InputGroupAddon>
            </InputGroup>
            <Button size="sm" type="submit" disabled={!current?.available}>
              Claim
            </Button>
          </form>
        )
      }
    />
  );
}

/** The name the agents' mail goes out under, beside its address: the user changes it as they like, unlike the address. */
function AgentSenderNameRow(props: {
  readonly inbox: AldoAgentInboxAddress;
  readonly onRenamed: (inbox: AldoAgentInboxAddress) => void;
}) {
  const { inbox } = props;
  // What's typed; null shows the saved name, which Aldo or an agent may change meanwhile.
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const name = normalizeSenderName(draft ?? inbox.displayName);
  const changed = name !== inbox.displayName;
  const problem = changed ? senderNameProblem(name) : null;
  const save = async () => {
    setSaving(true);
    try {
      const renamed = await renameAldoAgentInbox(name);
      setDraft(null);
      props.onRenamed(renamed);
      toastManager.add({
        type: "success",
        title: "Sender name saved",
        description: `Your agents' mail goes out as ${renamed.displayName} now.`,
      });
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Couldn't change the sender name",
        description: messageOf(cause),
      });
    } finally {
      setSaving(false);
    }
  };
  return (
    <SettingsRow
      title="Sender name"
      description="What people see beside your agents' address in the mail they send, for every thread. Change it whenever you like; the address stays."
      status={
        problem ? (
          <span className="text-warning-foreground">{problem}</span>
        ) : (
          <span className="break-words">
            {changed ? "Will go out as " : "Goes out as "}
            <span className="text-foreground">
              {name ? `${name} <${inbox.email}>` : inbox.email}
            </span>
          </span>
        )
      }
      control={
        <form
          className="flex w-full gap-2 sm:w-auto"
          onSubmit={(event) => {
            event.preventDefault();
            if (changed && !problem && !saving) void save();
          }}
        >
          <Input
            className="min-w-0 flex-1 sm:w-64"
            aria-label="Sender name for your agents' mail"
            placeholder="Your agent"
            autoComplete="off"
            value={draft ?? inbox.displayName}
            disabled={saving}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <Button size="sm" type="submit" disabled={!changed || problem !== null || saving}>
            {saving ? <LoaderIcon className="size-3.5 animate-spin" /> : null}
            Save
          </Button>
        </form>
      }
    />
  );
}

/** The agents' own email address, and the name its mail goes out under, once Aldo has agent inboxes. */
export function AldoAgentInboxRows() {
  const navigate = useNavigate();
  const cached = useSettingsResource(settingsInbox);
  const state = cached.data ?? null;
  const failed = cached.error !== null;
  const setState = settingsInbox.set;
  if (!state?.available) {
    return (
      <SettingsRow
        id="aldo-agent-inbox"
        title="Agent inbox"
        description={AGENT_INBOX_DESCRIPTION}
        status={
          state
            ? "Not on this Aldo yet."
            : failed
              ? "Couldn't read it. Try again later."
              : "Checking…"
        }
      />
    );
  }
  const email = state.inbox?.email;
  if (!email && state.domain) {
    return (
      <ClaimAgentAddress
        domain={state.domain}
        onClaimed={(inbox) => {
          setState({ ...state, inbox });
          toastManager.add({
            type: "success",
            title: "Address claimed",
            description: `Your agents can use ${inbox.email} now.`,
          });
        }}
      />
    );
  }
  const copy = () => {
    if (!email) return;
    // Without the Clipboard API (an insecure page, an older browser), the address is shown to copy by hand.
    if (typeof navigator.clipboard?.writeText !== "function") {
      toastManager.add({ type: "info", title: "Your agents' address", description: email });
      return;
    }
    void navigator.clipboard
      .writeText(email)
      .then(() =>
        toastManager.add({ type: "success", title: "Address copied", description: email }),
      )
      .catch(() =>
        toastManager.add({ type: "error", title: "Couldn't copy it", description: email }),
      );
  };
  return (
    <>
      <SettingsRow
        id="aldo-agent-inbox"
        title="Agent inbox"
        description={AGENT_INBOX_DESCRIPTION}
        status={
          email ? (
            <span className="inline-flex items-center gap-1 text-success-foreground">
              <CheckCircle2Icon className="size-3.5" />
              {email}
            </span>
          ) : (
            "Not claimed yet."
          )
        }
        control={
          email ? (
            <div className="flex flex-wrap gap-2">
              {state.mail ? (
                <Button size="sm" variant="outline" onClick={() => void navigate({ to: "/mail" })}>
                  <InboxIcon className="size-3.5" />
                  Open inbox
                </Button>
              ) : null}
              <Button size="sm" variant="outline" onClick={copy}>
                <CopyIcon className="size-3.5" />
                Copy address
              </Button>
            </div>
          ) : null
        }
      />
      {state.inbox && state.renamable ? (
        <AgentSenderNameRow
          inbox={state.inbox}
          onRenamed={(inbox) => {
            setState({ ...state, inbox });
          }}
        />
      ) : null}
    </>
  );
}
