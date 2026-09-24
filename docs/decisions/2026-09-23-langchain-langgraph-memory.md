# LangChain/LangGraph 与记忆框架迁移：决策问答

状态：`已确认 / 2026-09-23；D-029 再次确认`。本文件记录本次框架替换的原因、边界和未完成工作；
可执行规格以 [LangGraph Agent Runtime SDD](../specs/10-langgraph-agent-runtime-sdd.md) 为准。

本文件前半保留迁移前的问答，便于回顾当时的判断；其中“当前没有依赖/尚未迁移”等描述是
历史快照，不代表当前工程状态。当前状态以文末“确认后的实施口径”和
[当前工程说明](../current-state.md) 为准。

## 问：当前项目已经基于 LangChain 或 LangGraph 吗？

答：这是迁移前的历史快照。当时是 NestJS + 自研 `AgentWorkflowService`，模型通过
OpenAI-compatible HTTP 接口调用 GLM，意图分类在 `OpenaiConversationAssistant`，短期对话在
`MemoryControlStore`/`conversation_turns`，尚未安装 LangChain、LangGraph 或 Mem0。

当前实现已经切换到 LangChain.js + LangGraph.js；旧 HTTP 意图助手和旧
`conversation_turns` 生产读写已移除。历史数据库表暂不破坏性删除，仅保留回放和审计价值。

## 问：是否采用 LangChain 和 LangGraph？

答：采用 LangChain.js + LangGraph.js，且已完成依赖锁定、主路径替换和运行验证。

- LangChain.js：模型适配、结构化输出、提示词和可替换 Runnable 抽象。
- LangGraph.js：有边状态图、节点间状态传递、人工确认中断、恢复和可观测执行边界。
- NestJS：保留为 HTTP、飞书 Webhook、租户、权限、审计和依赖注入宿主。

这不是新增一层旁路编排。迁移完成后，当前自研对话中枢和主路由不再作为生产路径存在。

## 问：Postgres Checkpointer 是成熟的对话记忆框架吗？

答：它是成熟的开源工作流状态持久化组件，但不是完整的长期语义记忆框架。

它适合保存 LangGraph thread 的状态快照、短期上下文、暂停/恢复点和人工确认前后的状态，
并可用 Postgres 做持久化、隔离和恢复。它不会自动从对话中提炼用户偏好、做语义召回或维护
长期用户画像，因此不能单独回答“长期记忆框架”的需求。

`@langchain/langgraph-checkpoint-postgres` 采用 MIT 许可证，可自托管；软件本身免费，Postgres
主机、存储和运维仍然可能产生基础设施费用。

## 问：有没有免费、开源、可以替换自研记忆的框架？

答：长期语义记忆优先采用 Mem0 OSS 作为唯一目标框架。Mem0 核心代码采用 Apache-2.0，可自托管，
提供记忆提炼、更新、删除和语义检索能力，并有 TypeScript 使用路径。托管版不是本项目的
默认依赖；本项目只考虑自托管开源路径。

Mem0 不是客户、商机、跟进和任务的事实库。任何写入 Mem0 的内容都要经过租户、用户、来源、
保留期限和可删除性策略；未经确认的客户事实不能因为被模型提炼就变成业务事实。

## 问：用户说“替换，不是两个都存在”，到底替换什么？

答：替换的是当前自研的同职责实现，而不是把不同职责的存储硬合并成一层。

| 旧实现 | 迁移后唯一主路径 | 职责 |
| --- | --- | --- |
| `AgentWorkflowService` 的自研对话路由 | LangGraph StateGraph + LangChain 节点 | 意图路由、上下文承接、工作流状态 |
| `MemoryControlStore`/自研 `conversation_turns` 读写 | LangGraph Postgres Checkpointer | 短期 thread 状态、暂停/恢复和幂等恢复 |
| 无长期语义记忆 | Mem0 OSS | 受策略控制的长期用户/销售偏好记忆 |
| Base、飞书 Task、审计、PendingAction | 保留现有领域适配器和控制库 | 业务事实、执行授权、幂等和审计 |

因此目标架构固定为一个 LangGraph 状态持久化组件和一个长期语义记忆框架，但不存在两套并行的
“自研短期记忆”或两套“主意图路由”。Checkpointer 与 Mem0 解决不同问题，不能互相替代；
“替换”指替换旧自研同职责路径，不是删除工作流状态层。

## 用户确认：分层记忆正式口径（2026-09-23）

用户确认：

> 保留 Postgres Checkpointer 作为工作流状态层；长期项目再选一个专业框架，当前优先 Mem0 OSS。

执行解释：

1. Postgres Checkpointer 是 LangGraph 的唯一生产工作流状态层，负责 thread、短期上下文、
   interrupt/resume、幂等恢复和确认流程状态。
2. Mem0 OSS 是长期项目优先采用的唯一长期语义记忆框架，不与其他长期记忆框架并行接入。
3. P0 不因为选定 Mem0 就打开生产写入；当前缺少持久向量后端和完整评测，Mem0 依赖可保留，
   但生产写入必须关闭。
4. Base、飞书 Task、PendingAction 和审计继续是客户、商机、跟进、任务和执行授权的事实源。

## 记忆分层决策

```text
LangGraph + Postgres Checkpointer
  = 当前聊天 thread、工作流状态、暂停/恢复、短期上下文

Mem0 OSS
  = 经过过滤的长期语义记忆，例如销售偏好、常用表达、明确保存的工作习惯

Base / 飞书 Task / 控制库
  = 客户、商机、跟进、任务、租户授权和审计等业务事实
```

Mem0 的默认命名空间至少包含 `tenant_id + actor_open_id`，检索前做 ACL 过滤；客户/商机事实
仍必须从 Base 读取。跨企业、跨销售或跨聊天召回必须被拒绝或显式授权。

## 方案比较与取舍

| 方案 | 定位 | 许可证/成本 | 本项目结论 |
| --- | --- | --- | --- |
| LangGraph Postgres Checkpointer | 工作流状态与短期 thread | MIT，自托管 | 必选，但不当长期语义记忆 |
| Mem0 OSS | 长期语义记忆 | Apache-2.0，自托管 | 选定为长期记忆框架 |
| Zep | 记忆服务与检索 | 开源与托管能力分开，需评估版本和部署 | 暂不引入 |
| Letta | 有状态 Agent/记忆运行时 | 开源，可自托管，但运行时边界更重 | 暂不引入 |
| Rasa | NLU/对话平台 | 开源，但与本项目 LangGraph 编排重叠 | 不引入 |

“免费”只表示可以使用开源软件，不表示模型调用、向量存储、Postgres 或生产运维没有费用。

## 不变的安全边界

- 模型不能授予自己工具权限，不能把租户、客户 ID 或“已执行”当事实。
- 用户未确认的跟进不能写入 Base，未选择的任务不能创建。
- Mem0 的记忆不能绕过确认门、ACL、删除和审计。
- 业务事实以 Base/Task/控制库为准，记忆只提供受控上下文和偏好。
- 原始客户正文不进入普通日志；记忆写入必须保存来源引用、策略版本和可删除标识。

## 决策后的 TODO

- [x] 固定 LangChain.js、LangGraph.js、Postgres Checkpointer 和 Mem0 的兼容版本。
- [x] 先为 StateGraph、结构化意图输出和 Checkpointer 写 Red 测试，再替换当前主路由。
- [x] 用真实 `thread_id` 验证多轮恢复和跨租户隔离；真实飞书 UI 复测仍待完成。
- [ ] 对 Mem0 做中文召回、误记忆、删除、ACL 和容量基准；未通过前禁止生产写长期记忆。
- [x] 完成旧 `OpenaiConversationAssistant`、`MemoryControlStore` 主路径下线，避免双写双读。
- [ ] 在真实飞书 UI 上复验自然问答、跟进承接和确认卡执行态。

## 参考资料

- [LangGraph Workflows and Agents](https://docs.langchain.com/oss/python/langgraph/workflows-agents)
- [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
- [LangChain Structured Output](https://docs.langchain.com/oss/langchain/structured-output)
- [Mem0 GitHub](https://github.com/mem0ai/mem0)
- [Mem0 Node.js OSS quickstart](https://docs.mem0.ai/open-source/node-quickstart)
