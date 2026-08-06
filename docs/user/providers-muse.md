# Muse Code

Muse Code is a Beta provider in T3 Code. It uses Meta's `muse exec` headless interface and
defaults to the Muse Spark 1.2 model.

## Install and connect

Install Muse Code using [Meta's instructions](https://research.meta.ai/blog/introducing-muse-code-and-muse-spark-1-2), then connect it from the Muse Code card in T3 Code Settings. T3 Code supports both of the CLI's authentication methods:

- **Sign in with Meta** starts the `muse login` device flow and opens Meta's authorization page.
- **Use a Meta API key** securely sends a key to `muse auth set --provider meta --api-key-stdin`.

You can also authenticate before starting T3 Code by running `muse login`, or provide a
`META_API_KEY` environment variable on a separate Muse provider instance.

## What Works

Muse sessions keep a stable Muse session ID across turns, so normal conversation continuation
works after T3 Code reconnects. The integration also supports:

- streamed responses and the canonical T3 work log for Muse tool activity
- Muse Spark model selection and reasoning-effort controls
- image and file attachments
- Plan mode, with write and shell tools disabled
- turn interruption and queued follow-up messages
- commit-message and thread-title generation through an isolated Muse invocation

## Runtime Modes

Muse's headless protocol does not currently expose a way for T3 Code to answer an approval prompt.
T3 Code maps its runtime modes accordingly:

- **Supervised** runs Muse read-only so an invisible approval request cannot hang the turn.
- **Auto** allows sandboxed changes without interactive approval.
- **Full Access** uses Muse's trusted, unsandboxed mode.
- **Plan** is always read-only, regardless of the selected runtime mode.

Muse also does not currently expose mid-turn steering or durable rollback through its headless
interface. Interrupt a running turn before sending a replacement instruction.

## Context And Privacy

Normal Muse sessions retain the CLI's standard workspace context behavior, including compatible
personal instructions and skills it discovers on the machine. T3 Code's short-lived text-generation
helpers disable foreign personal context and session logging so commit messages and thread titles do
not inherit unrelated instructions or leave extra Muse histories.

T3 Code detects whether Muse has a stored Meta credential by inspecting only the shape of Muse's
local auth record; it never reads a credential value into provider status or sends it to the browser.
