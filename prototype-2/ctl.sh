#!/bin/bash
# ctl.sh start-hub|stop-hub|start-runner|stop-runner|status
# Stops only the process listening on our port after confirming its cwd.
set -uo pipefail
cd /tmp/proto-runner
ms() { echo $(( $(date +%s%N) / 1000000 )); }
port_pid() { ss -H -ltnp "sport = :$1" | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2; }
wait_http() { # port path
  local t0=$(ms)
  for i in $(seq 1 240); do
    code=$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' -H "authorization: Bearer $(cat hub-token 2>/dev/null)" "http://127.0.0.1:$1$2" 2>/dev/null)
    [ "$code" = "200" ] && { echo "ready in $(( $(ms) - t0 )) ms"; return 0; }
    sleep 0.25
  done
  echo "not ready"; return 1
}
stop_port() { # port expected-cwd
  local pid=$(port_pid $1)
  [ -z "$pid" ] && { echo "nothing on :$1"; return 0; }
  [ "$(readlink /proc/$pid/cwd)" = "$2" ] || { echo "refusing: pid $pid cwd $(readlink /proc/$pid/cwd)"; return 1; }
  local t0=$(ms); kill -TERM "$pid"
  for i in $(seq 1 100); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
  echo "stopped pid $pid on :$1 in $(( $(ms) - t0 )) ms"
}
case "$1" in
  start-runner) setsid -f ./start-runner.sh </dev/null >/dev/null 2>&1; for i in $(seq 1 120); do [ -n "$(port_pid 4412)" ] && break; sleep 0.25; done; echo "runner pid $(port_pid 4412)";;
  start-hub) t0=$(ms); setsid -f ./start-hub.sh </dev/null >/dev/null 2>&1; wait_http 4411 /api/orchestration/shell; echo "hub pid $(port_pid 4411) (start->ready $(( $(ms) - t0 )) ms)";;
  stop-hub) stop_port 4411 /tmp/proto-runner/hub;;
  stop-runner) stop_port 4412 /tmp/proto-runner/checkout;;
  status) ss -H -ltnp | grep -E ":(4411|4412) " || echo "none";;
esac
