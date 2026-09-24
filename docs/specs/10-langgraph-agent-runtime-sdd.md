# LangGraph Agent Runtime SDD

状态：`Implemented / 2026-09-23 / runtime verified / UI retest pending`  
关联决策：D-025（已被 D-027、D-028 覆盖部分内容）、D-027、D-028

## 1. 目标与范围

把当前自研对话中枢替换为 LangChain.js + LangGraph.js 的可测试运行时，保留已经验证的
飞书 Webhook、确认门、租户隔离、业务适配器、审计和幂等行为。

本 SDD 覆盖：

- LangChain 模型适配和结构化输出；
- LangGraph StateGraph、节点、边、thread 和中断恢复；
- LangGraph Postgres Checkpointer 的短期状态持久化；
- Mem0 OSS 的长期语义记忆边界；
- 多租户、权限、工具调用和旧实现下线路径；
- SDD/TDD 验收门禁。

本 SDD 不把 Mem0 当作客户/商机/跟进数据库，也不改变已确认的飞书卡片和一次确认规则。

## 2. 目标运行时拓扑

```text
Feishu Webhook
  -> NestJS tenant / identity / dedupe
  -> LangGraph StateGraph(thread_id)
       -> context node (Checkpointer state + ACL filtered memory)
       -> intent node (LangChain structured output)
       -> route node (deterministic safety gate)
       -> chat / followup extract / clarification / query preview
       -> confirmation interrupt
       -> tool executor (Base / Task / Feishu message)
  -> Checkpointer persist + audit

Long-term memory path (policy gated):
  approved conversation signal -> Mem0 OSS -> tenant/user namespace
```

NestJS 仍是宿主和边界层；LangGraph 是唯一生产对话编排；LangChain 是模型和结构化输出层。

## 3. LangGraph 状态契约

状态必须可序列化、可版本化，禁止把 access token、完整 Secret 或未脱敏客户正文放入普通日志。

```typescript
type SalesAgentState = {
  schemaVersion: 'sales-agent-state-v1';
  tenantId: string;
  actorOpenId: string;
  chatId: string;
  sourceMessageId: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; messageId?: string }>;
  intent?: IntentDecision;
  activeActionId?: string;
  followupDraft?: FollowupDraft;
  pendingTaskCandidates?: TaskCandidate[];
  response?: AgentResponse;
  traceId: string;
};
```

`tenantId`、`actorOpenId`、`chatId` 和 `sourceMessageId` 由可信飞书事件和服务端解析得到，
不能接受模型或客户端覆盖。`thread_id` 使用稳定组合：
`tenantId:actorOpenId:chatId`；动作和消息仍使用各自的幂等键。

## 4. 节点与职责

| 节点 | 允许做什么 | 禁止做什么 |
| --- | --- | --- |
| `loadContext` | 读取当前 thread 状态、短期消息和 ACL 过滤后的 Mem0 记忆 | 跨租户/跨用户检索 |
| `classifyIntent` | LangChain + GLM 输出版本化意图 JSON | 调用 Base/Task，声明已执行 |
| `routeIntent` | 确定性置信度、状态和权限判断 | 依据关键词绕过模型或确认门 |
| `extractFollowup` | 生成结构化草案、证据和缺失字段 | 直接写业务事实 |
| `answerChat` | 生成自然问答或能力说明 | 虚构企业数据 |
| `clarify` | 生成最小必要追问并持久化状态 | 清空或污染其他聊天上下文 |
| `requestConfirmation` | 创建不可变 PendingAction 并中断等待卡片 | 在确认前执行工具 |
| `executeConfirmedAction` | 调用已有 Base/Task/消息工具并审计 | 信任客户端字段或重复创建 |
| `rememberApprovedSignal` | 按策略将允许的偏好写入 Mem0 | 保存未经确认的客户事实 |

节点之间只传递 Schema 校验后的状态；自由文本不能直接驱动工具节点。

## 5. 记忆边界

### 5.1 Checkpointer：短期工作流状态

使用 `@langchain/langgraph-checkpoint-postgres` 作为 LangGraph 的 checkpointer。它保存 thread
状态、节点快照、暂停/恢复信息和有限的短期消息上下文。保留期限、索引和租户过滤必须由本项目
配置；不得把它当作“自动长期记忆”。

迁移后不再由 `MemoryControlStore` 作为短期消息主读写路径。旧表可在迁移窗口只读回放，
完成双读对账后下线；不允许新旧实现长期双写。

### 5.2 Mem0：长期语义记忆

Mem0 只存经过策略批准的用户/销售偏好、明确保存的工作习惯或经用户确认的可复用上下文。
每条记忆必须带：`tenant_id`、`actor_open_id`、来源消息/动作引用、策略版本、创建/过期时间、
删除标识和置信类别。

默认不写入：客户隐私、商机金额、联系人判断、风险结论、任务完成状态和任何未确认推断。
这些信息从 Base、Task 或审计事实源读取。Mem0 召回结果只能作为模型上下文提示，不能作为
工具参数事实。

### 5.3 业务事实源

客户、商机、跟进和任务仍由租户绑定的 Base、飞书 Task 和控制库提供；任何写入都经过原有
确认门、权限、幂等和审计链路。

## 6. 意图识别契约

`classifyIntent` 使用 LangChain structured output 产出已有 `conversation-intent-v1`：

```json
{
  "schemaVersion": "conversation-intent-v1",
  "intent": "followup_capture",
  "confidence": 0.92,
  "reply": "",
  "evidence": ["把刚才这段整理成跟进"]
}
```

模型接收当前消息、同一 thread 的最近状态和经过 ACL 过滤的必要记忆；不接收其他聊天或全租户
数据。低置信、非法 Schema、模型超时或上下文越界时进入安全澄清/可见失败，不得默认跟进写入。

## 7. 工具调用与确认

- 模型输出只能建议意图和结构化字段，不能直接选择工具。
- `followup_capture` 必须生成整表草案和待办预览，销售一次确认后才能执行。
- Graph 在确认卡处使用 interrupt/resume；恢复时重新校验租户、提交人、版本、TTL 和幂等键。
- Base/Task 工具仍使用现有适配器；执行结果写回 Graph 状态并持久化审计。
- Mem0 写入必须在业务动作成功且策略允许后异步执行，失败不能回滚业务事实，也不能阻塞结果卡。

## 8. 迁移顺序

1. 锁定依赖版本、状态 Schema、thread_id 规则和 checkpointer 连接配置。
2. 写 LangChain structured output 与 StateGraph 的 Red 测试，先接入 GLM 适配器。
3. 用 Graph 的 `classifyIntent -> routeIntent` 替换当前主意图路由，保留业务工具和确认门。
4. 用 Postgres Checkpointer 替换短期记忆主读写，并做旧/新状态回放对账。
5. 接入 Mem0 的只读召回和隔离测试；通过评测后再开放“批准信号写入”。
6. 删除旧 `OpenaiConversationAssistant`、`MemoryControlStore` 的生产入口和双写代码。
7. 完成 P0 回归、两租户隔离、真实飞书自然问答/跟进承接 UI 验收。

任一步骤未通过，保持前一步的可回滚版本；不得通过保留两套生产路由来掩盖失败。

## 9. TDD 验收矩阵

### Red 必须先失败

1. Graph 能从同一 `thread_id` 读取上一轮用户和助手消息。
2. 不同 tenant、actor、chat 的 `thread_id` 无法互相读取状态。
3. 意图模型输出非法 JSON、低置信或超时不会进入工具节点。
4. “客户事实 -> 写跟进”能承接上下文并生成预填表单；确认前 Base/Task 调用次数为 0。
5. interrupt 后 resume 只能由同一确认人、同一版本和有效 TTL 恢复。
6. 重复飞书事件和重复恢复不会重复执行 Base/Task。
7. Mem0 读取严格按租户和用户隔离，未经批准的客户事实不会写入。
8. Mem0 写入失败不影响已完成业务动作和结果卡。
9. 旧自研路由被禁用后，不再出现双回复、双写或双记忆记录。

### Green / UI 验收

- LangChain/LangGraph 单元与集成测试通过，类型检查、Lint、构建通过。
- Postgres Checkpointer 的迁移、恢复和 TTL/索引测试通过。
- Mem0 中文召回、误记忆、删除、租户隔离和容量基准达到门槛；未达标则保持只读/关闭写入。
- 当前 Agent 单元测试 `150/150`，且类型检查、ESLint 和 Agent 构建无倒退。
- 真实飞书同一聊天完成：普通问答等待态、自然承接跟进、确认卡执行中、成功/失败终态，且不
  出现旧自研路由的重复追问或重复回复。

## 10. 可观测性和回滚

每次 Graph 运行记录 `traceId`、Graph 版本、节点耗时、模型/schema 版本、checkpointer 结果和
工具结果类别；不记录密钥或完整客户正文。发生框架异常时，用户收到可见失败卡，PendingAction
保持可恢复状态；通过版本开关回滚到上一已验证 Graph 构建，不启用第二套长期并行路由。

## 11. 实施与运行证据（2026-09-23）

- 已锁定 `@langchain/core@1.2.12`、`@langchain/langgraph@1.4.17`、
  `@langchain/langgraph-checkpoint@1.1.5`、`@langchain/langgraph-checkpoint-postgres@1.0.5`、
  `@langchain/openai@1.5.13` 和 `mem0ai@3.2.0`。
- 已实现 LangChain structured output 意图模型、LangGraph StateGraph 和 Postgres Checkpointer；
  `tenantId`、`actorOpenId` 或 `chatId` 缺失时拒绝运行，不生成 `unknown-*` thread。
- 已删除旧 HTTP 意图助手和旧 `conversation_turns` 的生产读写；历史表暂不做破坏性删除，生产
  工作流不再双读双写。
- Red/Green 覆盖同 thread checkpoint、多轮恢复、跨 tenant 隔离、thread 边界拒绝、固定意图
  枚举和关键正反例。当前 Agent 单元测试 `150/150`，服务端/测试类型检查、ESLint 和 Agent
  构建均通过。
- 真实 GLM 验证：问候为 `general_chat`；客户事实为 `ambiguous`；同 thread 后续“帮我写跟进”
  为 `followup_capture`。首次非法 `greeting` 输出被 Schema 拒绝，补充枚举与 few-shot 后通过。
- 当前 LangGraph Postgres 表已建立；Mem0 生产写入仍关闭，因为当前 Postgres 无 `vector` 扩展，
  embedding 和中文召回/删除/ACL 评测尚未完成。
- 当前飞书事件与卡片回调均已切到 `xs5byr...` 临时入口并收到 `201` challenge；真实聊天 UI
  的普通问答、干净双轮承接和预填跟进表单仍是独立验收门。
