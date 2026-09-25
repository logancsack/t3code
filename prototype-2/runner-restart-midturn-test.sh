#!/bin/bash
# Restart the runner while a turn is executing on it (graceful stop drains the
# provider session into the outbox), then continue the work in a new turn.
set -uo pipefail
P2=/workspace/repos/t3code-proto-runner/prototype-2
OUTBOX=/tmp/proto-runner/runner/userdata/runner/outbox.ndjson
head_seq() { tail -1 "$OUTBOX" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(s.trim()?JSON.parse(s).sequence:0))'; }
START=$(head_seq); echo "outbox head before turn: $START"
node $P2/scenario.mjs turn "Run the Bash command 'sleep 15' in the foreground (do not run it in the background). When it has finished, append the line 'after runner restart' to notes.txt. Reply with just: done" --approve --timeout 120 > /tmp/proto-runner/logs/turn9-runner-restart-midturn.out 2>&1 &
SCEN=$!
for i in $(seq 1 120); do node $P2/outbox-tail.mjs $START item.started | grep -q command && break; sleep 0.5; done
echo "[$(date +%T.%3N)] command running on runner; stopping runner"; /tmp/proto-runner/ctl.sh stop-runner
echo "[$(date +%T.%3N)] events outboxed during drain:"; node $P2/outbox-tail.mjs $START | tail -4
sleep 2; echo "[$(date +%T.%3N)] starting runner"; /tmp/proto-runner/ctl.sh start-runner
wait $SCEN; echo "scenario exit $?"
echo "[$(date +%T.%3N)] follow-up turn"
node $P2/scenario.mjs turn "Your previous task was cut off by a machine restart. Finish it now: make sure notes.txt ends with the line 'after runner restart' (add it only if missing). Reply with just: done" --approve --timeout 120 > /tmp/proto-runner/logs/turn10-continue.out 2>&1
echo "follow-up exit $?"; cat /tmp/proto-runner/checkout/notes.txt
