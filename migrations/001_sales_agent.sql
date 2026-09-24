BEGIN;

CREATE TABLE IF NOT EXISTS sales_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar(255),
  display_name varchar(100) NOT NULL,
  role varchar(50) NOT NULL DEFAULT 'sales',
  department varchar(100),
  target_amount bigint NOT NULL DEFAULT 0,
  avatar_color varchar(20) NOT NULL DEFAULT '#2f6bff',
  is_active boolean NOT NULL DEFAULT true,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(200) NOT NULL,
  industry varchar(100),
  size_range varchar(50),
  region varchar(100),
  website varchar(500),
  primary_contact varchar(100),
  contact_title varchar(100),
  contact_phone varchar(50),
  contact_email varchar(200),
  owner_member_id uuid REFERENCES sales_members(id) ON DELETE SET NULL,
  health_status varchar(30) NOT NULL DEFAULT 'stable',
  tags text,
  notes text,
  last_contact_at timestamptz,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  owner_member_id uuid REFERENCES sales_members(id) ON DELETE SET NULL,
  name varchar(200) NOT NULL,
  stage varchar(50) NOT NULL DEFAULT 'discovery',
  status varchar(30) NOT NULL DEFAULT 'open',
  amount bigint NOT NULL DEFAULT 0,
  probability integer NOT NULL DEFAULT 10,
  expected_close_date date,
  source varchar(100),
  summary text,
  methodology_notes text,
  risk_level varchar(30) NOT NULL DEFAULT 'low',
  next_action text,
  last_activity_at timestamptz,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  owner_member_id uuid REFERENCES sales_members(id) ON DELETE SET NULL,
  source_type varchar(30) NOT NULL DEFAULT 'text',
  channel varchar(50) NOT NULL DEFAULT 'meeting',
  occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw_content text NOT NULL,
  summary text,
  customer_needs text,
  objections text,
  decisions text,
  next_plan text,
  quality_score integer NOT NULL DEFAULT 0,
  risk_level varchar(30) NOT NULL DEFAULT 'unknown',
  ai_status varchar(30) NOT NULL DEFAULT 'pending',
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sales_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  followup_id uuid REFERENCES followups(id) ON DELETE SET NULL,
  owner_member_id uuid REFERENCES sales_members(id) ON DELETE SET NULL,
  title varchar(240) NOT NULL,
  description text,
  due_at timestamptz,
  status varchar(30) NOT NULL DEFAULT 'todo',
  priority varchar(20) NOT NULL DEFAULT 'medium',
  ai_generated boolean NOT NULL DEFAULT false,
  completion_evidence text,
  completed_at timestamptz,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sales_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  followup_id uuid REFERENCES followups(id) ON DELETE SET NULL,
  category varchar(50) NOT NULL,
  title varchar(240) NOT NULL,
  content text NOT NULL,
  evidence text,
  recommended_action text,
  severity varchar(20) NOT NULL DEFAULT 'info',
  status varchar(30) NOT NULL DEFAULT 'open',
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sales_playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(200) NOT NULL,
  stage varchar(50) NOT NULL,
  pattern text NOT NULL,
  evidence text,
  applicable_when text,
  success_signal text,
  sample_size integer NOT NULL DEFAULT 0,
  adoption_count integer NOT NULL DEFAULT 0,
  status varchar(30) NOT NULL DEFAULT 'draft',
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customers_owner ON customers(owner_member_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_customer ON opportunities(customer_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_stage ON opportunities(stage, status);
CREATE INDEX IF NOT EXISTS idx_followups_opportunity ON followups(opportunity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_owner_status ON sales_tasks(owner_member_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_insights_opportunity ON sales_insights(opportunity_id, created_at DESC);

COMMIT;
