# 对话记忆模块 SDD

状态：`Approved / 2026-09-22; memory framework migration approved / 2026-09-23`  
范围：短期对话上下文、活跃工作流上下文和长期业务事实边界  
关联决策：D-020、D-025、D-028

## 1. 目标

Agent 必须能够承接销售前几轮消息，而不是只看当前一句。记忆模块只负责保存、隔离和
组装上下文，不负责替代意图识别，也不直接执行工具。

## 2. 记忆分层

| 层级 | P0 处理方式 | 用途 |
| --- | --- | --- |
| 短期对话记忆 | LangGraph Postgres Checkpointer，租户/用户/聊天隔离，按 thread 保存状态 | 给 Graph 节点提供最近对话、工作流快照和恢复点 |
| 工作流记忆 | 现有 `agent_sessions`、`pending_actions` | 保存当前跟进原文、草案、卡片和 TTL |
| 长期业务事实 | 客户、商机、跟进、任务等已确认业务表 | 作为业务事实来源，不把聊天原文当事实 |
| 语义记忆 | Mem0 OSS；只写入经过策略批准的用户/销售偏好和可复用工作习惯 | 长期语义召回，不作为客户/商机事实源 |

## 3. 短期 thread 状态模型

迁移后的短期消息和工作流状态由 LangGraph Postgres Checkpointer 保存。每个 checkpoint 至少
能追溯以下边界字段：

- `tenant_id`：租户隔离主键；
- `actor_open_id`：销售身份；
- `chat_id`：原飞书聊天；
- `thread_id`：稳定的 `tenant_id:actor_open_id:chat_id`；
- `source_message_id`：触发本次运行的飞书消息；
- `messages`：用户/助手的受限上下文；
- `state_schema_version`：状态契约版本；
- `created_at` / `updated_at` / `expires_at`：保留和恢复边界。

同一租户、thread 和事件只允许幂等恢复一次。查询只允许按当前租户、用户和聊天过滤，按时间
升序向模型提供最近 12 条；过期状态不得进入新一轮上下文。旧 `conversation_turns` 字段映射
只用于迁移回放，不再作为新 Graph 的写入契约。

## 4. 写入与读取时序

```text
收到消息
  → 按 tenant/actor/chat 生成 thread_id 并读取 checkpoint（不含当前消息）
  → Graph 写入当前 user message（幂等）
  → 组装上下文并调用 LangChain 意图节点
  → Graph 保存 assistant 回复、草案或 interrupt 状态（幂等）
```

业务事实仍然只在确认后写入客户、商机、跟进和任务表。短期消息记忆不能绕过确认门，
也不能被当作已经确认的业务记录。

## 5. 隔离、保留和失败策略

- 所有读写都必须包含 `tenantId`、`actorOpenId` 和 `chatId`；
- 跨聊天、跨用户和跨租户不能召回上下文；
- 短期记忆过期后自然不可读，清理可由后续定时任务执行；
- 记忆写入失败不能导致重复写入 Base/Task；工作流记录审计并继续按安全降级策略处理；
- 应用日志不打印原始客户正文；
- 长期业务事实以 Base/数据库为准，聊天消息只作为来源证据。

## 6. 框架替换与外部组件边界

按 D-028，自研 `MemoryControlStore`/`conversation_turns` 已退出生产短期记忆路径，LangGraph
Postgres Checkpointer 是唯一生产 thread 状态存储；历史 `conversation_turns` 表暂不做破坏性
删除，但代码已不再读写。Checkpointer 只负责 thread 状态、短期消息、暂停/恢复和幂等恢复，
不自动提炼长期事实。

长期语义记忆选用可自托管的 Mem0 OSS。Mem0 的每条记忆必须带 `tenant_id`、`actor_open_id`、
来源引用、策略版本、过期/删除信息和置信类别；召回前做 ACL 过滤。默认不写入未经确认的客户
隐私、商机金额、风险结论、任务状态或模型推断。Mem0 写入失败不能影响已完成的业务动作。

Checkpointer 与 Mem0 不是两套同职责记忆：前者是 Graph 运行状态，后者是长期语义记忆；禁止
保留旧自研实现与新框架的长期双读双写。

## 7. 跟进承接规则

当用户表达 `followup_capture` 且当前聊天存在相关客户事实时：

1. 只把相关短期上下文送入跟进提取器；
2. 生成预填跟进表单；
3. 缺失字段在表单中标记并阻断确认，不退化为重复的意图追问；
4. 销售确认后才写入业务系统和创建勾选的任务。

没有相关上下文时打开空白跟进表单，不臆造客户、商机或下一步计划。

## 8. TDD 验收

### Red 必须覆盖

1. 两轮消息能在同一聊天被读取，第二轮模型输入包含第一轮；
2. assistant 澄清回复也进入短期记忆；
3. 其他聊天、用户和租户无法读取该上下文；
4. 过期消息不进入上下文；
5. 重复事件不会重复写入消息记忆；
6. 有上下文的 `followup_capture` 生成预填表单，确认前不写 Base/Task。

### Green 验收

- Checkpointer 能保存和恢复 Graph thread，且 `tenant_id + actor_open_id + chat_id` 隔离；
- 旧 `conversation_turns` 状态可回放到新 Graph，完成对账后不再双写；
- 工作流、模型契约和消息记忆测试通过；
- Mem0 中文召回、误记忆、删除和 ACL 测试达到门槛；
- 两租户隔离测试与现有 P0 回归无倒退。

当前实现验收：Graph 测试覆盖 checkpoint 持久化、多轮恢复、跨 tenant 隔离和边界缺失拒绝；
Agent 单元测试 `145/145`、服务端/测试类型检查、ESLint、Agent 构建均通过。Mem0 生产写入仍因
持久向量后端、embedding 和评测门禁未完成而关闭。真实飞书的干净双轮承接仍需在当前有效回调
隧道上复测，不能用自动化结果替代 UI 证据。

## 9. Mem0 业务接入状态

长期语义记忆的代码端口和默认关闭适配器已落地，详见
[Mem0 长期记忆 SDD](11-mem0-long-term-memory-sdd.md) 与
[Mem0 长期记忆 TDD](12-mem0-long-term-memory-tdd.md)。当前已完成实际业务接入：LangGraph
每次分类前按 tenant + actor 检索偏好并注入提示；LLM 将明确“记住/以后按此偏好”分类为
`memory_save` 后，工作流通过长期记忆端口写入已批准偏好。Mem0 后端不可用或默认关闭时，
只返回可见降级提示，不阻塞普通对话或业务写入。
