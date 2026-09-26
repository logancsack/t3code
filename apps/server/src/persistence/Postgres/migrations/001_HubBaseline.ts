/**
 * Hub baseline: the standalone SQLite schema after its migration 043, plus the
 * state a standalone server keeps as files, keyed by tenant. The standalone
 * `checkpoint_diff_blobs` table (never written) is left out: the hub's per-turn
 * diff cache is `hub_checkpoint_turn_diffs` (migration 050).
 *
 * Tenancy is a `user_id` column that leads every primary key, unique
 * constraint, and index. Every table has a row-level-security policy that
 * compares `user_id` with the transaction-local `hub.user_id` setting (see
 * `HubClient.ts`); `FORCE` makes it apply to the table owner too, so only
 * superusers and `BYPASSRLS` roles skip it.
 *
 * Dialect decisions the queries depend on:
 * - Every compared or ordered text column uses `COLLATE "C"`, matching SQLite's
 *   BINARY ordering (the thread-detail keyset relies on bytewise "~" and ""
 *   sentinels) whatever the database default collation is.
 * - Nullable sort keys are indexed `NULLS FIRST`, SQLite's NULL ordering.
 * - JSON stays in `text` columns: repositories decode with `fromJsonString`,
 *   and `jsonb` rejects the `\u0000` escapes that JSON.stringify can emit.
 * - Boolean-like columns stay integers so row decoding matches SQLite.
 * - SQLite's global `orchestration_events.sequence AUTOINCREMENT` becomes a
 *   per-user counter in `hub_users.last_event_sequence`, allocated inside the
 *   append transaction, so sequences stay gap-free per user.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const c = `COLLATE "C"`;

export const HUB_BASELINE_TENANT_TABLES = [
  "hub_users",
  "hub_documents",
  "hub_secrets",
  "hub_attachments",
  "orchestration_events",
  "orchestration_command_receipts",
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

/** Enables the fail-closed tenant policy on a table (idempotent). */
export const hubTenantPolicyStatements = (table: string): ReadonlyArray<string> => [
  `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS hub_tenant_isolation ON ${table}`,
  `CREATE POLICY hub_tenant_isolation ON ${table}
    USING (user_id = current_setting('hub.user_id', true))
    WITH CHECK (user_id = current_setting('hub.user_id', true))`,
];

const statements: ReadonlyArray<string> = [
  // Per-user event sequence counter.
  `CREATE TABLE hub_users (
    user_id text ${c} PRIMARY KEY,
    last_event_sequence bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // Small documents a standalone server keeps as files in its state directory:
  // settings.json, keybindings.json, environment-id, anonymous-id.
  `CREATE TABLE hub_documents (
    user_id text ${c} NOT NULL,
    name text ${c} NOT NULL,
    contents text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, name)
  )`,

  // ServerSecretStore values, AES-256-GCM encrypted with T3CODE_HUB_SECRET_KEY.
  `CREATE TABLE hub_secrets (
    user_id text ${c} NOT NULL,
    name text ${c} NOT NULL,
    format smallint NOT NULL,
    nonce bytea NOT NULL,
    ciphertext bytea NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, name)
  )`,

  // Attachment bytes. The local attachments directory is a disposable cache.
  `CREATE TABLE hub_attachments (
    user_id text ${c} NOT NULL,
    relative_path text ${c} NOT NULL,
    attachment_id text ${c} NOT NULL,
    thread_segment text ${c} NOT NULL,
    size_bytes bigint NOT NULL,
    content bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, relative_path)
  )`,
  `CREATE INDEX idx_hub_attachments_attachment_id
    ON hub_attachments (user_id, attachment_id)`,
  `CREATE INDEX idx_hub_attachments_thread_segment
    ON hub_attachments (user_id, thread_segment, created_at)`,

  // orchestration_events (SQLite 001) — sequence is per user.
  `CREATE TABLE orchestration_events (
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
  `CREATE UNIQUE INDEX idx_orch_events_stream_version
    ON orchestration_events (user_id, aggregate_kind, stream_id, stream_version)`,
  `CREATE INDEX idx_orch_events_stream_sequence
    ON orchestration_events (user_id, aggregate_kind, stream_id, sequence)`,
  `CREATE INDEX idx_orch_events_command_id
    ON orchestration_events (user_id, command_id)`,
  `CREATE INDEX idx_orch_events_correlation_id
    ON orchestration_events (user_id, correlation_id)`,

  // orchestration_command_receipts (002)
  `CREATE TABLE orchestration_command_receipts (
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
  `CREATE INDEX idx_orch_command_receipts_aggregate
    ON orchestration_command_receipts (user_id, aggregate_kind, aggregate_id)`,
  `CREATE INDEX idx_orch_command_receipts_sequence
    ON orchestration_command_receipts (user_id, result_sequence)`,

  // provider_session_runtime (004, 009, 027)
  `CREATE TABLE provider_session_runtime (
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
  `CREATE INDEX idx_provider_session_runtime_status
    ON provider_session_runtime (user_id, status)`,
  `CREATE INDEX idx_provider_session_runtime_provider
    ON provider_session_runtime (user_id, provider_name)`,
  `CREATE INDEX idx_provider_session_runtime_instance
    ON provider_session_runtime (user_id, provider_instance_id)`,

  // projection_projects (005, 039, 040). repository_identity_json is hub-only:
  // a hub has no checkout to run `git remote` in, so the identity is stored.
  `CREATE TABLE projection_projects (
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
    repository_identity_json text,
    PRIMARY KEY (user_id, project_id)
  )`,
  `CREATE INDEX idx_projection_projects_updated_at
    ON projection_projects (user_id, updated_at)`,
  `CREATE INDEX idx_projection_projects_workspace_root_deleted_at
    ON projection_projects (user_id, workspace_root, deleted_at)`,

  // projection_threads (005, 010, 012, 016, 017, 023, 033-036, 038, 042, 043)
  `CREATE TABLE projection_threads (
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
  `CREATE INDEX idx_projection_threads_project_id
    ON projection_threads (user_id, project_id)`,
  `CREATE INDEX idx_projection_threads_project_archived_at
    ON projection_threads (user_id, project_id, archived_at)`,
  `CREATE INDEX idx_projection_threads_project_deleted_created
    ON projection_threads (user_id, project_id, deleted_at, created_at)`,
  `CREATE INDEX idx_projection_threads_shell_active
    ON projection_threads (user_id, deleted_at, archived_at, project_id, created_at, thread_id)`,
  `CREATE INDEX idx_projection_threads_shell_archived
    ON projection_threads (user_id, deleted_at, archived_at, project_id, thread_id)`,

  // projection_thread_messages (005, 007, 029). SQLite's (thread_id, created_at)
  // and (thread_id, sequence) indexes are prefixes of the 029 index.
  `CREATE TABLE projection_thread_messages (
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
  `CREATE INDEX idx_projection_thread_messages_thread_created_id
    ON projection_thread_messages (user_id, thread_id, created_at, message_id)`,

  // projection_thread_activities (005, 008, 029)
  `CREATE TABLE projection_thread_activities (
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
  `CREATE INDEX idx_projection_thread_activities_thread_created
    ON projection_thread_activities (user_id, thread_id, created_at)`,
  `CREATE INDEX idx_projection_thread_activities_thread_sequence_created_id
    ON projection_thread_activities (user_id, thread_id, sequence NULLS FIRST, created_at, activity_id)`,

  // projection_thread_sessions (005, 006, 028)
  `CREATE TABLE projection_thread_sessions (
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
  `CREATE INDEX idx_projection_thread_sessions_provider_session
    ON projection_thread_sessions (user_id, provider_session_id)`,
  `CREATE INDEX idx_projection_thread_sessions_instance
    ON projection_thread_sessions (user_id, provider_instance_id)`,

  // projection_turns (005, 015, 037). row_id keeps SQLite's surrogate key.
  `CREATE TABLE projection_turns (
    user_id text ${c} NOT NULL,
    row_id bigint GENERATED ALWAYS AS IDENTITY,
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
    PRIMARY KEY (user_id, row_id),
    UNIQUE (user_id, thread_id, turn_id),
    UNIQUE (user_id, thread_id, checkpoint_turn_count)
  )`,
  `CREATE INDEX idx_projection_turns_thread_requested
    ON projection_turns (user_id, thread_id, requested_at)`,
  `CREATE INDEX idx_projection_turns_thread_checkpoint_completed
    ON projection_turns (user_id, thread_id, checkpoint_turn_count, completed_at)`,
  `CREATE INDEX idx_projection_turns_thread_keyset
    ON projection_turns (user_id, thread_id, requested_at, turn_id NULLS FIRST)`,

  // projection_pending_approvals (005, 025)
  `CREATE TABLE projection_pending_approvals (
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
  `CREATE INDEX idx_projection_pending_approvals_thread_status
    ON projection_pending_approvals (user_id, thread_id, status)`,

  // projection_state (005)
  `CREATE TABLE projection_state (
    user_id text ${c} NOT NULL,
    projector text ${c} NOT NULL,
    last_applied_sequence bigint NOT NULL,
    updated_at text ${c} NOT NULL,
    PRIMARY KEY (user_id, projector)
  )`,

  // projection_thread_proposed_plans (013, 014)
  `CREATE TABLE projection_thread_proposed_plans (
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
  `CREATE INDEX idx_projection_thread_proposed_plans_thread_created
    ON projection_thread_proposed_plans (user_id, thread_id, created_at)`,

  // auth_pairing_links / auth_sessions (020-022, 031, 032, 041): the hub keeps
  // T3's pairing links, browser sessions, and bearer sessions.
  `CREATE TABLE auth_pairing_links (
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
    UNIQUE (user_id, credential)
  )`,
  `CREATE INDEX idx_auth_pairing_links_active
    ON auth_pairing_links (user_id, revoked_at, consumed_at, expires_at)`,
  `CREATE TABLE auth_sessions (
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
  `CREATE INDEX idx_auth_sessions_active
    ON auth_sessions (user_id, revoked_at, expires_at, issued_at)`,

  ...HUB_BASELINE_TENANT_TABLES.flatMap(hubTenantPolicyStatements),
];

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of statements) {
    yield* sql.unsafe(statement);
  }
});
