# Prime Agent

Prime Agent is an experimental T3 Code provider. This integration supports exactly Prime Agent
v0.7.0. T3 launches its
[Agent Client Protocol (ACP)](https://github.com/PrimeIntellect-ai/prime-agent/blob/v0.7.0/packages/coding-agent/docs/acp.md)
server and translates streamed messages, reasoning, plans, tool activity, and Prime-specific
subagent metadata into the normal T3 conversation and work log.

## Install And Connect

Install [Prime Agent v0.7.0](https://github.com/PrimeIntellect-ai/prime-agent/releases/tag/v0.7.0)
and confirm that `prime-agent --version` reports `0.7.0` in the environment running the T3 server.
Managed Aldo workspaces install the same pinned v0.7.0 release during workspace bootstrap and
upgrades; other Prime Agent versions are not supported by this integration.

Open the Prime Agent card in T3 Code Settings to connect one of these credential sources:

- Prime Inference
- OpenAI or Anthropic API keys
- Azure OpenAI, Amazon Bedrock, or Google Vertex AI credentials
- OpenAI or Anthropic subscription OAuth, when the server operator has enabled that capability

API-key and cloud-credential methods remain available when subscription OAuth is disabled. Prime
Agent stores credentials in its own `auth.json`; T3 does not copy an existing Codex or Claude auth
cache into Prime. In an Aldo workspace, use the shared Browser panel to complete a new grant with an
account that is already signed in there.

Prime's OpenAI OAuth callback listens on `localhost:1455`. Opening its authorization link in the
workspace Browser panel lets the callback reach the Prime process. If another browser reaches a
failed localhost redirect, copy the complete redirect URL back into the T3 connection dialog.

Anthropic subscription auth in a third-party harness uses Anthropic **extra usage**, billed per
token rather than against Claude plan limits. Review and manage that setting at
<https://claude.ai/settings/usage> before connecting it.

Subscription OAuth is absent by default. An operator must deliberately set
`T3CODE_PRIME_AGENT_SUBSCRIPTION_OAUTH_ENABLED=true` after completing the provider-policy review
for that environment. This gates T3's guided connector, not Prime's own interactive `/login`
command, and it does not affect API keys.

## Models And Continuation

After authentication, T3 discovers models with `prime-agent model list`. Model slugs include their
provider, such as `openai/gpt-5.4` or `anthropic/claude-sonnet-4-6`; `auto` leaves selection to Prime.
Discovery intentionally uses the bare model-list command; add extension- or project-defined models
as custom models in Settings when they do not appear automatically.
Changing a Prime model requires a new thread.

Each T3 thread receives a private, stable Prime session directory. A restored T3 session restarts
Prime with `--continue` in that directory, preserving context without relying on ACP's optional
`session/load` method. Prime does not currently expose provider-side rollback or mid-turn steering
through ACP; interrupt a running turn before replacing its instruction.

Short-lived commit, branch, pull-request, and title generation runs without tools, skills,
extensions, context files, themes, or session persistence. It does not create an extra agent
history or inherit a configured autonomous goal.

## Full-Access Runtime

Prime's ACP server does not expose per-tool permission requests. Model-generated commands therefore
run with the permissions of the operating-system user that runs T3. Prime sessions accept only
T3's **Full Access** runtime mode; the supervised-mode control is hidden and the server rejects a
supervised start rather than implying that it can enforce approvals.

Review repositories, credentials, network access, and the workspace user's privileges before
starting a Prime thread. The normal T3 attachment boundary still applies, but it is not a sandbox
for commands Prime chooses to run.

## Background Subagents And Workspace Pause

Prime can report recursively spawned subagents after the parent turn appears complete. In a managed
Aldo workspace, T3 treats reported queued or running subagents as activity, so the idle reaper does
not stop their root session and Aldo does not pause the workspace. A resident, idle ACP process does
not count as activity. Reported subagents cannot defer root-session idle reaping beyond six hours;
an active T3 turn is never subject to that ceiling.

Prime heartbeats and scheduled prompts are not supported by this integration. Prime v0.7 reports
that heartbeat configuration changed, but not enough active or next-run state for T3 to keep an idle
ACP session resident, and T3 has no thread turn in which to represent out-of-turn scheduled output.
Keeping a VM running therefore does not make scheduled Prime work reliable, and Prime cannot wake a
paused Aldo workspace. Use an external scheduler that starts a normal T3 turn instead.

## State And Privacy

Set `PRIME_AGENT_CODING_AGENT_DIR` to place Prime state somewhere other than its default agent
directory. Managed Aldo workspaces use `/workspace/.devpc/home/.prime/agent`, mode `0700`, on the
persistent workspace disk. Prime creates its auth file with mode `0600`.

Provider status checks inspect only whether Prime reports usable models and whether a supported
credential shape exists. Credential values are not returned to the browser or included in provider
status messages. Authorization input is sent only to Prime's interactive credential prompt and is
cleared from T3's in-memory connector session when the attempt finishes, fails, expires, or is
cancelled.
