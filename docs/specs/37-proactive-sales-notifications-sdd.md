# 主动销售通知 SDD

状态：`Single-recipient daily + team weekly rollout active 2026-10-13`

## 1. 目标

把现有只读的任务履约、商机决策、个人日报和团队 Review 变成可由独立调度器触发、通过
飞书机器人主动送达的销售 Agent 能力。首版交付以下场景：

1. 每日 09:00 向销售推送任务行动卡，合并展示明日到期、今日到期和已逾期任务。
2. 每日 10:00 检查本人商机，只对新出现或等级升级的高风险发送提醒。
3. 每日 17:00 向销售推送个人日报，包括周末；当日没有业务数据时仍发送简短的
   “今日无新增”日报。
4. 每周五 17:05 向具备团队 Review 权限的主管/高管推送团队周报。

2026-10-13 首次持久启用只覆盖当前 Demo 租户中的产品负责人本人：该成员同时保留销售角色并
追加主管角色，只启用 `daily_report` 和 `weekly_team`。不向其他成员、其他租户投递，也不额外
发送个人周报、任务行动卡或商机风险卡。

本规格不自动修改任务或商机，不自动联系客户，不替代 S4 的历史数据治理，也不把计划生成或
自动化测试当成真实飞书投递证据。

## 2. 产品规则

### PN-001 调度与时区

- 外部调度器每 5 分钟调用一次受保护内部接口，Nest 生命周期不启动常驻定时器。
- 每个租户按 `agent_tenants.timezone` 独立计算当地日期、星期和时间。
- 计划时间后的 30 分钟为可执行窗口；窗口外不补发过时通知。
- 调度接口使用独立 Bearer Token；凭证无效时必须在读取租户和业务数据前拒绝。
- 总开关和真实投递开关默认关闭。总开关关闭时零业务读取；仅真实投递关闭时允许生成
  `plan_only` 结果，但不能领取账本或调用飞书发送接口。
- 持久启用时必须同时配置允许的通知类型和 tenant/member/open_id 三重白名单；任一项缺失或
  当前成员不完全匹配时跳过，不读取该成员业务数据、不创建账本、不调用发送器。

### PN-002 收件人与权限

- 只枚举已启用集成下的 active tenant 和 active member。
- 个人通知要求当前成员仍拥有 `review:read-personal`；任务卡同时要求 `task:read`；商机风险卡
  同时要求 `opportunity:read`。
- 团队周报只发送给拥有 `review:read-team` 的成员，团队范围继续复用现有递归汇报关系规则。
- 收件人只能取服务端成员表中的 `feishuOpenId`，请求方不得传入租户、成员或收件人。
- 单个成员或来源失败不得串租户、串成员；错误被记录并继续处理其他安全范围。

### PN-003 任务行动卡

- 每位销售每天最多收到一张任务行动卡。
- 卡片只包含：明日到期、今日到期、已逾期；没有命中项时不发送。
- 每类最多展示 5 项并展示其余数量；链接只采用任务源返回的 HTTPS URL。
- 卡片为只读摘要，提供“查看任务履约”链接，不在卡内直接修改任务状态。

### PN-004 商机风险变化卡

- 风险来源为 `OpportunityDecisionService` 的本人范围、可追溯输出。
- 首次观察到 `critical` 或 `at_risk` 视为新风险；相对上次已观察等级上升视为升级。
- `needs_attention` 和 `on_track` 只更新观察基线，不发送主动卡片。
- 同一商机风险不变时不重复发送；风险解除后再次升高可重新发送。
- 数据源为 `partial`/`unavailable` 或无法唯一定位商机时不发送。

### PN-005 日报与周报

- 个人日报复用 `DailySalesReportService`；`ready`、`partial` 和 `empty` 均生成，完全无活动的
  `empty` 生成简短“今日无新增”卡，`unavailable` 不发送。
- 个人周报能力保留，但本次灰度不启用。
- 团队周报聚合周一至周五的 `TeamReviewService` 输出，只发送给有团队权限的收件人；展示团队
  活跃、跟进、逾期和需关注成员，不把质量评分用于绩效扣分。

### PN-006 卡片与噪声控制

- 四类通知分别使用独立卡片，不把任务、风险、日报和周报混成同一张卡。
- 同一调度轮次按顺序计划：任务行动卡 -> 商机风险卡 -> 个人日报 -> 个人周报 -> 团队周报；
  运行配置再从中筛选允许的通知类型。本次只允许个人日报和团队周报。
- 每个成员每类通知每个业务时段最多一张；商机风险按商机分别去重。
- 卡片说明数据截止时间、覆盖范围和下一步入口；不展示模型思考过程。

### PN-007 投递状态与恢复

状态机：

```text
planned -> claimed -> dispatching -> sent
                    -> failed -> retryable claim
                    -> uncertain -> manual reconciliation only
```

- 账本唯一键至少包含租户、成员、通知类型和业务发生键。
- `claimed` 租约 5 分钟；明确未送达的错误 5 分钟后最多重试 3 次。
- 调用飞书前先进入 `dispatching`。请求结果不确定时进入 `uncertain`，禁止自动重发。
- 飞书请求 UUID 由通知幂等键确定性生成；重复调度、并发调度和服务重启不得重复投递。
- 审计和日志不得包含 Token、App Secret、客户沟通原文或整张卡片正文。

## 3. 技术架构

```text
外部 5 分钟调度器
  -> POST /internal/proactive-sales-notifications/run
  -> ProactiveSalesNotificationService
       -> active integrations / members / PlatformSession
       -> schedule matcher (tenant timezone)
       -> TaskFulfillment / OpportunityDecision / DailyReport / TeamReview
       -> notification planner + risk observation state
       -> PostgreSQL notification ledger
       -> Feishu proactive card sender
```

运行时继续由项目代码控制，不依赖妙搭 `@Automation/@BindTrigger`。部署方可以使用任意支持
HTTPS、Secret 和失败告警的 cron/Job 平台调用单次 Node 调度客户端。

## 4. 数据模型

### `proactive_sales_notifications`

| 字段 | 规则 |
| --- | --- |
| `tenant_id` / `recipient_member_id` | UUID 外键，多租户隔离主键组成 |
| `recipient_open_id` | 只来自当前 active member |
| `kind` | task_action / opportunity_risk / daily_report / weekly_personal / weekly_team |
| `notification_key` | 业务发生键；与租户、成员、kind 唯一 |
| `subject_key` | task_digest、report date/week 或商机 record id |
| `payload_fingerprint` | 不含原文的 SHA-256，用于审计一致性 |
| `status` | claimed / dispatching / sent / failed / uncertain |
| `claim_token` / `claim_expires_at` | 并发领取与崩溃恢复 |
| `attempt_count` / `retry_after` | 有界重试 |
| `message_id` / `sent_at` | 真实发送结果 |
| `failure_code` / `failure_message` | 截断、脱敏的运行证据 |

### `proactive_sales_risk_states`

按租户、成员、商机保存最近观察到的风险等级和指纹。无风险观察也必须更新，使风险解除后再次
升级能够重新触发。只有安全完成一次调度轮次后才更新观察基线。

## 5. API 契约

`POST /internal/proactive-sales-notifications/run`

- Header：`Authorization: Bearer <PROACTIVE_SALES_NOTIFICATION_TRIGGER_TOKEN>`
- Body：空对象；调度时间由服务端产生，测试通过 service 注入固定 `now`。
- 响应只返回批次计数、状态和稳定 warning code，不返回 open_id、客户名、商机名或卡片正文。
- 状态：`disabled | plan_only | completed | partial | blocked`。

## 6. 失败路径

| 场景 | 行为 |
| --- | --- |
| 无效 Token | 401，零业务读取 |
| 开关关闭 | `disabled`，零业务读取、零账本写入 |
| 时区无效 | 跳过该租户，记录 warning |
| 成员无权限/失效 | 跳过该成员，不投递 |
| 来源 unavailable | 对应场景零投递，其他场景继续 |
| 同键并发 | 仅一个 worker 获得 claim |
| 明确 API 拒绝 | failed，有界重试 |
| 网络中断/空 message id | uncertain，冻结自动重发 |
| 风险未变化 | 更新/保持观察基线，零投递 |

## 7. TDD 验收矩阵

| ID | 自动化验收 |
| --- | --- |
| PN-T01 | 上海与不同时区在各自 09:00/10:00/每日17:00/周五17:05 命中，窗口外不命中 |
| PN-T02 | 开关关闭或错误 Token 时数据 reader、账本、sender 均未调用 |
| PN-T03 | 两租户、两成员计划与账本键完全隔离，disabled member 不进入计划 |
| PN-T04 | 任务三类正确分组，无命中项不建通知，同日重复只发送一次 |
| PN-T05 | 新风险、升级风险发送；不变、改善、来源不完整不发送；解除后再升级可发送 |
| PN-T06 | 日报、个人周报、团队周报分别按权限和范围生成；空日报生成“今日无新增”，来源异常不伪造数字 |
| PN-T07 | 并发 claim 只有一个成功；租约、重试次数和 retry_after 生效 |
| PN-T08 | dispatching 后未知结果进入 uncertain 且重复执行不重发 |
| PN-T09 | Card 2.0 标题、摘要、数据截止时间、组件白名单、受信 HTTPS 跳转和数量上限正确 |
| PN-T10 | Controller 凭证、模块装配、迁移和外部单次调度客户端通过 |
| PN-T11 | 全量既有 Agent 测试、三套 TypeScript、Lint、Agent/Web build 回归通过 |
| PN-T12 | 持久灰度只允许 `daily_report`、`weekly_team`，且 tenant/member/open_id 三重白名单完全匹配后才读取业务和投递 |

## 8. 2026-10-13 灰度启用验收计划

1. 先以固定时间运行 `plan_only`：每天 17:05 只计划本人日报；周五 17:10 只计划本人日报和
   团队周报，不计划个人周报、任务卡或风险卡。
2. 在数据库确认目标 tenant/member/open_id 唯一且 active 后，幂等追加 `manager` 角色，保留
   原 `sales` 角色；不在通用迁移中写入环境专属标识。
3. 只向本人真实发送一次团队周报，回读消息和账本，并以同一时间重复运行验证零重复发送。
4. 自动化、真实单次投递和日志均通过后，才把本地忽略配置中的计划与投递开关开启，并安装
   每 5 分钟调用一次 runner 的外部调度。
5. 临时公网地址失效时，详情链接不得被当作可用入口；正式长期运行前需替换为稳定 HTTPS
   地址，或暂时省略详情按钮。消息正文与去重不依赖 Web 页面。

## 9. 2026-10-12 实现与验证记录

- 已实现独立受保护调度入口、5 分钟单次调用客户端、租户时区窗口、成员与权限重验、
  Card 2.0 生成、飞书本人投递适配器、持久领取/重试/未知投递状态机及风险观察基线。
- 已实现四类触发：09:00 任务行动、10:00 商机风险变化、18:00 个人日报、周五
  17:00 个人周报与有权限主管的团队周报。任务按人按天合并；空活动日报不发送。
- TDD Red 证据包括：空活动日报仍生成卡片、空 `message_id` 被错误归为可重试、请求参数
  配置异常未归类为发送前失败；修复后相关专项 `16/16` 通过。
- 自动化结果：主动通知单元 `26/26`、Agent `74 files / 623 tests`、外部 runner `5/5`，服务端、测试和客户端
  TypeScript、ESLint、Stylelint、Agent build（141 files）、Web build、`git diff --check`
  均通过。构建仅保留既有 Vite 模块类型和大 chunk warning。
- 已恢复 loopback 项目 PostgreSQL；第一次迁移完整 apply 到 020，第二次全部 skip。主动通知
  仓储集成 `3/3` 通过，覆盖并发 claim、sent 去重及风险基线租户/成员隔离；全套 PostgreSQL
  `26 passed / 3 controlled live probes skipped`。
- 产品负责人确认后，以固定当地 `18:05` 执行本人个人日报门禁。plan-only 为 1 个租户、1 个
  活动销售成员、1 张计划、0 发送、0 警告；成员与既有 tenant/member/open_id 白名单完全一致，
  无主管角色和汇报关系。
- 首次真实调用被飞书 HTTP 400 明确拒绝且没有 message ID。根因是 Card 2.0 混入旧版 `note`
  组件，并且 Axios 4xx 未被发送器识别为明确拒绝。新增两条测试先 Red，再改为合法的
  `column_set + button(open_url) + markdown` 和明确 4xx 有界重试；定向 `9/9`、服务端类型、
  目标 ESLint、Agent 141 文件构建及 diff 检查通过。
- 人工对账 400 为未送达后，以同一业务键和稳定 UUID 重试成功。账本唯一一行状态为 `sent`、
  `attempt_count=2`，message ID `om_x100b63fb8345e0a8b1a888ac59ac51e`；相同调用复验为
  0 新发送、1 个 `already_sent` 跳过。飞书回读确认 interactive 卡片标题为“销售日报”并包含
  HTTPS 查看入口。
- 测试只发本人，没有主管/群消息，没有 Base/Task 写入。两个运行开关仅在单次进程临时开启，
  持久配置仍为默认 `false`；未安装或启用 cron。

## 10. 发布门禁

1. 代码合入时 `PROACTIVE_SALES_NOTIFICATIONS_ENABLED=false`、
   `PROACTIVE_SALES_NOTIFICATIONS_DELIVERY_ENABLED=false`。
2. 自动化 Green 后只允许本地固定时间 service 验证和数据库集成测试。
3. 配置真实调度器前先运行 plan-only 并检查租户、成员、权限和通知数量。
4. 第一次真实消息必须由产品负责人另行明确确认，只允许测试租户、本人 open_id、单一通知。
5. 消息、账本、重复调用和 Web 链接回读全部通过后，才允许逐类开启生产投递。

## 11. 2026-10-13 灰度上线证据

- 新规则测试先得到 `8 failed / 10 passed` Red，修复后定向 `32/32` Green；全量 Agent
  `83 files / 709 tests`、PostgreSQL `32 passed / 3 controlled probes skipped`、三套
  TypeScript、统一 Lint、Agent/Web build、runner、发布器与 diff 检查通过。
- 真实成员回读唯一匹配 active tenant/member/open_id；幂等追加 `manager` 后有效角色为
  `sales + manager`，未修改原销售角色，也未伪造历史生效时间。
- 周日 17:05 固定时间 plan-only 为 1 张本人日报；周五 17:10 为本人日报和团队周报 2 张；
  均为 1 租户、1 成员、0 警告、0 发送。
- 以当前主管权限补发上一完整工作周团队周报，5 天来源均 ready。真实消息 ID 为
  `om_x100b63ea097b8cb8de76154402b7eeb`；项目应用回读为 interactive 卡，标题和周期正确，
  不含临时 Serveo 地址。账本为唯一 `sent`、`attempt_count=1`，重复投递返回 `already_sent`。
- 本地持久配置只启用 `daily_report,weekly_team` 并保留 tenant/member/open_id 三重白名单；
  `SalesAgentProactiveReports` 每 5 分钟调用 runner，`SalesAgentRuntime` 登录后恢复 Agent。
  运行验收退出码 0，非窗口 0 计划、0 发送，Agent stderr 为空且飞书长连接已连接。
- 当前限制：Windows 计划任务只在该用户已登录且本机运行时生效；休眠、关机或退出登录期间不
  具备服务器级 SLA。临时隧道不作为详情地址，报告卡暂不显示 Web 跳转。
