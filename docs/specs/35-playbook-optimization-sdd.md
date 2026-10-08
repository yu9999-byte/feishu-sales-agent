# Playbook 优化 Agent v1 — SDD

## 1. 产品结果

销售知识问答结束后，系统自动识别可信答案缺口、高频问题、来源不可用和来源版本变化，生成企业内的知识优化候选。经理、负责人或管理员可在工作台审核候选，但任何审核动作都不会直接修改飞书文档、发布 Playbook 或写入客户、商机、跟进与任务。

## 2. 信任边界

- 问答审计继续不保存问题全文、答案、正文或摘录。
- 优化候选仅保存 SHA-256 问题指纹和规则归类出的安全主题标签，不保存原始问题文本。
- 数据按 `tenant_id` 强制隔离；列表与审核中的租户、审核人一律来自可信 Web Session。
- `playbook:review` 是读取候选和执行审核的必要权限。
- v1 仅支持“进入待编写”和“忽略”；不提供发布接口。
- 审核使用 `expectedUpdatedAt` 乐观并发，候选更新与不可变审核记录在同一数据库事务中完成。
- 企业租户被正式删除时，候选和审核记录随租户级联清理，避免残留跨租户数据或阻断租户生命周期。

## 3. 候选规则

| 信号 | 初始结果 |
| --- | --- |
| `no_trusted_match` | 立即待审核：`no_trusted_answer` |
| `partial` / `unavailable` | 立即待审核：`source_unavailable` |
| 同一问题指纹累计 3 次 | 待审核：`frequent_question` |
| 同一问题命中的同一来源版本变化 | 待审核：`source_revision_changed` |
| `not_configured` | 不创建候选，由资料库配置流程处理 |

已审核候选继续累计观测次数和来源版本，但自动观测不得覆盖人工审核状态。

## 4. 状态与接口

状态：`observing` → `pending_review` → `accepted_for_authoring` / `dismissed`。

- `GET /api/platform/playbook-candidates`
- `POST /api/platform/playbook-candidates/:id/review`

审核请求包含 `decision`、`expectedUpdatedAt` 和 2–500 字审核说明。

## 5. 失败语义

- 观测失败不影响销售用户收到知识问答结果；系统写安全失败审计。
- 未登录返回 401，无权限返回 403，不存在返回 404，并发冲突返回 409，校验失败返回 422。
- 所有 API 响应禁用缓存。
