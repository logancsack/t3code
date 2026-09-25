#!/bin/bash
# Starts the prototype runner on :4412 with its own state dir; hosts real Claude.
set -euo pipefail
cd /tmp/proto-runner/checkout
export T3CODE_RUNNER_TOKEN="$(cat /tmp/proto-runner/runner-token)"
export T3CODE_TELEMETRY_ENABLED=false T3CODE_NO_BROWSER=true T3CODE_RUNNER_DRIVERS=claudeAgent T3CODE_RUNNER_OUTBOX_KEEP=1
exec node /workspace/repos/t3code-proto-runner/apps/server/src/bin.ts runner \
  --base-dir /tmp/proto-runner/runner --port 4412 >>/tmp/proto-runner/logs/runner.log 2>&1
