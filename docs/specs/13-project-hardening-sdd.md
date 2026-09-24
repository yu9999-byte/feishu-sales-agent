# 项目复查整改 SDD

状态：`Approved / automated Green / runtime and UI verification pending / 2026-09-24`

## 1. 目标

本轮先修复 2026-09-24 全量复查确认的交付、安全、幂等、意图路由和
短期记忆保留问题，使现有文本跟进 P0 成为可复现、可升级、可安全重试的基线。

本轮不扩展语音、妙记、日报、主管推送、客户 360 或经营分析。飞书机器人
成员/角色权限校验继续作为已接受的 P1 债务记录，不在本轮修改。

## 2. 整改范围

### 2.1 可交付基线

- 提供可重复执行的 Agent 数据库迁移命令，按固定顺序执行控制库、平台、
  Web Auth、跟进草案和历史兼容迁移；租户本地种子继续使用 Git 忽略文件。
- README 必须列出完整迁移、构建、测试和启动步骤，不再把临时隧道写成稳定运行状态。
- 当前工作区的用户改动不自动提交；完成后给出待纳入版本控制的精确范围。

### 2.2 OAuth state 浏览器绑定

- 发起登录时写入短时、HttpOnly、SameSite=Lax state Cookie。
- 回调必须同时满足：数据库 state 有效、URL state 有效、浏览器 Cookie 存在且完全一致。
- Cookie 缺失、值不一致、state 过期或重复消费均返回 `INVALID_STATE`，且不得换取用户身份。

### 2.3 Web 确认与失败重试

- 首次确认只获取一次执行租约，立即返回 `executing`；Base/Task 在后台执行。
- Web 页面看到 `executing` 后自动轮询，直至 `succeeded`、`failed` 或
  `partialFailure`，同时保留手动刷新入口。
- 已确认草案重试必须复用原 PendingAction 的任务候选与已选集合；页面携带 N 或 N+1
  版本候选 ID 时，按逻辑任务 ID 校验，不得因确认版本递增而必然失败。
- 用户不得在确认后改变原任务选择。

### 2.4 LLM 主意图路由

- 无论是否处于跟进补充态，自然语言消息都先经过 LangChain/LangGraph 意图节点。
- 代码只保留取消等确定性状态命令，以及模型分类后的字段提取和副作用控制。
- 补充态中的销售问答、闲聊、内容生成或查询意图必须退出补充态并正常回答；
  `followup_capture`、低置信补充或相关事实才继续合并跟进上下文。
- 不再用 `你好/怎么/为什么/问号` 等关键词正则作为换话题主判断。

### 2.5 LangGraph 短期记忆 TTL

- thread 继续以 `tenantId:actorOpenId:chatId` 隔离。
- 每个 checkpoint 保存 `lastActiveAt`；默认 24 小时，可由
  `LANGGRAPH_THREAD_TTL_MS` 配置。
- 新消息到达时，若最近 checkpoint 已超过 TTL，先通过 Checkpointer 的
  `deleteThread` 删除该 thread，再执行新一轮；过期历史不得进入模型输入。
- Checkpointer 仍只承担短期对话状态，不替代 Mem0 或业务事实库。

### 2.6 Mem0 和运行环境

- Mem0 代码适配器保留，但在持久 Qdrant、embedding、中文召回、删除和 ACL
  评测完成前保持关闭，不把“依赖已安装”标记为长期记忆已上线。
- 代码与自动化通过后，重新构建并重启 Agent；临时公网隧道只作为 UI 联调入口，
  不作为正式部署方案。

## 3. TDD 验收矩阵

| ID | Red 场景 | Green 结果 |
| --- | --- | --- |
| `AUTH-STATE-01` | OAuth 回调没有 state Cookie | `INVALID_STATE`，不消费数据库 state |
| `AUTH-STATE-02` | Cookie 与 URL state 不同 | `INVALID_STATE` |
| `WEB-RETRY-01` | N 版确认失败后携带 N 版候选立即重试 | 复用原动作并只执行未完成步骤 |
| `WEB-RETRY-02` | 已确认后改变任务选择 | `TASK_SELECTION_INVALID` |
| `WEB-ASYNC-01` | Web 确认调用 | 立即得到 `executing`，执行器后台启动一次 |
| `INTENT-CTX-01` | 补充态中发送不命中旧正则的普通问题 | LLM 路由并退出补充态，不进入提取器 |
| `INTENT-CTX-02` | 补充态中发送相关补充事实 | 继续原跟进并合并上下文 |
| `MEM-TTL-01` | 同 thread 超过 TTL 后再对话 | 旧消息不进入模型提示词 |
| `MEM-TTL-02` | TTL 内继续对话 | 最近上下文继续可见 |
| `MIGRATE-01` | 空库/已迁移库执行迁移命令 | 顺序成功且重复执行不破坏数据 |

## 4. 质量门

- 定向 Red 必须先失败，再进行生产代码修改。
- `npm run test:agent`、Postgres 集成测试、三套 TypeScript、ESLint、
  Agent/Web 构建和 `git diff --check` 全部通过。
- 重启后本地首页和受保护 API 状态符合预期；真实飞书 UI 验收单独记录，
  不用 Mock 或 HTTP challenge 替代。

## 5. 当前进展

- [x] 完成项目全量复查并保存问题证据。
- [x] 冻结本轮整改范围和验收矩阵。
- [x] Red：OAuth、Web 重试/异步、补充态意图、thread TTL 和迁移清单均先失败。
- [x] Green：缺 Cookie 拒绝、异步 Web 确认、跨版本重试、LLM 补充态路由和 24 小时 TTL。
- [x] Refactor：新增带校验和的正式迁移入口；本机连续执行两次为 apply/skip。
- [x] Verify：22 个单测文件 158/158、Postgres 集成 8/8、三套 TypeScript、ESLint、
  Agent/Web 构建通过。
- [ ] Verify：重启最新 Agent，完成本地 HTTP 和真实飞书 UI 复验。
