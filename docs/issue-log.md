# 问题日志

状态：`Active / 2026-10-03`

本文件只记录可复现的问题、当前状态、证据和下一动作。产品路线见
[项目主计划](project-master-plan.md)，完成度证据见
[需求追踪矩阵](specs/05-requirements-traceability.md)。

## 2026-10-03 飞书任务事件回执已接入，历史覆盖仍未证明

- 原风险：把 `listRelatedTask` 当前列表、任务订阅或单一任务事件误读为可回溯的全量历史，
  会把列表缺失、订阅前状态或断线期间的未知误判成“未完成”。
- 处理：已订阅 `task.task.update_user_access_v2`，并持久化最小回执元数据与 SHA-256 哈希；同一
  `(tenantId, eventId)` 只记录一次。接收层不保存原始事件体、不读取任务详情、不更新任务快照，
  也不从事件内容推断销售归属。
- 状态：`Resolved / receipt ledger implemented / history coverage pending / UI not required`。
- 下一动作：记录订阅起点与中断窗口，建立连续性和补偿证据，并在精确 GUID 二次读取可审计后再评估
  历史覆盖；在此之前继续禁用 `coverage.taskHistory=full`。

## 2026-10-03 可信任务历史来源扩展口

- 原风险：`coverage.taskHistory` 预留了 `full`，但未来接入历史源时如果只依赖调用方约定，
  可能把 partial 或异常来源误标为全量。
- 处理：新增 `TaskGateway.readTaskHistory` 及机器可读的 `coverage` 声明；履约服务只接受
  `coverage=full` 且无警告的来源，partial、unavailable、异常和带警告结果全部降级为
  `unavailable`。当前 FeishuTaskGateway 不实现该端口，因为现有 Task API 只有搜索和详情读取。
- 证据：履约定向测试 `25/25`、服务端/客户端/测试 TypeScript 和 `git diff --check` 通过；
  本轮未发送消息、未修改任务、未进入真实飞书/Web UI。
- 状态：`Resolved / automated green / UI pending`。
- 下一动作：接入能够证明查询边界和事件完整性的可信飞书历史/事件源；在此之前继续禁用
  `taskHistory=full`，不计算全量完成率。

## 2026-10-03 跨任务替代关系必须显式声明

- 原风险：任务履约只能按精确任务 GUID 对账；若后续任务承接了原承诺，缺少安全边界时容易
  因标题相似、时间接近或任务列表缺失而误判跨任务完成。
- 处理：`TaskFulfillmentService` 只接受当前租户、当前销售成功 Agent 动作结果中的完整
  `relatedTaskGuid + relation: replaces`。关系字段缺失、冲突、自替代、替代任务读取失败、
  跨租户或跨销售全部保持待核实；原任务可见时以原任务为准，替代任务不得覆盖。
- 证据：替代任务已完成/进行中、关系不完整、自替代、原任务可见冲突、读取失败及跨租户/跨销售
  反例已加入，定向履约与验证测试 `49/49` 通过。替代关系不写任务状态事件账本，不修改真实
  飞书任务，也不发送消息。
- 状态：`Resolved / automated green / UI pending`。
- 下一动作：代码门禁和 Postgres 集成复跑已完成；真实飞书/Web UI 仍需独立登录态验收，
  不能用自动化结果替代 UI 证据。

## 2026-10-03 任务状态事件账本

- `ControlStore` 现在记录并按租户、销售、精确任务 GUID 读取 `observed`、`changed`、
  `completed`、`reopened` 事件；`MemoryControlStore` 和 `PostgresControlStore` 行为一致，
  迁移为 `015_task_status_events.sql`。
- `TaskFulfillmentService` 只接受精确 GUID 的明确完成/重新开放事件恢复判断；普通变化、
  事件读取失败、事件来源不完整、标题相似、时间接近和列表缺失均不产生跨任务完成结论。
- Agent 全量 `285/285`、服务端/测试 TypeScript、ESLint、统一 Lint、Stylelint、Agent/Web
  构建和 `git diff --check` 通过。项目自带 Postgres 已恢复到 `127.0.0.1:55432`，迁移
  014/015 成功应用，3 个集成测试文件共 `12/12` 通过；UI、消息和真实任务写入均未执行。

## 2026-10-03 任务历史覆盖必须机器可读

- 原风险：事件账本虽然在文档中说明不是飞书全量历史，但 API 只有自然语言警告和
  `taskSnapshots` 字段，后续页面或提醒编排可能误把观察结果当成完整历史。
- 处理：新增 `coverage.taskHistory`，当前只允许 `agent_observations`、`unavailable`；
  `full` 作为未来可信全量历史来源的保留值。履约页面同步展示观察范围和不可用状态。
- 证据：履约定向测试 `23/23` 通过；本轮未发送消息、未修改任务、未进入真实飞书/Web UI。
- 状态：`Resolved / automated green / UI pending`。
- 下一动作：接入可信全量任务历史前继续保持 `full` 禁用，并补充真实销售 UI 只读验收。

## 2026-10-03 旧完成事件被较新普通变化覆盖

- 原风险：任务不可见时，历史读取只筛选 `completed`/`reopened`，可能忽略同一精确 GUID
  后续的 `changed`/`observed`，把过期完成结论恢复给当前承诺。
- 处理：改为先按发生时间取该 GUID 的最新事件；最新普通事件加入不可核实集合并给出明确警告，
  不再恢复任何更早终态。仍只按租户、销售和精确 GUID 处理，不建立跨任务关系。
- 证据：新增“完成后出现更晚普通变化”的反例，任务履约定向 `16/16`，Agent 全量
  `285/285`；本轮未进入 UI、未发送消息、未写入真实任务。

## 2026-10-03 飞书任务完成时间证据与零值误判

- 飞书任务未完成或重新开放时可返回 `completed_at="0"`；旧逻辑按字符串真值可将
  它误判为已完成。现改为解析 ISO/秒/毫秒时间，仅有效且大于 0 的完成时间
  可作为完成证据；即使同时带有冲突的 `status="completed"`，零时间仍保持未完成。
- 迁移 014 为任务快照增加完成时间，变化证据增加前后完成时间，`/tasks`
  增加完成时间展示。完成/重新开放判定改用完成时间证据，不再仅依赖状态字符串。
- 定向 `35/35`、Agent 全量 `281/281`、隔离 Postgres 迁移 003..014 及快照集成
  `1/1`、三套 TypeScript、统一 Lint、Stylelint、Agent/Web 构建和 `git diff --check`
  通过。本轮没有飞书 UI、消息或真实任务写入，状态保持 UI pending。
- 本项目 `127.0.0.1:55432` 控制库实例当前缺失；本轮不复用其他项目数据库，
  不声称旧的 Postgres `12/12` 是本轮结果。需恢复项目专用实例后再做全套数据库和运行态复验。

## 2026-10-03 已完成任务检索范围切片

- `FeishuTaskGateway` 已按当前销售负责人和 `is_completed=true` 分页读取已完成任务，最多
  10 页；服务只接受有效完成时间，避免把空值、非法值或 `completed_at="0"` 计入完成结果。
- `/api/platform/task-fulfillment` 和 `/tasks` 新增已完成任务指标与明细，并将覆盖范围明确为
  `search_scope`、`partial` 或 `unavailable`。精确关联的 Agent 承诺可以据此核对；没有精确
  任务 GUID 的承诺仍为未关联/待核实，不按标题相似或列表缺席推断兑现。
- 全量 Agent `281/281`、服务端/客户端/测试 TypeScript、ESLint、Stylelint、Agent/Web
  构建和 `git diff --check` 通过。本轮不做飞书 UI、不发消息、不修改真实业务数据，状态保持
  `Automated Green / Web implemented / UI pending`。

## 2026-10-02 精确关联承诺的履约完成度判定

- 在已有精确 `taskGuid`、任务详情读取和状态快照基础上，新增只读完成度契约：明确
  `completed` 为“已完成”，`in_progress`/`doing`/`processing`/`started` 及对应中文值为
  “部分完成”，其他当前可见非完成任务为“仍未完成”；任务不可见、详情失败和来源不完整为
  “待核实”。
- `/tasks` 和任务履约 API 增加部分完成、仍未完成统计与逐条确定性判断；不修改飞书任务、
  不发送提醒、不把该判断扩展为全量完成率或无任务承诺兑现结论。
- 定向任务履约 `10/10`，Agent 全量 `277/277`，服务端/客户端/测试 TypeScript、改动文件
  ESLint 均通过；Postgres 集成回归沿用 `12/12` 基线。真实飞书 UI 仍不执行，状态保持
  `Automated Green / Web implemented / UI pending`。
- GitHub milestone checkpoint 已按仓库流程发起 dry-run 和正式发布尝试，但读取 `github/main`
  长时间无响应后主动停止；本轮不能声称已推送，工作区改动仍保留待远端恢复后再 checkpoint。

## 2026-10-02 任务状态快照与完成/变更证据

- `TSK-003..006` 新增精确 `taskGuid` 详情读取和 `task_status_snapshots` 持久化：首次观察
  建立基线，后续可证据化标记任务完成、变更或重新开放；列表/详情读取不完整时不做缺席
  或完成推断。定向任务履约 `9/9`、迁移/任务网关定向 `30/30`。
- 全量 Agent `275/275`、Postgres `12/12`、三套 TypeScript、全库 ESLint、统一 Lint、
  Stylelint、Agent/Web 构建和 `git diff --check` 通过；隔离 `3113` 启动首页 `200`、未登录
  接口 `401`。全量完成历史和真正兑现/部分完成判断仍未接入。
- 本轮不做真实飞书 UI，不发消息、不修改任务；状态保持
  `Automated Green / Web implemented / UI pending`。

## 2026-10-01 任务履约承诺核对

- `TSK-003..006` 增加最近 180 天 Agent 已确认承诺与本人未完成任务的只读精确 GUID
  核对；列表未命中时读取精确任务详情，并通过 `task_status_snapshots` 识别完成、变更和
  重新开放。首次观察只建立基线，任务源/详情不完整时保守降级。定向 `9/9`；500 条承诺
  历史上限和详情读取失败均有可见警告。全量完成历史与真正兑现/部分完成判断仍未接入。
- 全量 Agent `273/273`、Postgres `11/11`、三套 TypeScript、全库 ESLint、统一 Lint、
  Stylelint、Agent/Web 构建和 `git diff --check` 通过；隔离 `3112` 启动冒烟首页 `200`、
  未登录接口 `401`。本轮不做真实飞书 UI，也不发消息或修改任务，保持
  `Automated Green / Web implemented / UI pending`。

## 2026-09-30 任务履约 Agent v1 自动化切片

- `TSK-003..006` 从仅有任务创建/修订能力推进到只读履约判断：新增本人任务风险分类 API 和
  `/tasks` Web 产品面。
- 当前覆盖未完成任务的逾期、今日到期、三天内到期、未设期限和正常排期；明确不读取完成
  历史、不核对承诺、不发送提醒、不改任务、不升级主管。
- 任务履约定向回归 `9/9`；加入模块装配回归后的收尾定向测试 `29/29`、全量 Agent
  `270/270`、Postgres 集成 `11/11`、三套 TypeScript、全库
  ESLint、统一 Lint、Stylelint、Agent/Web 构建和 `git diff --check` 均通过。真实登录态和
  视觉尚未验收，因此保持 `Automated Green / Web implemented / UI pending`。

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
| `ISS-TASK-008` | 飞书 `completed_at="0"` 可被误判为已完成，且快照缺少完成时间证据 | Resolved / automated green / UI pending | 任务网关仅接受可解析且大于 0 的 ISO/秒/毫秒完成时间；冲突原始状态 + 零时间有反例；迁移 014、快照回读和 `/tasks` 显示已接入；定向 `35/35`、Agent `281/281`、隔离 Postgres `1/1` | 保持时间格式和重新开放回归；真实销售登录态只读验收后再升级 UI 状态 |
| `ISS-TASK-009` | 任务不可见时缺少可审计的状态历史，容易把列表缺失误判为完成或跨任务承接 | Resolved / automated green / UI pending | 迁移 015 和内存/Postgres 事件账本记录 `observed`/`changed`/`completed`/`reopened`；服务按精确 GUID 取最新事件，较新的普通事件会保守降级，不恢复旧终态；事件失败和来源不完整均保守降级；Agent `285/285`、Postgres `12/12` 通过 | 全量飞书历史、显式跨任务替代关系、提醒和 UI 验收仍是后续工作 |
| `ISS-AUTH-001` | 飞书机器人入口的成员/角色权限校验尚未完成 | Open / existing | 已在 `current-state.md` 保留，未纳入 Goal v3 修改 | 单独立项，不与 S4 混做 |
| `ISS-OPS-002` | 新增商机状态网关后独立 Agent 启动缺少依赖导出 | Resolved | `AgentExecutionModule` 已导出 `SALES_RECORDS_GATEWAY`；服务端类型检查、构建通过，3100 端口启动、路由注册和飞书长连接均已验证 | 保持根模块启动冒烟测试，避免只依赖单元测试 |
| `ISS-OPS-003` | 商机准备度上下文服务未注册到 Nest 模块，类型检查与单测通过但完整 Agent 无法启动 | Resolved | 进程级冒烟复现依赖注入失败；上下文服务增加 `@Injectable()` 并注册为模块 provider，新增模块装配回归。修复后隔离端口 3111 启动成功，首页 200，任务履约接口未登录返回预期 401；全量 `270/270` | 保持模块装配回归和完整 Agent 启动冒烟；不得只以服务单测替代根模块启动验证 |
| `ISS-OPS-004` | 项目 `.env.local` 指向的 `127.0.0.1:55432` 没有本项目 Postgres 实例 | Resolved / local environment | 已启动项目自带 Postgres，未重置数据；迁移 014/015 成功应用，3 个集成测试文件共 `12/12` 通过，控制库回读正常 | 保持本地测试实例和迁移回归；真实运行态与 UI 仍按各自验收门禁执行 |
| `ISS-CARD-013` | 跟进输入卡因沟通原文 `max_length=5000` 被飞书 Card 2.0 接口拒绝 | Resolved / API E2E verified / UI pending | 2026-09-28 位置 101 的真实消息复现 400；修正为协议上限 1000，新增回归断言；重启后位置 104→106 输入卡、位置 107→109 草案卡均成功发送；确认前无业务写入 | 保持 Card 2.0 schema 回归；执行确认链仍需 API 回调或 UI 证据 |
| `ISS-EXE-014` | 回调解析、确认执行和终态修订此前分层验证，缺少贯通证据 | Resolved / isolated callback E2E / UI pending | SDK EventDispatcher 进入真实 Bridge、Workflow、Executor、MemoryStore 的两条隔离回放覆盖同卡执行中与唯一成功/失败终态、编辑原记录和失败重试；外部网关全为替身；全量 `242/242`、Postgres `8/8` 通过 | 保持跨层回归；真实 UI 及真实 Base/Task 回读仍待独立验收，不能用隔离结果代替 |
| `ISS-UI-003` | Codex 标签可控但没有可验证的“销售agent”会话和输入框，无法完成 S1 真实 UI 复验 | Open / blocked on target session | 用户已明确允许 Codex 右侧浏览器、禁止本地 Chrome。2026-09-30 已取得 Codex In-app Browser 标签 4 的控制句柄，但页面实际为“消息 - 轮动”空白首页；刷新、等待和无障碍回读均无目标会话，搜索入口触发 `dispatchSearchSetInputEvent not impl on web`，未发送消息。3100 运行态返回 200，不能替代 UI 证据 | 在同一 Codex 标签恢复已登录并可见“销售agent”消息输入框；确认标题后再做最小受控验证。不得用本地浏览器或 API 冒充 UI |
| `ISS-S4-001` | “商机超过 7 天未更新”的主动提醒尚未形成闭环 | Partial / ledger green / readiness API green / workbench UI pending / disabled / production prerequisites open | 默认关闭的只读 `StaleOpportunityScanService` 已串联商机、跟进、Task 全分页和保守判定；新增只读准备度报告及 Web 工作台，逐条列出状态未确认和沟通时间缺失，不从当前进展或修改时间推断；无效跟进会保留记录 ID/版本、阻断扫描并在读取 Task 前停止；工作台在商机/跟进版本不可验证时禁用后端必然拒绝的操作。Task 权限、沟通时间映射及独立商机状态字段/四类值映射均已补齐。新建商机在用户确认后按租户配置初始化为“进行中”，更新已有商机不触碰生命周期状态；真实只读扫描完整读取 5 条历史空状态商机并全部安全跳过。已完成持久提醒账本的并发/冷却/结果未知测试，但尚无历史状态分类、可信时间、调度或提醒 | 销售依据工作台逐条确认历史状态并处理历史可信时间；恢复浏览器句柄后完成页面验收，再绑定默认关闭触发器和本人提醒 |
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
