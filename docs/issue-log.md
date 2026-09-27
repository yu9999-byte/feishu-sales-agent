# 问题日志

状态：`Active / 2026-09-28`

本文件只记录可复现的问题、当前状态、证据和下一动作。产品路线见
[项目主计划](project-master-plan.md)，完成度证据见
[需求追踪矩阵](specs/05-requirements-traceability.md)。

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
| `ISS-UI-003` | Codex 隔离浏览器没有已认证的飞书会话，无法完成 S1 真实 UI 复验 | Open / blocked on browser control | 用户已明确允许 Codex 右侧浏览器、禁止本地 Chrome；截图确认右侧处于“销售agent”会话且输入框可见。只读窗口枚举显示该页面属于 ChatGPT/Codex 主窗口，当前线程无独立浏览器窗口或 `tabId`；句柄重连、标签聚焦和端点探测均未获得输入控制。本轮未发送消息 | 需要当前线程挂载浏览器输入控制（独立 tab/page 句柄）；恢复后先确认唯一会话标题“销售agent”，再继续 S1。不得用本地浏览器或 API 冒充 UI |
| `ISS-S4-001` | “商机超过 7 天未更新”的主动提醒尚未形成闭环 | Partial / disabled / production prerequisites open | 默认关闭的只读 `StaleOpportunityScanService` 已串联商机、跟进、Task 全分页和保守判定；Task 权限、沟通时间映射及独立商机状态字段/四类值映射均已补齐。新建商机在用户确认后按租户配置初始化为“进行中”，更新已有商机不触碰生命周期状态；真实只读扫描完整读取 5 条历史空状态商机并全部安全跳过。尚无历史状态分类、可信时间、持久去重、调度或提醒 | 让销售逐条确认历史状态并处理历史可信时间；再实现持久去重、默认关闭触发器和本人提醒验收 |
| `ISS-S4-002` | 既有商机生命周期状态缺少真实飞书端到端验收 | Resolved / UI Verified | 受控商机“P0测试-销售系统采购”真实消息位置 94、确认卡位置 96；用户确认后原卡显示“未设置 → 进行中”，Base 回读记录 `recvvyZqewDQwe` 为“进行中”；审计为 `card.confirm` → `card.processing_sent` → `action.succeeded` → `card.source_finalized`，执行结果没有客户/跟进/任务写入 | 保持回归；其余 4 条历史商机继续逐条人工确认，不批量猜测或回填 |

更新规则：发现问题时先补复现证据；修复后记录对应测试或运行证据；没有真实 UI 证据时不得把
`Open` 改为 `Resolved`，也不得把 `Automated Green / UI pending` 写成 `UI Verified`。
