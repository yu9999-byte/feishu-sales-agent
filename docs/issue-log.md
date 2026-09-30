# 问题日志

状态：`Active / 2026-09-30`

本文件只记录可复现的问题、当前状态、证据和下一动作。产品路线见
[项目主计划](project-master-plan.md)，完成度证据见
[需求追踪矩阵](specs/05-requirements-traceability.md)。

## 2026-09-30 运行态复核补充

- 自动化门禁保持 Green：Agent `260/260`、Postgres 集成 `11/11`，服务端/客户端/测试
  TypeScript、ESLint、Agent/Web 构建均通过。
- PID `72384` 的本地 Agent 在 `3100` 端口正常响应 `200`；这不是飞书 UI 证据。
- `WEB_PUBLIC_URL` 使用的 Tunnelmole 临时域名已失效，返回 `No matching tunnelmole domain`，
  OAuth 回调因此不可用。
- 本轮早期检查时 Codex 右侧飞书页只暴露 ambient URL；随后独立标签控制恢复，但本地 Chrome、
  桌面飞书和后端 API 冒充 UI 均未使用。`ISS-UI-003` 继续为 `Open / blocked`，S1、日报和
  S4 工作台的 UI 状态不得改为 `UI Verified`。

### 2026-09-30 浏览器控制恢复复核

- Codex In-app Browser 的独立标签控制已恢复，标签 4 可读写，但页面当前是“消息 - 轮动”空白
  首页，不是“销售agent”会话。
- 刷新并等待后仍无聊天列表、目标机器人标题或消息输入框；搜索入口只产生遮罩，飞书页面日志
  报 `dispatchSearchSetInputEvent not impl on web`。因此不能用搜索猜测或跳转到目标会话。
- 本轮只读检查，没有发送消息或执行任何业务动作。问题仍为 `Open / blocked`，阻塞条件从“无
  浏览器句柄”更新为“标签可控但目标会话数据/输入控件不可用”。

| ID | 问题 | 状态 | 证据 / 处理 | 下一动作 |
| --- | --- | --- | --- | --- |
| `ISS-PRG-001` | Web 编辑已重算判断，但 Postgres 编辑版本复制旧 `progress_assessment` | Resolved | 编辑 SQL 改写新快照；集成测试用不同建议验证生成、编辑、确认回读 | 保持回归 |
| `ISS-PRG-002` | 历史商机有进展或本次填写进展就被误判为“新进展” | Resolved | 仅当匹配商机旧值与本次值归一化后不同才生成 `progress_changed`；同值测试为 `steady` | 保持回归 |
| `ISS-PRG-003` | 无唯一客户或来源不可用时仍可能出现建议或任务 | Resolved | 状态降级为 `insufficient`，建议为空；新流程不生成任务候选 | 保持多匹配、权限与失败回归 |
| `ISS-PRG-004` | 最新修复的飞书/Web 四层判断尚无真实视觉对账 | Open | 已发送一条真实飞书测试消息，旧卡出现错误；控制库和无写入重放可定位修复，未观察最新卡片 UI | 权限修复后重新发送受控测试消息，核对新卡并不点击业务确认 |
| `ISS-CTX-005` | 真实 Base 文本单元格为富文本数组，客户存在却被误判未找到 | Resolved / UI pending | 真实草案为 `customer_not_found`；只读 Base 响应显示本人客户；富文本映射 Red/Green、同原文只读重放匹配客户和商机 | 最新卡片视觉回归，旧待确认卡不自动修复 |
| `ISS-FUP-012` | 测试元备注可被误认商机，且“下周五前”被补造钟点 | Resolved / UI pending | 提取测试元备注正反例及重复相对日期；只读重放的 `dueAt=null`；错误时间的旧测试动作已取消并审计 | 最新卡片核对时间为空、需销售选择 |
| `ISS-TASK-007` | 销售agent应用身份缺少 `task:task:read`，无法核对本人已有待办 | Resolved / UI regression pending | 权限已开通；销售agent自身身份真实搜索返回 `code=0`、5 条未完成任务、无 notice；读取按真实上限 30 条完整分页，不完整时 fail closed | 保持权限/分页回归；用新草案复验任务候选 UI |
| `ISS-AUTH-001` | 飞书机器人入口的成员/角色权限校验尚未完成 | Open / existing | 已在 `current-state.md` 保留，未纳入 Goal v3 修改 | 单独立项，不与 S4 混做 |
| `ISS-OPS-002` | 新增商机状态网关后独立 Agent 启动缺少依赖导出 | Resolved | `AgentExecutionModule` 已导出 `SALES_RECORDS_GATEWAY`；服务端类型检查、构建通过，3100 端口启动、路由注册和飞书长连接均已验证 | 保持根模块启动冒烟测试，避免只依赖单元测试 |
| `ISS-CARD-013` | 跟进输入卡因沟通原文 `max_length=5000` 被飞书 Card 2.0 接口拒绝 | Resolved / API E2E verified / UI pending | 2026-09-28 位置 101 的真实消息复现 400；修正为协议上限 1000，新增回归断言；重启后位置 104→106 输入卡、位置 107→109 草案卡均成功发送；确认前无业务写入 | 保持 Card 2.0 schema 回归；执行确认链仍需 API 回调或 UI 证据 |
| `ISS-EXE-014` | 回调解析、确认执行和终态修订此前分层验证，缺少贯通证据 | Resolved / isolated callback E2E / UI pending | SDK EventDispatcher 进入真实 Bridge、Workflow、Executor、MemoryStore 的两条隔离回放覆盖同卡执行中与唯一成功/失败终态、编辑原记录和失败重试；外部网关全为替身；全量 `242/242`、Postgres `8/8` 通过 | 保持跨层回归；真实 UI 及真实 Base/Task 回读仍待独立验收，不能用隔离结果代替 |
| `ISS-UI-003` | Codex 标签可控但没有可验证的“销售agent”会话和输入框，无法完成 S1 真实 UI 复验 | Open / blocked on target session | 用户已明确允许 Codex 右侧浏览器、禁止本地 Chrome。2026-09-30 已取得 Codex In-app Browser 标签 4 的控制句柄，但页面实际为“消息 - 轮动”空白首页；刷新、等待和无障碍回读均无目标会话，搜索入口触发 `dispatchSearchSetInputEvent not impl on web`，未发送消息。3100 运行态返回 200，不能替代 UI 证据 | 在同一 Codex 标签恢复已登录并可见“销售agent”消息输入框；确认标题后再做最小受控验证。不得用本地浏览器或 API 冒充 UI |
| `ISS-S4-001` | “商机超过 7 天未更新”的主动提醒尚未形成闭环 | Partial / ledger green / readiness API green / workbench UI pending / disabled / production prerequisites open | 默认关闭的只读 `StaleOpportunityScanService` 已串联商机、跟进、Task 全分页和保守判定；新增只读准备度报告及 Web 工作台，逐条列出状态未确认和沟通时间缺失，不从当前进展或修改时间推断；Task 权限、沟通时间映射及独立商机状态字段/四类值映射均已补齐。新建商机在用户确认后按租户配置初始化为“进行中”，更新已有商机不触碰生命周期状态；真实只读扫描完整读取 5 条历史空状态商机并全部安全跳过。已完成持久提醒账本的并发/冷却/结果未知测试，但尚无历史状态分类、可信时间、调度或提醒 | 销售依据工作台逐条确认历史状态并处理历史可信时间；恢复浏览器句柄后完成页面验收，再绑定默认关闭触发器和本人提醒 |
| `ISS-S4-002` | 既有商机生命周期状态缺少真实飞书端到端验收 | Resolved / UI Verified | 受控商机“P0测试-销售系统采购”真实消息位置 94、确认卡位置 96；用户确认后原卡显示“未设置 → 进行中”，Base 回读记录 `recvvyZqewDQwe` 为“进行中”；审计为 `card.confirm` → `card.processing_sent` → `action.succeeded` → `card.source_finalized`，执行结果没有客户/跟进/任务写入 | 保持回归；其余 4 条历史商机继续逐条人工确认，不批量猜测或回填 |
| `ISS-S4-003` | 历史商机状态和可信沟通时间缺少 Web 人工确认闭环 | Resolved / automated green / UI pending | 新增逐条治理契约、负责人/状态/商机版本/跟进版本校验、写后回读、幂等键和 accepted/succeeded/failed 审计；工作台新增 Select、Calendar、二次确认和明确错误状态；定向治理测试通过 | 恢复 Codex 右侧浏览器控制句柄后，用当前销售只处理一条受控记录并回读 Base/审计；真实 UI 前不启用 S4 调度或提醒 |

更新规则：发现问题时先补复现证据；修复后记录对应测试或运行证据；没有真实 UI 证据时不得把
`Open` 改为 `Resolved`，也不得把 `Automated Green / UI pending` 写成 `UI Verified`。

## 2026-09-30 团队 Review 自动化切片

- `REV-002..006` 已从 Draft 进入 `Automated Green / API contract ready / UI pending`：新增
  `/api/platform/team-review` 和只读聚合服务，复用个人日报并按主管递归团队范围隔离成员。
- 当前证据为定向 3 项单测、服务端 TypeScript、ESLint 和 Agent 构建通过；没有执行真实主管 UI，
  没有发送消息或创建/修改任何业务记录。
- 下一动作：在真实主管会话可用后验收团队成员范围、日期、关注项和空/部分数据状态；再决定管理
  动作是否需要确认卡、任务分配和调度，不在本切片自动执行。
