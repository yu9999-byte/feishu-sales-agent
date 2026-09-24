BEGIN;

CREATE TABLE IF NOT EXISTS agent_tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feishu_tenant_key varchar(255) NOT NULL UNIQUE,
  name varchar(200) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenant_integrations (
  tenant_id uuid PRIMARY KEY REFERENCES agent_tenants(id) ON DELETE CASCADE,
  app_id varchar(255) NOT NULL,
  app_secret_env varchar(255) NOT NULL,
  app_type varchar(30) NOT NULL DEFAULT 'selfBuild'
    CHECK (app_type IN ('selfBuild', 'isv')),
  base_mapping jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS processed_messages (
  tenant_id uuid NOT NULL REFERENCES agent_tenants(id) ON DELETE CASCADE,
  message_id varchar(255) NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, message_id)
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  tenant_id uuid NOT NULL REFERENCES agent_tenants(id) ON DELETE CASCADE,
  actor_open_id varchar(255) NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  chat_id varchar(255) NOT NULL,
  state varchar(30) NOT NULL
    CHECK (state IN ('collecting', 'pendingConfirmation', 'closed')),
  source_message_id varchar(255) NOT NULL,
  raw_text text NOT NULL,
  draft jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, actor_open_id),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS pending_actions (
  tenant_id uuid NOT NULL REFERENCES agent_tenants(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  actor_open_id varchar(255) NOT NULL,
  chat_id varchar(255) NOT NULL,
  card_message_id varchar(255),
  status varchar(30) NOT NULL
    CHECK (
      status IN (
        'pendingConfirmation',
        'executing',
        'succeeded',
        'partialFailure',
        'failed',
        'cancelled',
        'expired'
      )
    ),
  payload jsonb NOT NULL,
  result jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS agent_task_mappings (
  tenant_id uuid NOT NULL,
  pending_action_id uuid NOT NULL,
  followup_record_id varchar(255) NOT NULL,
  task_guid varchar(255) NOT NULL,
  task_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, pending_action_id),
  UNIQUE (tenant_id, task_guid),
  FOREIGN KEY (tenant_id, pending_action_id)
    REFERENCES pending_actions(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES agent_tenants(id) ON DELETE CASCADE,
  trace_id varchar(255) NOT NULL,
  event_type varchar(100) NOT NULL,
  actor_open_id varchar(255),
  entity_id varchar(255),
  outcome varchar(30) NOT NULL
    CHECK (outcome IN ('accepted', 'ignored', 'succeeded', 'failed')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_expiry
  ON agent_sessions (tenant_id, state, expires_at);

CREATE INDEX IF NOT EXISTS idx_pending_actions_actor_status
  ON pending_actions (tenant_id, actor_open_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_audit_events_trace
  ON audit_events (tenant_id, trace_id, created_at DESC);

COMMIT;
