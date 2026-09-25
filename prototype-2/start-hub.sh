#!/bin/bash
# Starts the prototype hub on :4411. The hub runs inside a mount namespace in
# which /tmp/proto-runner/checkout is an empty, mode-000 tmpfs, under strace
# recording every syscall that names that path.
set -euo pipefail
cd /tmp/proto-runner/hub
export T3CODE_RUNNER_URL=ws://127.0.0.1:4412/runner/ws
export T3CODE_RUNNER_TOKEN="$(cat /tmp/proto-runner/runner-token)"
export T3CODE_TELEMETRY_ENABLED=false T3CODE_NO_BROWSER=true T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD=false
exec strace -f -qq --seccomp-bpf -e trace=%file,%process,chdir,fchdir -P /tmp/proto-runner/checkout \
  -o "/tmp/proto-runner/logs/hub.strace.$(date +%s)" \
  bwrap --dev-bind / / --tmpfs /tmp/proto-runner/checkout --chmod 0000 /tmp/proto-runner/checkout --die-with-parent \
  node /workspace/repos/t3code-proto-runner/apps/server/src/bin.ts \
  --base-dir /tmp/proto-runner/hub --port 4411 >>/tmp/proto-runner/logs/hub.log 2>&1
