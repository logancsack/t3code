/**
 * Hub baseline schema for PostgreSQL.
 *
 * Derived from the SQLite schema after migration 043 (`sqlite3 <fresh db> .schema`),
 * not from a port of the 43 migrations. Tenancy is a `user_id` column that leads
 * every primary key, unique constraint, and index, so one database serves every
 * hub user and every query stays safe behind a transaction-mode pooler.
 *
 * Dialect decisions that the queries depend on:
 * - Every text column that is compared or ordered uses `COLLATE "C"` so ordering
 *   matches SQLite's BINARY collation (the thread-detail keyset uses "~" and ""
 *   sentinels that only work bytewise), whatever the database default is.
 * - Nullable sort keys are indexed `NULLS FIRST`, SQLite's NULL ordering, so the
 *   `DESC NULLS LAST` window reads are served by a backward index scan.
 * - JSON stays in `text` columns: the repositories decode with `fromJsonString`
 *   and the `\u0000` escapes that JSON.stringify can emit are rejected by jsonb.
 * - Boolean-like columns stay integers (`is_streaming`, counts) so row decoding is
 *   identical to SQLite.
 * - SQLite's global `orchestration_events.sequence AUTOINCREMENT` becomes a
 *   per-user counter in `hub_users.last_event_sequence`, allocated inside the
 *   append transaction, so sequences are gap-free per user like SQLite's.
 */

export const HUB_SCHEMA_VERSION = 1;

const c = `COLLATE "C"`;

export const HUB_BASELINE_STATEMENTS: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS hub_schema_version (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS hub_users (
    user_id text ${c} PRIMARY KEY,
    last_event_sequence bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // orchestration_events (001) — sequence is per user.
  `CREATE TABLE IF NOT EXISTS orchestration_events (
    user_id text ${c} NOT NULL,
    sequence bigint NOT NULL,
    event_id text ${c} NOT NULL,
    aggregate_kind text ${c} NOT NULL,
    stream_id text ${c} NOT NULL,
    stream_version integer NOT NULL,
    event_type text ${c} NOT NULL,
    occurred_at text ${c} NOT NULL,
    command_id text ${c},
    causation_event_id text ${c},
    correlation_id text ${c},
    actor_kind text ${c} NOT NULL,
    payload_json text NOT NULL,
    metadata_json text NOT NULL,
    PRIMARY KEY (user_id, sequence),
    UNIQUE (user_id, event_id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_orch_events_stream_version
    ON orchestration_events (user_id, aggregate_kind, stream_id, stream_version)`,
  `CREATE INDEX IF NOT EXISTS idx_orch_events_stream_sequence
    ON orchestration_events (user_id, aggregate_kind, stream_id, sequence)`,
  `CREATE INDEX IF NOT EXISTS idx_orch_events_command_id
    ON orchestration_events (user_id, command_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orch_events_correlation_id
    ON orchestration_events (user_id, correlation_id)`,

  // orchestration_command_receipts (002)
  `CREATE TABLE IF NOT EXISTS orchestration_command_receipts (
    user_id text ${c} NOT NULL,
    command_id text ${c} NOT NULL,
    aggregate_kind text ${c} NOT NULL,
    aggregate_id text ${c} NOT NULL,
    accepted_at text ${c} NOT NULL,
    result_sequence bigint NOT NULL,
    status text ${c} NOT NULL,
    error text,
    PRIMARY KEY (user_id, command_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_orch_command_receipts_aggregate
    ON orchestration_command_receipts (user_id, aggregate_kind, aggregate_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orch_command_receipts_sequence
    ON orchestration_command_receipts (user_id, result_sequence)`,

  // checkpoint_diff_blobs (003)
  `CREATE TABLE IF NOT EXISTS checkpoint_diff_blobs (
    user_id text ${c} NOT NULL,
    thread_id text ${c} NOT NULL,
    from_turn_count integer NOT NULL,
    to_turn_count integer NOT NULL,
    diff text NOT NULL,
    created_at text ${c} NOT NULL,
    UNIQUE (user_id, thread_id, from_turn_count, to_turn_count)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_checkpoint_diff_blobs_thread_to_turn
    ON checkpoint_diff_blobs (user_id, thread_id, to_turn_count)`,

  // provider_session_runtime (004, 009, 027)
  `CREATE TABLE IF NOT EXISTS provider_session_runtime (
    user_id text ${c} NOT NULL,
    thread_id text ${c} NOT NULL,
    provider_name text ${c} NOT NULL,
    adapter_key text ${c} NOT NULL,
    runtime_mode text ${c} NOT NULL DEFAULT 'full-access',
    status text ${c} NOT NULL,
    last_seen_at text ${c} NOT NULL,
    resume_cursor_json text,
    runtime_payload_json text,
    provider_instance_id text ${c},
    PRIMARY KEY (user_id, thread_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_provider_session_runtime_status
    ON provider_session_runtime (user_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_provider_session_runtime_provider
    ON provider_session_runtime (user_id, provider_name)`,
  `CREATE INDEX IF NOT EXISTS idx_provider_session_runtime_instance
    ON provider_session_runtime (user_id, provider_instance_id)`,

  // projection_projects (005, 039, 040)
  `CREATE TABLE IF NOT EXISTS projection_projects (
    user_id text ${c} NOT NULL,
    project_id text ${c} NOT NULL,
    title text NOT NULL,
    workspace_root text ${c} NOT NULL,
    scripts_json text NOT NULL,
    created_at text ${c} NOT NULL,
    updated_at text ${c} NOT NULL,
    deleted_at text ${c},
    default_model_selection_json text,
    default_thread_env_mode text ${c},
    favicon_path text,
    PRIMARY KEY (user_id, project_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_projection_projects_updated_at
    ON projection_projects (user_id, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_projection_projects_workspace_root_deleted_at
    ON projection_projects (user_id, workspace_root, deleted_at)`,

  // projection_threads (005, 010, 012, 016, 017, 023, 033-036, 038, 042, 043)
  `CREATE TABLE IF NOT EXISTS projection_threads (
    user_id text ${c} NOT NULL,
    thread_id text ${c} NOT NULL,
    project_id text ${c} NOT NULL,
    title text NOT NULL,
    branch text,
    worktree_path text,
    latest_turn_id text ${c},
    created_at text ${c} NOT NULL,
    updated_at text ${c} NOT NULL,
    deleted_at text ${c},
    runtime_mode text ${c} NOT NULL DEFAULT 'full-access',
    interaction_mode text ${c} NOT NULL DEFAULT 'default',
    model_selection_json text,
    archived_at text ${c},
    latest_user_message_at text ${c},
    pending_approval_count integer NOT NULL DEFAULT 0,
    pending_user_input_count integer NOT NULL DEFAULT 0,
    has_actionable_proposed_plan integer NOT NULL DEFAULT 0,
    settled_override text ${c},
    settled_at text ${c},
    snoozed_until text ${c},
    snoozed_at text ${c},
    title_regeneration_request_id text ${c},
    title_regeneration_started_at text ${c},
    pinned_at text ${c},
    pin_order_key text ${c},
    linked_pull_request_json text,
    unsettled_at text ${c},
    PRIMARY KEY (user_id, thread_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_projection_threads_project_id
    ON projection_threads (user_id, project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_projection_threads_project_archived_at
    ON projection_threads (user_id, project_id, archived_at)`,
  `CREATE INDEX IF NOT EXISTS idx_projection_threads_project_deleted_created
    ON projection_threads (user_id, project_id, deleted_at, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_projection_threads_shell_active
    ON projection_threads (user_id, deleted_at, archived_at, project_id, created_at, thread_id)`,
  `CREATE INDEX IF NOT EXISTS idx_projection_threads_shell_archived
    ON projection_threads (user_id, deleted_at, archived_at, project_id, thread_id)`,

  // projection_thread_messages (005, 007, 029). SQLite's (thread_id, created_at)
  // and (thread_id, sequence) indexes are prefixes of the 029 indexes and are dropped.
  `CREATE TABLE IF NOT EXISTS projection_thread_messages (
    user_id text ${c} NOT NULL,
    message_id text ${c} NOT NULL,
    thread_id text ${c} NOT NULL,
    turn_id text ${c},
    role text ${c} NOT NULL,
    text text NOT NULL,
    is_streaming integer NOT NULL,
    created_at text ${c} NOT NULL,
    updated_at text ${c} NOT NULL,
    attachments_json text,
    PRIMARY KEY (user_id, message_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_projection_thread_messages_thread_created_id
    ON projection_thread_messages (user_id, thread_id, created_at, message_id)`,

  // projection_thread_activities (005, 008, 029)
  `CREATE TABLE IF NOT EXISTS projection_thread_activities (
    user_id text ${c} NOT NULL,
    activity_id text ${c} NOT NULL,
    thread_id text ${c} NOT NULL,
    turn_id text ${c},
    tone text ${c} NOT NULL,
    kind text ${c} NOT NULL,
    summary text NOT NULL,
    payload_json text NOT NULL,
    created_at text ${c} NOT NULL,
    sequence bigint,
    PRIMARY KEY (user_id, activity_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_projection_thread_activities_thread_created
    ON projection_thread_activities (user_id, thread_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_projection_thread_activities_thread_sequence_created_id
    ON projection_thread_activities (user_id, thread_id, sequence NULLS FIRST, created_at, activity_id)`,

  // projection_thread_sessions (005, 006, 028)
  `CREATE TABLE IF NOT EXISTS projection_thread_sessions (
    user_id text ${c} NOT NULL,
    thread_id text ${c} NOT NULL,
    status text ${c} NOT NULL,
    provider_name text ${c},
    provider_session_id text ${c},
    provider_thread_id text ${c},
    active_turn_id text ${c},
    last_error text,
    updated_at text ${c} NOT NULL,
    runtime_mode text ${c} NOT NULL DEFAULT 'full-access',
    provider_instance_id text ${c},
    PRIMARY KEY (user_id, thread_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_projection_thread_sessions_provider_session
    ON projection_thread_sessions (user_id, provider_session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_projection_thread_sessions_instance
    ON projection_thread_sessions (user_id, provider_instance_id)`,

  // projection_turns (005, 015, 037) — row_id keeps SQLite's surrogate key.
  `CREATE TABLE IF NOT EXISTS projection_turns (
    row_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id text ${c} NOT NULL,
    thread_id text ${c} NOT NULL,
    turn_id text ${c},
    pending_message_id text ${c},
    assistant_message_id text ${c},
    state text ${c} NOT NULL,
    requested_at text ${c} NOT NULL,
    started_at text ${c},
    completed_at text ${c},
    checkpoint_turn_count integer,
    checkpoint_ref text ${c},
    checkpoint_status text ${c},
    checkpoint_files_json text NOT NULL,
    source_proposed_plan_thread_id text ${c},
    source_proposed_plan_id text ${c},
    UNIQUE (user_id, thread_id, turn_id),
    UNIQUE (user_id, thread_id, checkpoint_turn_count)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_projection_turns_thread_requested
    ON projection_turns (user_id, thread_id, requested_at)`,
  `CREATE INDEX IF NOT EXISTS idx_projection_turns_thread_checkpoint_completed
    ON projection_turns (user_id, thread_id, checkpoint_turn_count, completed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_projection_turns_thread_keyset
    ON projection_turns (user_id, thread_id, requested_at, turn_id NULLS FIRST)`,

  // projection_pending_approvals (005, 025)
  `CREATE TABLE IF NOT EXISTS projection_pending_approvals (
    user_id text ${c} NOT NULL,
    request_id text ${c} NOT NULL,
    thread_id text ${c} NOT NULL,
    turn_id text ${c},
    status text ${c} NOT NULL,
    decision text ${c},
    created_at text ${c} NOT NULL,
    resolved_at text ${c},
    PRIMARY KEY (user_id, request_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_projection_pending_approvals_thread_status
    ON projection_pending_approvals (user_id, thread_id, status)`,

  // projection_state (005)
  `CREATE TABLE IF NOT EXISTS projection_state (
    user_id text ${c} NOT NULL,
    projector text ${c} NOT NULL,
    last_applied_sequence bigint NOT NULL,
    updated_at text ${c} NOT NULL,
    PRIMARY KEY (user_id, projector)
  )`,

  // projection_thread_proposed_plans (013, 014)
  `CREATE TABLE IF NOT EXISTS projection_thread_proposed_plans (
    user_id text ${c} NOT NULL,
    plan_id text ${c} NOT NULL,
    thread_id text ${c} NOT NULL,
    turn_id text ${c},
    plan_markdown text NOT NULL,
    created_at text ${c} NOT NULL,
    updated_at text ${c} NOT NULL,
    implemented_at text ${c},
    implementation_thread_id text ${c},
    PRIMARY KEY (user_id, plan_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_projection_thread_proposed_plans_thread_created
    ON projection_thread_proposed_plans (user_id, thread_id, created_at)`,

  // auth_pairing_links / auth_sessions (020-022, 031, 032, 041). The hub replaces
  // pairing and bearer sessions with a signed gateway identity; kept for parity.
  `CREATE TABLE IF NOT EXISTS auth_pairing_links (
    user_id text ${c} NOT NULL,
    id text ${c} NOT NULL,
    credential text ${c} NOT NULL,
    method text ${c} NOT NULL,
    scopes text NOT NULL,
    subject text ${c} NOT NULL,
    label text,
    created_at text ${c} NOT NULL,
    expires_at text ${c} NOT NULL,
    consumed_at text ${c},
    revoked_at text ${c},
    proof_key_thumbprint text ${c},
    PRIMARY KEY (user_id, id),
    UNIQUE (credential)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_auth_pairing_links_active
    ON auth_pairing_links (user_id, revoked_at, consumed_at, expires_at)`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    user_id text ${c} NOT NULL,
    session_id text ${c} NOT NULL,
    subject text ${c} NOT NULL,
    scopes text NOT NULL,
    method text ${c} NOT NULL,
    client_label text,
    client_ip_address text,
    client_user_agent text,
    client_device_type text ${c} NOT NULL DEFAULT 'unknown',
    client_os text,
    client_browser text,
    issued_at text ${c} NOT NULL,
    expires_at text ${c} NOT NULL,
    last_connected_at text ${c},
    revoked_at text ${c},
    client_surface text ${c},
    client_app_version text,
    PRIMARY KEY (user_id, session_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_auth_sessions_active
    ON auth_sessions (user_id, revoked_at, expires_at, issued_at)`,
];

/** Tables whose rows belong to one hub user; used by tests and the RLS backstop. */
export const HUB_TENANT_TABLES = [
  "orchestration_events",
  "orchestration_command_receipts",
  "checkpoint_diff_blobs",
  "provider_session_runtime",
  "projection_projects",
  "projection_threads",
  "projection_thread_messages",
  "projection_thread_activities",
  "projection_thread_sessions",
  "projection_turns",
  "projection_pending_approvals",
  "projection_state",
  "projection_thread_proposed_plans",
  "auth_pairing_links",
  "auth_sessions",
] as const;

/**
 * Optional row-level-security backstop. Policies compare `user_id` with the
 * transaction-local `hub.user_id` setting, so a statement that runs without a
 * tenant context sees no rows and cannot insert (fails closed). Table owners
 * bypass RLS unless FORCE is set, so the backstop applies to a non-owner role.
 */
export const hubRowLevelSecurityStatements = (tables: ReadonlyArray<string> = HUB_TENANT_TABLES) =>
  tables.flatMap((table) => [
    `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`,
    `DROP POLICY IF EXISTS hub_tenant_isolation ON ${table}`,
    `CREATE POLICY hub_tenant_isolation ON ${table}
      USING (user_id = current_setting('hub.user_id', true))
      WITH CHECK (user_id = current_setting('hub.user_id', true))`,
  ]);
