#!/usr/bin/env bash
# Streams a T3 SQLite state database into the hub Postgres schema as one user.
# Rows go through a pipe (sqlite3 CSV -> psql \copy); nothing is printed.
#
#   import-sqlite.sh <sqlite-file> <user-id> <postgres-url>
set -euo pipefail

SQLITE_FILE=$1
USER_ID=$2
PG_URL=$3

TABLES=(
  projection_projects
  projection_threads
  projection_thread_sessions
  projection_turns
  projection_thread_proposed_plans
  projection_pending_approvals
  projection_state
  projection_thread_messages
  projection_thread_activities
  orchestration_events
)

for table in "${TABLES[@]}"; do
  # row_id is a Postgres identity column; everything else keeps SQLite's order.
  columns=$(sqlite3 "file:${SQLITE_FILE}?mode=ro" \
    "SELECT group_concat(name, ', ') FROM pragma_table_info('${table}') WHERE name <> 'row_id'")
  sqlite3 -csv -nullvalue '\N' -newline $'\n' "file:${SQLITE_FILE}?mode=ro" \
    "SELECT '${USER_ID}', ${columns} FROM ${table}" |
    psql "$PG_URL" -q -v ON_ERROR_STOP=1 \
      -c "\\copy ${table} (user_id, ${columns}) FROM STDIN WITH (FORMAT csv, NULL '\\N')"
done

# Continue the user's event sequence after the imported history.
psql "$PG_URL" -q -v ON_ERROR_STOP=1 -c "
  INSERT INTO hub_users (user_id, last_event_sequence)
  SELECT '${USER_ID}', COALESCE(MAX(last_applied_sequence), 0)
  FROM projection_state WHERE user_id = '${USER_ID}'
  ON CONFLICT (user_id) DO UPDATE SET last_event_sequence = EXCLUDED.last_event_sequence"
psql "$PG_URL" -q -v ON_ERROR_STOP=1 -c "ANALYZE"
