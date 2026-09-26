# 问题日志

状态：`Active / 2026-09-26`

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
| `ISS-S4-001` | “商机超过 7 天未更新”的主动提醒尚未形成闭环 | Partial / disabled / production prerequisites open | 默认关闭的只读 `StaleOpportunityScanService` 已串联商机、跟进、Task 全分页和保守判定；Task 权限、沟通时间映射及独立商机状态字段/四类值映射均已补齐。新建商机在用户确认后按租户配置初始化为“进行中”，更新已有商机不触碰生命周期状态；真实只读扫描完整读取 5 条历史空状态商机并全部安全跳过。尚无历史状态分类、可信时间、持久去重、调度或提醒 | 由销售明确分类 5 条既有商机并处理历史可信时间；再实现持久去重、默认关闭触发器和本人提醒验收 |

更新规则：发现问题时先补复现证据；修复后记录对应测试或运行证据；没有真实 UI 证据时不得把
`Open` 改为 `Resolved`，也不得把 `Automated Green / UI pending` 写成 `UI Verified`。
