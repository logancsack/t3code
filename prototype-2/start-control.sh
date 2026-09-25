#!/bin/bash
# Control: the same server build in ordinary local mode (no runner), :4413.
set -euo pipefail
cd /tmp/proto-runner/control
export T3CODE_TELEMETRY_ENABLED=false T3CODE_NO_BROWSER=true T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD=false
exec node /workspace/repos/t3code-proto-runner/apps/server/src/bin.ts \
  --base-dir /tmp/proto-runner/control --port 4413 >>/tmp/proto-runner/logs/control.log 2>&1
