# 问题日志

状态：`Active / 2026-09-25`

本文件只记录可复现的问题、当前状态、证据和下一动作。产品路线见
[项目主计划](project-master-plan.md)，完成度证据见
[需求追踪矩阵](specs/05-requirements-traceability.md)。

| ID | 问题 | 状态 | 证据 / 处理 | 下一动作 |
| --- | --- | --- | --- | --- |
| `ISS-PRG-001` | Web 编辑已重算判断，但 Postgres 编辑版本复制旧 `progress_assessment` | Resolved | 编辑 SQL 改写新快照；集成测试用不同建议验证生成、编辑、确认回读 | 保持回归 |
| `ISS-PRG-002` | 历史商机有进展或本次填写进展就被误判为“新进展” | Resolved | 仅当匹配商机旧值与本次值归一化后不同才生成 `progress_changed`；同值测试为 `steady` | 保持回归 |
| `ISS-PRG-003` | 无唯一客户或来源不可用时仍可能出现建议或任务 | Resolved | 状态降级为 `insufficient`，建议为空；新流程不生成任务候选 | 保持多匹配、权限与失败回归 |
| `ISS-PRG-004` | 飞书/Web 未对当前四层推进判断做真实 UI 对账 | Open | 自动化、类型、Lint、构建已通过，未发送真实消息 | 获得明确授权后按 UI 回归提示词验收 |
| `ISS-AUTH-001` | 飞书机器人入口的成员/角色权限校验尚未完成 | Open / existing | 已在 `current-state.md` 保留，未纳入 Goal v3 修改 | 单独立项，不与 S4 混做 |
| `ISS-S4-001` | “商机超过 7 天未更新”的主动触发尚未实现 | Planned | 明确排除在 Goal v3 外，归属同一销售跟进 Agent 的 S4 内部能力 | UI 对账后再启动 S4 Goal |

更新规则：发现问题时先补复现证据；修复后记录对应测试或运行证据；没有真实 UI 证据时不得把
`Open` 改为 `Resolved`，也不得把 `Automated Green / UI pending` 写成 `UI Verified`。
