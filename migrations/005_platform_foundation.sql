BEGIN;

ALTER TABLE agent_tenants
  ADD COLUMN IF NOT EXISTS timezone varchar(100)
    NOT NULL DEFAULT 'Asia/Shanghai';

CREATE TABLE IF NOT EXISTS tenant_members (
  tenant_id uuid NOT NULL
    REFERENCES agent_tenants(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  feishu_open_id varchar(255) NOT NULL,
  feishu_union_id varchar(255),
  feishu_user_id varchar(255),
  display_name varchar(200) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, feishu_open_id),
  UNIQUE (tenant_id, feishu_union_id),
  UNIQUE (tenant_id, feishu_user_id)
);

CREATE TABLE IF NOT EXISTS role_assignments (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL,
  role varchar(30) NOT NULL
    CHECK (role IN ('sales', 'manager', 'executive', 'admin')),
  valid_from timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_to timestamptz,
  assigned_by_member_id uuid,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, member_id)
    REFERENCES tenant_members(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, assigned_by_member_id)
    REFERENCES tenant_members(tenant_id, id),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE TABLE IF NOT EXISTS reporting_relations (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  manager_member_id uuid NOT NULL,
  report_member_id uuid NOT NULL,
  source varchar(100) NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, manager_member_id)
    REFERENCES tenant_members(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, report_member_id)
    REFERENCES tenant_members(tenant_id, id) ON DELETE CASCADE,
  CHECK (manager_member_id <> report_member_id),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE TABLE IF NOT EXISTS resource_grants (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  grantee_member_id uuid NOT NULL,
  resource_type varchar(100) NOT NULL,
  resource_ref varchar(255) NOT NULL,
  permission varchar(100) NOT NULL,
  grantor_member_id uuid NOT NULL,
  reason varchar(500) NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, grantee_member_id)
    REFERENCES tenant_members(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, grantor_member_id)
    REFERENCES tenant_members(tenant_id, id),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE TABLE IF NOT EXISTS data_source_bindings (
  tenant_id uuid NOT NULL
    REFERENCES agent_tenants(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  provider varchar(50) NOT NULL,
  credential_ref varchar(255) NOT NULL,
  object_mappings jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, provider, version),
  CHECK (version > 0)
);

CREATE TABLE IF NOT EXISTS platform_audit_events (
  tenant_id uuid NOT NULL
    REFERENCES agent_tenants(id) ON DELETE CASCADE,
  id bigint GENERATED ALWAYS AS IDENTITY,
  trace_id varchar(255) NOT NULL,
  actor_member_id uuid,
  role_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  action varchar(100) NOT NULL,
  resource_type varchar(100) NOT NULL,
  resource_ref_hash varchar(64),
  outcome varchar(30) NOT NULL
    CHECK (outcome IN ('allowed', 'denied', 'succeeded', 'failed')),
  reason_code varchar(100) NOT NULL,
  policy_version varchar(100) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, actor_member_id)
    REFERENCES tenant_members(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS platform_event_consumptions (
  tenant_id uuid NOT NULL
    REFERENCES agent_tenants(id) ON DELETE CASCADE,
  event_id varchar(255) NOT NULL,
  consumer varchar(150) NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, event_id, consumer)
);

CREATE INDEX IF NOT EXISTS idx_role_assignments_active
  ON role_assignments (tenant_id, member_id, valid_from, valid_to);

CREATE INDEX IF NOT EXISTS idx_reporting_relations_manager
  ON reporting_relations (
    tenant_id,
    manager_member_id,
    valid_from,
    valid_to
  );

CREATE INDEX IF NOT EXISTS idx_resource_grants_grantee
  ON resource_grants (
    tenant_id,
    grantee_member_id,
    resource_type,
    resource_ref,
    valid_to
  );

CREATE INDEX IF NOT EXISTS idx_platform_audit_trace
  ON platform_audit_events (tenant_id, trace_id, occurred_at DESC);

COMMIT;
