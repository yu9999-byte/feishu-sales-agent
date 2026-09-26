-- Copy this file to a local, ignored file and replace every <...> value.
-- Do not put App Secret, access token, verification token, or encrypt key here.

BEGIN;

INSERT INTO agent_tenants (
  id,
  feishu_tenant_key,
  name,
  status
)
VALUES (
  '<tenant_uuid>'::uuid,
  '<feishu_tenant_key>',
  'P0 演示企业',
  'active'
)
ON CONFLICT (id) DO UPDATE SET
  feishu_tenant_key = EXCLUDED.feishu_tenant_key,
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO tenant_integrations (
  tenant_id,
  app_id,
  app_secret_env,
  app_type,
  base_mapping,
  enabled
)
VALUES (
  '<tenant_uuid>'::uuid,
  'cli_aa211d0457381bdf',
  'FEISHU_APP_SECRET',
  'selfBuild',
  $json$
  {
    "appToken": "<base_app_token>",
    "customers": {
      "tableId": "<customer_table_id>",
      "primaryField": "客户名称",
      "fields": {
        "customerName": "客户名称",
        "contactName": "联系人",
        "ownerOpenId": "负责人",
        "latestSummary": "最新跟进摘要",
        "lastFollowupAt": "最后跟进时间"
      }
    },
    "opportunities": {
      "tableId": "<opportunity_table_id>",
      "primaryField": "商机名称",
      "fields": {
        "opportunityName": "商机名称",
        "customerLink": "关联客户",
        "expectedAmount": "预计金额",
        "progress": "当前进展",
        "nextAction": "下一步",
        "dueAt": "截止时间",
        "ownerOpenId": "负责人"
      }
    },
    "followups": {
      "tableId": "<followup_table_id>",
      "primaryField": "跟进标题",
      "fields": {
        "sourceMessageId": "来源消息ID",
        "customerLink": "关联客户",
        "opportunityLink": "关联商机",
        "rawText": "跟进原文",
        "summary": "跟进摘要",
        "customerNeeds": "客户需求",
        "objections": "客户异议",
        "risks": "风险",
        "nextAction": "下一步",
        "dueAt": "截止时间",
        "communicationAt": "本次沟通发生时间",
        "ownerOpenId": "负责人"
      }
    }
  }
  $json$::jsonb,
  true
)
ON CONFLICT (tenant_id) DO UPDATE SET
  app_id = EXCLUDED.app_id,
  app_secret_env = EXCLUDED.app_secret_env,
  app_type = EXCLUDED.app_type,
  base_mapping = EXCLUDED.base_mapping,
  enabled = EXCLUDED.enabled,
  updated_at = CURRENT_TIMESTAMP;

COMMIT;
