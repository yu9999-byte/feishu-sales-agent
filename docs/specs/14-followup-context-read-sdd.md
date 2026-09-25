# 跟进计划与业务上下文读取 SDD

状态：`Approved / Goal v2 / implementation in progress 2026-09-25`

关联路线：`P1-CTX`。关联需求：`CTX-001..012`。

## 1. 目标

让销售跟进 Agent 在生成最终可见草稿前读取当前销售本人拥有的客户、联系人、商机、近期跟进
和分配给本人的飞书任务，并将外部数据转换为稳定的领域上下文。后续的状态判断、信息缺口和下一步建议
必须引用这份上下文，而不是只依赖本次消息或模型记忆。

本切片只增加“读事实”的能力，不改变现有确认门和写入顺序：查询阶段不得写入客户、商机、
跟进、任务或待确认动作。

## 2. 范围与非目标

### 2.1 本切片实现

- 按 `tenantId + actor` 解析授权范围和数据源绑定。
- 当前切片只读本人数据：客户/商机/跟进均要求 owner 字段映射并过滤当前 open_id；任务按当前 open_id 的 assignee 过滤。团队/主管范围需等机器人角色授权和数据范围服务完成后另行实现。
- 查询客户、联系人、商机、近期跟进和当前销售任务。
- 将供应商字段映射到领域模型，禁止 Base 列名泄漏到 Agent 推理层。
- 支持唯一匹配、无匹配、多匹配、权限不足、跨租户、来源冲突和外部读取失败。
- 为每个事实保留 `sourceRef`、`sourceVersion`、读取时间和授权范围摘要。
- 把只读上下文注入 LangGraph 跟进草稿节点；查询失败时明确降级，不伪造已读取事实。

### 2.2 本切片不实现

- 不修改商机阶段、金额、预计成交时间或客户主数据。
- 不创建或更新飞书任务，不发送提醒或外部消息。
- 不使用 Mem0 作为客户、商机、跟进或任务事实源。
- 本轮已接入飞书机器人和 Web 草案链；Web 使用同一只读上下文端口，并将上下文快照随草案版本持久化和返回。真实 Web/飞书 UI 仍需单独验收，不能用自动化结果代替。
- 不实现商机评分、赢单预测、主动扫描和主管升级；这些属于后续 P1-FULFILL/P1-PROGRESS 切片。

## 3. 领域模型

查询端口返回以下模型，不暴露 Base 的列名、飞书 Task 原始响应或供应商 record ID 以外的内部结构：

```text
SalesContext {
  tenantId
  actorId
  asOf
  customer?: CustomerContext
  contacts: ContactContext[]
  opportunities: OpportunityContext[]
  recentFollowups: FollowupContext[]
  tasks: TaskContext[]
  matches: EntityMatchSummary
  warnings: ContextWarning[]
  sources: ContextSource[]
}
```

所有实体带 `externalRef(provider, bindingId, objectType, externalId, sourceVersion)`；
`warnings` 记录不确定性，不能静默从多个实体中选择一个。

## 4. 查询和匹配契约

1. 文本跟进先做不持久化、不展示的实体预识别；随后按可信 `tenantId`、当前操作者和解析出的名称读取上下文，再生成最终草稿。客户端不能提交可信租户或权限范围。
2. 所有子查询都带租户和授权范围；任何跨租户引用、猜测 ID 或无权限记录返回统一的不可见结果。
3. 唯一匹配可进入草稿上下文；无匹配必须生成澄清问题或空上下文；多匹配必须列出候选并暂停自动抽取。
4. 客户多匹配不得继续读取关联商机/任务；近期跟进按 Base `last_modified_time` 倒序展示，最多 5 条。
5. 客户、商机、跟进或任务的来源版本冲突时保留各版本和警告，不覆盖较新的事实。
6. 查询失败、超时或部分数据源不可用时，返回可解释的降级状态；不得让模型声称“已读取”不存在的事实。
7. 查询端口必须可证明零业务写入，审计最多追加只读查询事件且不得保存原始客户正文。

## 5. LangGraph 集成边界

```text
消息意图路由
  -> 不持久化的实体预识别
  -> context.read（只读）
  -> 唯一匹配/澄清/冲突判断
  -> 跟进草稿与证据
  -> 现有预览/人工确认/执行链
```

`context.read` 失败或需要澄清时不得进入 Base/Task 写入节点。确认执行仍沿用
“客户/商机/跟进持久化 -> 任务创建”的既有顺序。

## 6. 完成条件

- 端口、领域模型和授权范围在规格与共享类型中冻结。
- Red/Green 覆盖正常、无匹配、多匹配、权限、跨租户、冲突、超时、重复读取和零写入。
- 查询上下文能被草稿节点消费，并在来源引用中回指外部记录。
- Agent 回归、Postgres 集成、类型、Lint、构建和 `git diff --check` 通过。
- 真实飞书/Web 只读查询和草稿展示完成后，才能把 `CTX-001..012` 标记 `UI Verified`；否则保持 `Automated Green / UI pending` 或 `Partial`。
