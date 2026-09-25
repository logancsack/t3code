#!/bin/bash
# (e1) Restart the hub while a turn runs on the runner. The approval request
# for the turn's file edit is produced while the hub is down.
set -uo pipefail
P2=/workspace/repos/t3code-proto-runner/prototype-2
OUTBOX=/tmp/proto-runner/runner/userdata/runner/outbox.ndjson
head_seq() { tail -1 "$OUTBOX" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(s.trim()?JSON.parse(s).sequence:0))'; }
START=$(head_seq); echo "outbox head before turn: $START"
node $P2/scenario.mjs turn "Run the Bash command 'sleep 20' in the foreground (do not run it in the background). When it has finished, append the line 'after hub restart' to notes.txt. Reply with just: done" --approve --timeout 240 > /tmp/proto-runner/logs/turn7-hub-restart.out 2>&1 &
SCEN=$!
for i in $(seq 1 120); do node $P2/outbox-tail.mjs $START item.started | grep -q command && break; sleep 0.5; done
echo "[$(date +%T.%3N)] command started on runner; stopping hub"; /tmp/proto-runner/ctl.sh stop-hub
DOWN=$(head_seq); echo "[$(date +%T.%3N)] hub down; outbox head $DOWN"
for i in $(seq 1 80); do node $P2/outbox-tail.mjs $DOWN request.opened | grep -q . && break; sleep 0.5; done
echo "[$(date +%T.%3N)] approval requested while hub down:"; node $P2/outbox-tail.mjs $DOWN request
echo "[$(date +%T.%3N)] outbox head $(head_seq); restarting hub"; /tmp/proto-runner/ctl.sh start-hub
wait $SCEN; echo "scenario exit $?"
echo "events produced by the runner while the hub was down: $DOWN..$(head_seq)"
