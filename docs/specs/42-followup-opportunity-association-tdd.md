# 跟进与商机关联重构 TDD

状态：`Green / UI Verified`

日期：`2026-10-16`

权威规格：
[跟进与商机关联重构 SDD](41-followup-opportunity-association-sdd.md)

## 1. Red 测试清单

| 编号 | 测试 | Red 原因 |
| --- | --- | --- |
| `FOA-T01` | 无明确商机的跟进只执行 customer -> followup -> task | 当前执行器总会调用 `upsertOpportunity`。 |
| `FOA-T02` | 选择已有商机时跳过 upsert，并把所选 ID 传给跟进 | 当前没有关联快照，无法选择已有商机。 |
| `FOA-T03` | 确认创建新商机时执行 customer -> opportunity -> followup -> task | 当前无法区分“AI 猜测”和“销售确认新建”。 |
| `FOA-T04` | 跟进 Gateway 接受空商机关联且不写关联字段 | 当前参数和字段写入强制要求字符串 ID。 |
| `FOA-T05` | 更新跟进选择 none 时清空旧商机关联 | 当前更新永远写一个商机 ID。 |
| `FOA-T06` | 确认卡包含商机关联单选和商机名称，并保留一次提交 | 当前卡片没有商机关联控件。 |
| `FOA-T07` | 无商机名默认 none；唯一精确匹配默认 existing；未匹配明确名称默认 create | 当前 payload 没有关联决策。 |
| `FOA-T08` | 表单提交的已有商机必须存在于当前授权上下文 | 当前没有 record ID 白名单校验。 |
| `FOA-T09` | create 模式缺少名称时不可确认 | 当前会生成“客户名 - 销售机会”。 |
| `FOA-T10` | 成功卡按 none/existing/create 展示真实结果 | 当前统一写“客户、商机和跟进已写入”。 |
| `FOA-T11` | 部分失败重试保持原关联模式且不重复创建商机 | 当前仅靠是否已有结果 ID 判断。 |
| `FOA-T12` | Web 确认路径生成同一关联快照 | 当前 Web 路径没有关联模式字段。 |
| `FOA-T13` | 未操作 Card 2.0 下拉时保留 payload 中的当前关联决定 | 依赖下拉默认值回传会让未操作值缺失或被错误覆盖。 |
| `FOA-T14` | Pending Action 持久化往返后仍保留完整商机关联快照 | 解析器 schema 接受该字段，但返回对象遗漏字段，执行器重载后回退为 `none`。 |

## 2. 测试层级

### 2.1 单元测试

- `followup-chat-draft.spec.ts`：默认决策、表单解析、版本变化和非法选择降级。
- `agent-validation.spec.ts`：payload schema、Card 2.0 控件和持久化往返不丢字段。
- `agent-action-executor.spec.ts`：三种执行顺序、重试和结果字段。
- `sales-context-gateways.spec.ts`：Base 空链接创建、更新清空和有链接写入。
- `followup-confirmation.spec.ts`：Web 路径的关联快照和授权候选。

### 2.2 集成与回归

- 控制库 JSON payload 往返保持联合类型字段。
- 旧动作缺少关联快照时不创建泛化商机。
- 文本、妙记、文档生成的草案均进入同一确认卡。
- 日报、风险和商机决策继续忽略 `opportunityRecordId = null` 的跟进，不猜测关联。

### 2.3 真实 UI

1. 发送只有客户沟通和下一步、没有项目的跟进，确认后核对商机表无新增。
2. 发送明确属于已有商机的跟进，确认卡选已有商机，核对跟进关联。
3. 发送明确的新项目，确认卡选创建新商机，核对单次创建和任务。
4. 三条路径都观察执行中状态、唯一成功卡和查看链接。

## 3. Green 门禁

- 定向 Red 测试先按预期失败并记录失败原因。
- 最小实现通过全部 `FOA-T01..T12`。
- Agent 全量、PostgreSQL 集成、类型、Lint、构建、`git diff --check` 全部通过。
- 未完成真实 UI 前只标记 `Implemented / UI pending`。

真实 UI 只有在三种关联模式均核对确认卡、处理中间态、唯一成功卡、Base 关系、唯一任务和
查看链接后，才能升级为 `UI Verified`。

## 4. 2026-10-16 执行结果

- Red 已真实复现：`FOA-T01` 在旧实现下得到 `1 failed / 9 passed`，错误执行顺序包含
  `opportunity`。
- `FOA-T01..T14` 已 Green；新增安全反例证明伪造 `existing` record ID 在客户/Base
  写入前被拒绝，新增修订回归证明 `existing -> none` 不复用旧 ID 并清空 Base 链接。
- Card 默认值修复采用 `keep_current` 首项；不改下拉时沿用当前 payload，主动改选才覆盖。
- payload 往返测试先稳定 Red：`1 failed / 27 passed`，修复前解析结果的
  `opportunityAssociation` 为 `undefined`；补齐显式解析和类型收窄后，关联定向
  `2 files / 38 tests` 通过。
- 定向 `3 files / 123 tests` 与新增回归均通过；全量 Agent `83 files / 721 tests` 通过。
- PostgreSQL `32 passed / 3 controlled probes skipped`；三套 TypeScript、ESLint、
  Agent/Web 构建和 `git diff --check` 通过。
- 历史候选只读盘点已完成且零写入。
- 真实飞书三路径结果：
  - `none`：`UI最终-NONE-R3-20261016`，Base 商机关联为空，唯一 Task 已回读。
  - `existing`：`UI最终-EXISTING-R4-20261016`，成功卡与 Base 均关联
    `产线看板试点（测试）`，唯一 Task `1c43dea7-6b58-4969-a7d6-7c33ba3df584` 已回读。
  - `create`：`UI最终-CREATE-R1-20261016`，只创建一个
    `智能排产试点（UI最终-CREATE-R1）`，客户、商机、跟进三层关系与唯一 Task
    `9a585146-ba60-4297-8ec1-81d9a8a6c7d9` 已回读。
- 三条路径都有唯一成功卡和可用查看链接，状态升级为 `Green / UI Verified`。

