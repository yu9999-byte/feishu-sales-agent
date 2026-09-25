# 商机状态判断与下一步行动建议 TDD

状态：`Green / Automated Green / UI pending / 2026-09-25`

关联 SDD：[商机状态判断与下一步行动建议 SDD](16-followup-progress-assessment-sdd.md)。

## 1. Red 场景

| 场景 | 预期 |
| --- | --- |
| 商机历史进展与本次沟通不同 | 生成 `change` 判断，同时引用本次原文和商机记录 |
| 客户认可但预算、决策链或下一步缺失 | 生成用户可理解的 `gap`，不伪造字段 |
| 本次出现风险、竞品或本人任务逾期 | 状态为 `at_risk`，每条风险有来源 |
| 客户多匹配或业务上下文不可用 | 状态为 `insufficient`，不生成建议或任务 |
| 商机与近期跟进的行动字段冲突 | 保留双方事实和来源链接，提示确认前核对 |
| 部分来源失败但本次动作证据充分 | 保留降级警告，仍可生成带证据的建议 |
| 明确“暂无下一步” | 建议为空，任务候选为空 |
| 用户修改下一步或时间 | 创建新版本并重算判断、建议和任务候选 |
| 确认及重复确认 | 只执行已确认版本，不重复写入 |

## 2. 分层验证

1. `FollowupProgressService` 单测验证事实、判断、建议和证据引用完整性。
2. 飞书草案服务验证创建、编辑后快照随 payload 持久化并更新。
3. Web 工作流和 Postgres 集成验证生成、编辑、确认版本均保存快照。
4. 卡片与页面测试验证四层信息可区分，内部代码不直接展示。
5. 全量回归验证旧草案无快照仍可解析，P0 确认和执行顺序不变。

## 3. Green 门禁

- 新增测试先证明服务/字段缺失，再以最小实现转绿。
- Agent 全量测试、Postgres 集成、三套 TypeScript、ESLint、Agent/Web 构建通过。
- 数据迁移连续执行表现为首次 `apply`、再次 `skip`。
- `git diff --check` 通过，真实 UI 未对账时保留 `UI pending`。

## 4. 2026-09-25 验证结果

- Red 首次因 `FollowupProgressService` 缺失而失败；最小 Green 后补齐同值进展、编辑新快照、
  信息不足不建议、旧 payload 兼容和四层展示回归。
- Agent 全量 `191/191`、Postgres 集成 `8/8`、三套 TypeScript、ESLint、Agent/Web 构建通过。
- `010_followup_progress_assessment.sql` 首次执行为 `apply`，再次执行为 `skip`。
- 未发送真实飞书消息、未写测试范围外业务数据，状态保持 `UI pending`。
