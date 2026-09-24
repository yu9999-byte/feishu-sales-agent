# 系统与数据设计规格

状态：`Approved / 2026-09-20`。卡片编排增量采用
[跟进卡片决策问答](../decisions/2026-09-20-followup-chat-cards.md)。
对话先路由与可用性反馈按
[新决策](../decisions/2026-09-20-conversation-and-quality.md) 覆盖旧评分展示口径。

## 1. 目标架构

```text
飞书消息/卡片/语音/妙记/文档       Web 应用
              \                    /
               身份与租户解析层
                       |
              权限与数据范围服务
                       |
        Intent Router / Conversation Orchestrator
          |          |          |          |
       Ingestion   Usability  Sia/RAG    Reporting
          |          |          |          |
                  Tool Gateway
             /         |          \
          Base       Feishu Task   Feishu IM/Docs
                       |
                Control PostgreSQL
```

Web 业务 API 与机器人 Agent 共享领域服务、授权服务和工具端口，不能分别实现两套业务规则。

## 2. 事实源边界

| 数据类别 | 权威来源 | 内部保存规则 |
| --- | --- | --- |
| 客户、联系人、商机、跟进 | 租户绑定的 Base | 只保存外部引用、必要快照和派生结果 |
| 飞书任务状态 | 飞书任务 | 保存绑定关系、同步游标和最近状态快照 |
| 原始语音/妙记/文档 | 飞书对应资源 | 保存资源引用、版本、权限快照和必要文本摘要 |
| 租户、身份、角色、策略 | Agent Postgres | 作为授权与编排事实源 |
| 草案、质检、洞察、报告 | Agent Postgres | 带租户、来源版本、模型/规则版本 |
| 知识索引 | Agent 管理的检索存储 | 每个块带租户、来源资源和 ACL 快照 |
| Playbook | Agent Postgres | 版本化并保留发布审计 |

Base 通过 `SalesDataSourcePort` 访问。未来 CRM 连接器只能实现同一端口，不能把供应商字段泄漏
到领域服务和页面 API。

## 3. 领域模块

| 模块 | 职责 |
| --- | --- |
| `tenant-control` | 租户、集成、开关、时区和运行策略 |
| `identity-access` | 飞书身份映射、成员、角色、汇报关系、共享和授权 |
| `ingestion` | 多模态输入作业、来源读取、标准文本和状态 |
| `followup` | 草案、版本、质检、确认和写入编排 |
| `sales-data` | 客户/商机/跟进的抽象查询与写入端口 |
| `task-sync` | 飞书任务创建、回收、提醒和幂等映射 |
| `insight` | 项目健康度、风险、建议和证据 |
| `knowledge` | 文档索引、ACL、检索和来源引用 |
| `assistant` | 意图、多轮上下文、问答与操作预览 |
| `reporting` | 日报、周报、Review、指标和快照 |
| `playbook` | 最佳实践候选、版本、审核、发布和效果事件 |
| `notification` | 策略路由、去重、投递、回执和重试 |
| `audit` | 不可变审计事件和追踪查询 |

## 4. 核心内部实体

所有实体均包含 `tenantId`，跨租户外键或查询在模型层禁止。

| 实体 | 关键字段 |
| --- | --- |
| `Tenant` | id、tenantKey、status、timezone |
| `TenantMember` | id、user/open/union id 映射、status |
| `RoleAssignment` | memberId、role、validFrom/To |
| `ReportingRelation` | managerId、reportId、source、validFrom/To |
| `ResourceGrant` | resourceType/ref、grantee、permission、expiry |
| `DataSourceBinding` | provider、credentialRef、object/field mappings、version |
| `IngestionJob` | sourceType/ref/version、actor、status、error、traceId |
| `FollowupDraft` | versions、sourceChatId/cardMessageId、generatedText、structuredFacts、evidence、status |
| `TaskCandidate` | draftId/version、标题、截止时间、负责人提示、关联对象、证据、selected、status |
| `QualityAssessment` | score、dimensions、gaps、risks、policy/model version |
| `SalesSignal` | type、severity、evidence、resourceRef、lifecycle |
| `ExternalTaskBinding` | internalActionId、taskGuid、status、sync cursor |
| `NotificationDelivery` | rule、recipient、dedupeKey、status、attempts |
| `Conversation` | actor、authorized scope snapshot、expiry |
| `IntentDecision` | tenant/actor/chat/message、schemaVersion、intent、confidence、outcome；审计不存原文 |
| `KnowledgeChunk` | sourceRef/version、ACL snapshot、content hash |
| `ReportSnapshot` | type、period、scope、data version、content、status |
| `PlaybookVersion` | playbookId、version、status、content、approver |
| `PlaybookEvidence` | sample scope、metric、limitation、source refs |
| `AuditEvent` | traceId、actor、action、resourceRef、outcome、policy version |

外部客户、商机和跟进统一使用 `ExternalResourceRef`：

```text
provider + bindingId + objectType + externalId + sourceVersion
```

## 5. 契约规则

### 5.1 HTTP API

- `/api` 只提供 Web 内部接口，并从可信用户上下文解析身份。
- 请求不得接收客户端提供的 `tenantId` 或权限范围作为可信值。
- 列表采用游标分页；响应只返回当前授权范围的数据。
- 写请求包含幂等键和期望版本，冲突返回可识别错误而不是覆盖。
- 共享接口类型先定义于 `shared/api.interface.ts`，再实现服务端和前端。

### 5.2 事件

统一事件信封字段：`eventId`、`tenantId`、`traceId`、`type`、`occurredAt`、`actor`、
`resourceRef`、`payloadVersion`、`payload`。消费者以 `(tenantId,eventId,consumer)` 幂等。

首批事件包括：

- `ingestion.accepted|completed|failed`
- `followup.draft.generated|quality.assessed|confirmed|persisted`
- `sales-signal.opened|changed|resolved`
- `task.created|status.changed|overdue`
- `report.generated|delivery.failed`
- `playbook.suggestion.created|version.published`

### 5.4 原聊天卡片与一次确认契约

- 输入作业保存来源聊天，草案卡、更新及执行结果默认路由回同一聊天；Web 不能成为机器人
  来源的必经确认页。
- 保存前质检快照和任务候选绑定精确 `draftId + version`。任何编辑/重新生成产生新版本，
  旧版本及其候选不能确认。
- 确认命令包含服务端可验证的版本和候选引用，只允许创建卡中展示并被选中的本人任务；
  任务候选不是业务写入。涉及他人时先做授权并单独确认。
- 执行顺序固定为客户/商机/跟进持久化，再创建任务。前序失败时不调用 Task；后序部分失败
  保存逐步结果并只重试失败任务。
- 卡片表单提交或“检查”后异步更新整张 Card 2.0；Web 可即时计算确定性完整度，但确认时
  以服务端版本和快照为准。
- 默认确认卡呈现事实摘要、阻断项和建议补充，不突出质量数字/A–D。旧评分快照仅供兼容和
  后台规则回归；项目健康与销售辅导是不同证据和触发器。
- 项目推进质检、跨角色通知、任务提醒及报告各自由事件/outbox 触发，不作为一次录入中固定
  发送的卡。发送前重新计算策略与资源权限，AI 任务状态建议经销售确认后才调用 Task 更新。

### 5.3 LLM 输出

- 每类任务使用独立版本化 JSON Schema，禁止从自由文本解析业务字段。
- 输出包含 `facts`、`inferences`、`recommendations`、`evidenceRefs`，四者不得混写。
- 证据必须能在授权后的输入片段中定位；无法定位则验证失败。
- 保存 provider、model、prompt/schema version、输入内容哈希、延迟和 token 用量，不保存密钥。
- 对评分和预测使用固定评测集；模型更新必须回归旧版本阈值。

### 5.5 B0 对话入口契约

- `tenant_key -> tenantId`、消息去重和当前身份解析先于模型。输入至分类器的内容限当前消息、
  当前聊天最近短期消息和授权工作流片段；模型只建议意图和答复，不授予权限、不执行工具。
- 分类输出版本化 Schema：`intent`、`confidence`、`reply`；解析失败/低置信不得默认为
  `followup_capture`。自然语言意图由 LLM 结合上下文判断，代码只负责状态、权限和确认门，
  `followup_capture` 仍必须经过确认卡才可进入业务写入。
- 现有跟进补字段会话按租户、用户、原聊天与有效期绑定；显式换话题/取消不追加进原文。
- 一般聊天/销售方法/内容草稿无外部业务写入；数据查询未接通时必须显式告知，不能让模型
  声称已读取企业客户。审计记录意图、模型版本、结果类别，不记录原始客户原文。
- B0 通过 LangGraph Postgres Checkpointer 持久化同租户/用户/聊天的 thread 状态，默认最多向
  模型提供最近 12 条；长期语义记忆由 Mem0 OSS 按 ACL、来源、删除和评测策略提供，客户、商机、
  跟进和任务事实仍以确认后的 Base、Task 和控制库为准。

## 6. 多租户与安全不变量

1. 所有存储唯一键和幂等键都包含 `tenantId`。
2. 租户凭证只以 Secret 引用保存，业务表不保存明文 Secret。
3. 检索前过滤 ACL，不能先跨租户召回再在回答阶段过滤。
4. 日志使用字段白名单和脱敏；原始客户内容默认不进入应用日志。
5. 外部写入使用最小权限应用身份，并记录请求结果而不记录认证头。
6. 所有派生判断携带来源版本，来源变化后标记过期并重新计算。

## 7. 与现有 P0 的关系

- 保留 `agent-core` 状态机、控制库、飞书 Webhook、Base 和 Task 适配器的已验证行为。
- 将当前专用 `FollowupExtractor` 逐步抽成版本化生成与质检端口，不一次性重写闭环。
- 当前 `server/database/schema.ts` 中的旧单租户销售表不是 Goal v3 正式模型，不在其上继续
  堆叠新业务；正式表通过新迁移和重新生成 schema 建立。
- Web 端现为欢迎页，新增业务页前先确认本规格与设计规格。
