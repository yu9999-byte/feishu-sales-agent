# Mem0 长期语义记忆 SDD

状态：`Implemented / 默认关闭、需外部向量后端 / 2026-09-23`

本规格落实 D-029 的长期记忆部分。它描述 Mem0 OSS 适配层的边界，不改变当前 P0
的 LangGraph 对话主链路，也不把 Mem0 变成客户、商机、跟进或任务事实源。

## 1. 目标与非目标

目标：为长期项目提供可替换的长期语义记忆端口，保存经过用户确认、可复用的销售工作偏好，
并在召回时执行租户和销售身份隔离。

非目标：

- 不保存未经确认的客户原文、商机金额、风险结论、任务状态或模型猜测；
- 不替代 LangGraph Postgres Checkpointer 的 thread 状态、短期上下文和 interrupt/resume；
- 不替代 Base、飞书 Task、PendingAction 和审计事实；
- P0 默认关闭外部 Mem0 后端，但代码已接入受控召回和显式批准写入；
- 不使用内存向量库冒充生产持久化。

## 2. 记忆分类与确认门

适配层当前只允许以下类别：

| 类别 | 示例 | 允许条件 |
| --- | --- | --- |
| `user_preference` | 销售明确偏好中文输出 | 用户明确确认保存 |
| `sales_workflow_preference` | 销售偏好三段式跟进 | 用户明确确认保存 |
| `communication_preference` | 销售希望提醒使用飞书任务 | 用户明确确认保存 |

每次写入必须同时提供：`approved=true`、`approvedBy`、`sourceRef` 和 `policyVersion`。
调用方必须在业务确认成功之后再异步调用 `addApprovedMemory`。Mem0 写入失败不得回滚
已经完成的 Base/Task 动作，也不得改变动作成功状态。

## 3. 命名空间与 ACL

所有操作必须提供 `tenantId` 和 `actorOpenId`；可选 `customerRef` 只用于在同一销售范围内
进一步缩小召回。Mem0 的 `user_id` 使用以下稳定命名空间：

```text
sales-agent-long-term:{tenantId}:{actorOpenId}
```

metadata 至少包含：`memory_scope`、`tenant_id`、`actor_open_id`、`category`、`source_ref`、
`policy_version` 和 `approved_by`。查询结果还会在应用层再次校验 metadata，避免向量后端
过滤能力不足时发生越权。缺少租户或销售身份时拒绝操作；跨租户、跨销售查询和删除返回空结果
或 `false`，不得尝试猜测身份。

## 4. 端口与错误策略

代码端口位于 `server/modules/llm/long-term-memory.port.ts`，当前适配器位于
`server/modules/llm/mem0-memory.adapter.ts`。

- `addApprovedMemory`：只接受已批准的偏好记忆；默认关闭时返回 `disabled`，不初始化 Mem0；
- `search`：只返回当前 scope 的记忆，限制最多 20 条；空查询返回空列表；
- `delete` / `history`：先读取并校验 scope，再执行操作；不属于当前 scope 时不暴露存在性；
- `health`：报告 `enabled`、`ready` 和非敏感原因；不得记录客户正文或 API 密钥。

## 5. 配置与上线门禁

`MEM0_ENABLED` 默认 `false`。启用前必须提供持久向量后端（当前优先 Qdrant）、embedding
模型、Mem0 LLM 配置，并完成：

1. 中文召回准确率和延迟基准；
2. 误记忆率、删除和历史可追溯性测试；
3. 两租户、两销售和 customerRef ACL 越权测试；
4. 向量后端备份、容量和恢复演练；
5. 真实飞书确认后异步写入的失败降级演练。

未完成上述门禁时，保持 `MEM0_ENABLED=false`；代码仍允许使用 fake client 做隔离测试，不能
把未评测的外部后端当作已上线能力。

## 6. 数据生命周期

记忆必须保留来源引用和策略版本，支持按 memory id 删除和查看 history。可选 `expiresAt`
映射为 Mem0 的 `expirationDate`；过期记忆不能进入默认召回。删除请求必须经过同一租户和销售
scope，不能由模型或普通聊天文本直接触发。

## 7. 当前实现链路

```text
用户明确“记住我的偏好”
  -> LangChain structured output: memory_save
  -> workflow approved gate (actor + source + policy)
  -> Mem0 addApprovedMemory

下一条消息
  -> Mem0 search(tenant, actor)
  -> LangGraph classifyIntent prompt（仅偏好参考）
```

Mem0 写入和检索失败都记录非敏感审计，不改变当前消息的成功/失败结果。
