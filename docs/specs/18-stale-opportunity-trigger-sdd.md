# 商机停滞 7 天提醒 S4 触发规格（部分实现）

## 2026-10-05 S4-014 真实环境只读执行准备度

- 新增 `GET /internal/stale-opportunity-reminder/execution-readiness`，复用执行专用 Bearer 凭证，
  但不要求打开执行开关。凭证缺失/错误在 readiness 服务前拒绝；响应设置 `no-store` 且不返回
  任一令牌、应用 Secret 或数据库连接信息。
- 准备度要求真实提醒和执行开关均保持关闭；检查扫描/执行凭证已配置且不同、三项白名单完整、
  历史治理与 sender 标记，并只读解析精确租户、成员和当前有效角色权限。飞书数据源检查同时要求
  租户集成、应用 Secret 引用、Base 映射完整，候选探针再用真实 Base/Task 读取验证来源可用性。
- 候选探针通过 `tenantId + memberId` 限制 `StaleOpportunityTriggerService` 的运行范围。目标租户/
  成员在二次读取时消失、session 身份/open_id 不一致、缺少 `review:read-personal`、分页/外部来源
  不完整、零候选、非白名单候选或多候选均返回机器可读 blocker，不产生部分可执行结果。
- uncertain 账本只按白名单租户读取 1 条；任何记录或查询异常均阻断。readiness 服务不注入
  `StaleOpportunityReminderCoordinatorService`、提醒账本 claim 服务或 sender，因此所有路径均无投递
  副作用，也不会修改 Base、Task、客户、商机或跟进。
- 真实本机探针确认唯一租户“P0 演示企业”和销售“李胜彬”的 active 状态、本人 open_id、个人
  Review 权限、数据源和空 uncertain 账本。候选扫描 `complete` 但为 0 条，最终 blockers 为
  `history_governance_incomplete`、`sender_unconfigured`、`candidate_not_found`；提醒/执行保持关闭，
  探针后该租户提醒账本仍为空，未调用 `/execute`，未创建 cron。
- 自动化覆盖凭证拒绝、开关意外开启、凭证复用、白名单/身份/open_id/权限/数据源失败、账本异常、
  来源不完整、零/非白名单/多/单候选、目标中途消失及模块装配。完整质量门与发布证据以当前状态
  和需求追踪矩阵为准。

## 2026-10-05 S4-013 受控真实执行入口（自动化完成，真实投递关闭）

- 新增 `POST /internal/stale-opportunity-reminder/execute`，使用独立于扫描入口的
  `STALE_OPPORTUNITY_REMINDER_EXECUTION_TOKEN`。请求严格只含 `opportunityRecordId` 和
  `followupVersion`；服务端不接受调用方提供的 tenant、member、recipient 或 message。
- 新增 `STALE_OPPORTUNITY_REMINDER_EXECUTION_ENABLED`，默认 `false`，并要求明确配置一个
  `allowedTenantId`、一个 `allowedMemberId` 和该销售本人的 `allowedRecipientOpenId`。执行器
  先调用现有安全门和 plan-only 扫描，再要求唯一匹配候选同时命中三项白名单。
- 受控链已在 Nest 注册 sender、协调层和执行服务；每次请求最多处理一个候选。发送前仍完整
  重验租户、成员、角色、权限、商机/跟进/Task 证据和账本状态。冷却/在途/待重试重复请求不重发，
  `delivery_unknown` 或来源/权限/版本变化统一停止并返回机器可读 halted 结果。
- 本阶段只验证 fake SDK、拒绝路径、token 隔离、唯一候选、幂等和模块装配；不启 cron、不调用
  真实端点、不发送飞书消息。真实投递必须在历史治理、密钥管理、日志与消息回读准备完成后由人
  单独确认。
- 验证证据：定向 `29/29`、全量 Agent `409/409`、完整 Postgres `19/19`、统一 Lint、三套
  TypeScript、Agent/Web 构建、迁移幂等复跑和 `git diff --check` 通过。

## 2026-10-05 飞书本人提醒适配器（未接运行时）

- `FeishuStaleOpportunityReminderSender` 重新按 `tenantId` 解析有效租户集成，使用该租户飞书应用
  的 bot 身份和 `receive_id_type=open_id`，只向发送前重验得到的当前销售本人发送静态文本。
- 提醒内容固定包含商机、超过 7 天无可核实有效跟进、最近有效跟进时间和建议动作。来自 Base 的
  业务字段压成单行并限制长度；不接受群聊 ID，不提供自动建任务、修改商机或升级主管动作。
- `StaleOpportunityReminderService` 用 `(tenantId, reminderKind, opportunityRecordId,
  followupVersion)` 生成稳定幂等键，适配器哈希为飞书 `uuid`；账本仍是跨小时/跨进程的最终去重源。
- 飞书明确非零响应在请求层已被拒绝，包装成 retryable 并写 `REMINDER_DELIVERY_FAILED`；网络异常、
  请求结果未知或成功响应缺少 `message_id` 保持 unknown，写 `REMINDER_DELIVERY_UNKNOWN` 并停止重发。
- 适配器及跨层账本测试 `7/7`，提醒服务 + 适配器定向 `15/15`，全量 Agent `385/385`；统一
  Lint、服务端/客户端/测试类型检查和 diff 检查通过。
- 适配器未注册 Nest，批次执行链仍无 HTTP 入口和 cron；测试只调用假 SDK，没有真实飞书投递、
  消息回读或运行日志，生产入口继续停留在 preflight、dry-run 和 plan-only。

## 2026-10-04 计划到持久账本的离线执行链

- `StaleOpportunityReminderExecutionService` 先调用 plan-only 服务；计划不是 `ready` 时直接返回
  原状态，不调用协调层，不重扫业务数据，也不领取提醒账本。
- ready 计划先按 `(tenantId, opportunityRecordId, followupVersion)` 拒绝重复候选，再逐条调用
  `StaleOpportunityReminderCoordinatorService.prepareAndDeliver`。协调层仍负责租户/成员/角色/
  权限重验、商机/跟进/Task 全量重扫、六字段证据一致性和持久账本领取。
- 来源无法核实、证据无效、负责人不一致、未知投递、任何失败或协调器异常都使批次进入
  `halted`，停止后续候选；即使单候选已处理完，未知投递仍保持 `halted`，不能误报 `completed`。
- Postgres 集成用隔离测试租户和假 sender 验证首次写入、同版本冷却与证据变化不领取旧键。
  假 sender 的 `sent` 只证明代码链路，不是飞书消息投递证据。
- 该服务未注册 Nest，未新增 HTTP 执行路由，也没有真实 sender 或 cron。当前可调用入口仍只有
  preflight、dry-run 和 plan-only；生产账本不会因本切片被领取。
- 验证证据：批次单测 `10/10`、S4 执行链定向 `46/46`、全量 Agent `378/378`、Postgres
  `15/15`、统一 Lint、类型检查、Agent/Web 构建和 diff 检查通过；未启动 Agent 或执行飞书 UI。

## 2026-10-04 只读提醒计划入口（plan-only）

- 新增 `POST /internal/stale-opportunity-reminder/plan`，使用已有
  `STALE_OPPORTUNITY_TRIGGER_TOKEN` Bearer 认证并设置 `Cache-Control: no-store`。凭证未配置
  或无效时，在 preflight 和任何业务读取前拒绝。
- `StaleOpportunityReminderPlanService` 固定按“运行前安全门 -> 只读 dry-run 扫描 -> 计划”
  执行。preflight 为 `disabled` 或 `blocked` 时返回同状态空计划且不扫描；只有 `ready` 才调用
  `StaleOpportunityTriggerService`。
- 扫描必须为 `complete` 才能输出候选。扫描 `incomplete` 或抛出异常时返回 `incomplete`、空
  `items`、压制数量和机器可读 warning，不允许部分候选进入后续步骤。
- 完整候选保留 `tenantId`、`memberId`、商机 ID/名称、当前负责人 `ownerOpenId`、最新有效跟进
  ID、可信沟通时间和跟进版本；响应固定为 `mode=plan-only`，作为未来发送前二次核验的输入证据。
- 本入口不领取提醒账本、不调用 `StaleOpportunityReminderCoordinatorService` 做投递前二次核验、
  不调用 sender、不发送飞书消息、不创建或启用 cron，也不写客户、商机、跟进或 Task。
- 验证证据：全量 Agent `368/368`、Postgres 集成 `15/15`、统一 Lint、测试类型检查、Agent/Web
  构建和 `git diff --check` 通过；本轮未启动真实 Agent，未执行飞书 UI 或消息验收。

## 2026-10-04 受控运行时安全门（未接真实投递）

- 新增 `StaleOpportunityReminderRuntimeService.prepare` 作为未来扫描/投递运行前的唯一安全门。
  `STALE_OPPORTUNITY_REMINDER_ENABLED` 默认 `false`；关闭时返回 `disabled`，保证不读取商机、
  Task、账本或发送器，不领取租约，不发送消息。
- 投递开关明确开启后，依次检查 `STALE_OPPORTUNITY_SCAN_ENABLED`、专用触发令牌、历史数据治理
  标记 `STALE_OPPORTUNITY_HISTORY_GOVERNANCE_READY` 和发送器配置
  `STALE_OPPORTUNITY_REMINDER_SENDER_CONFIGURED`。任一条件不满足返回 `blocked`，不继续读取
  未知投递对账。
- 静态条件全部通过后，只读查询 `uncertain` 账本（limit=1）。存在未知投递返回
  `uncertain_delivery_present`；查询失败返回 `reconciliation_unavailable`；只有空结果才返回
  `ready`。该查询不改变账本、不自动重试，也不调用 sender。
- 安全门目前只作为受控运行时准备能力注册到 Nest，外部入口仍固定 `dry-run`，没有 cron、真实
  飞书 sender 或真实消息验收。历史治理标记必须由人工完成证据后再配置，不能视为自动治理结果。

## 2026-10-04 受保护运行前检查接口（只读）

- 新增 `GET /internal/stale-opportunity-reminder/preflight`，使用已有
  `STALE_OPPORTUNITY_TRIGGER_TOKEN` 的 Bearer 认证；认证失败不得调用安全门。
- 认证通过后只返回安全门的 `disabled`、`blocked` 或 `ready` 结果，并设置 `Cache-Control: no-store`。
  该接口不扫描商机、不读取 Task、不领取提醒账本、不调用 sender，也不启动调度器。
- 它只用于未来调度器/运维在运行前读取机器状态，不能作为真实消息发送成功、历史治理完成或
  cron 已部署的证据。

## 2026-10-04 未知投递只读对账

- 持久账本提供 uncertain 记录的只读查询，按租户可选过滤，单次最多返回 100 条，按
  updated_at 从旧到新排序，返回商机、有效跟进版本、负责人、尝试次数、投递开始时间、
  失败代码、失败信息和更新时间。
- 对账服务只读且 fail closed：租户或上限参数无效、数据库不可用时返回空列表和 warning。
  它不会调用发送器、领取租约、修改账本或将未知结果转为可重试失败。
- 当前没有运营 API、自动 cron 或 UI 入口；后续人工核对飞书消息结果后，恢复动作必须独立
  设计幂等键、权限和审计，不能由本查询隐式触发。

## 2026-10-04 发送前二次核验（离线安全编排）

- `StaleOpportunityReminderCoordinatorService` 默认关闭且关闭时零读取。开启时对原候选
  重新读取活跃租户与成员会话，检查角色、`review:read-personal` 和 tenant/member/open ID；
  任何授权或来源异常均不领取账本。
- 使用同一时间点全量重扫本人商机、有效跟进和未完成任务，要求扫描完整且原商机只产生一个
  候选。商机 ID、名称、负责人、跟进 ID、可信沟通时间和版本逐字段一致时，才调用持久
  提醒服务；新跟进、生命周期/负责人变化、任务出现、分页不完整或候选重复均安全停止。
- 单测与真实 Postgres 账本 + 假发送器集成验证首次领取、重复冷却及证据变化。该集成的
  `sent` 是假发送结果；协调层未注册 Nest，外部入口仍固定 `dry-run`，无真实飞书消息、
  cron 或 UI 验收。业务数据在二次扫描与未来真实发送之间仍可能变化；受控投递前应确认
  可接受的时效边界，不能把本测试宣称为端到端原子一致性。

## 2026-10-04 外部调度只读入口（cron-ready，默认关闭）

- 独立 Agent 新增 `POST /internal/stale-opportunity-scan/run`，供部署环境中的外部 cron 调用。
  该路由不使用 Web Cookie 或请求用户身份，只接受 `STALE_OPPORTUNITY_TRIGGER_TOKEN` 对应的
  Bearer 令牌；缺失或错误令牌必须在读取 Postgres、Base 或 Task 之前拒绝，令牌不得写日志。
- `STALE_OPPORTUNITY_SCAN_ENABLED` 默认 `false`。关闭时服务返回 `disabled` 且不枚举租户；
  启用后仅从 Agent Postgres 的 `agent_tenants + tenant_integrations` 枚举租户有效且集成启用的
  连接，并在扫描前按 tenant ID 重读连接状态。
- 每个租户从 `tenant_members` 枚举成员。停用成员跳过；活跃成员必须通过
  `getSessionByMembership` 的当前角色校验并具有 `review:read-personal`。成员与会话的 tenant、
  member ID 或 open_id 不一致时视为来源损坏，整批 fail closed。
- 获准成员调用现有 `StaleOpportunityScanService`，重新读取本人商机、关联跟进和任务并保留
  原有全分页、负责人、生命周期、可信沟通时间、来源版本、7 天阈值和工作时间窗门禁。任一
  租户读取失败、身份服务异常或成员扫描 `incomplete` 时，顶层状态为 `incomplete`，清空其他
  成员已观察到的候选，仅保留压制数量、跳过原因、warning 和内存审计证据。
- 响应固定为 `mode=dry-run`。本切片没有调用 `StaleOpportunityReminderService`，没有领取提醒
  账本租约，没有飞书发送器、任务写入、Base 写入或主管通知；重复调用只重复只读计算。
- 当前仅完成“可被 cron 安全调用”的服务边界，尚未在部署环境创建或启用 cron。配置外部 cron
  后也必须保持业务开关关闭，直到历史数据治理、二次核验的受控运行时接线、本人通知和
  `uncertain` 人工对账全部完成。

## 2026-09-29 持久提醒账本切片（未接入运行时）

- 需求 S4-002：同一租户、商机、有效跟进版本和提醒类型的并发扫描只能取得一个发送租约。
  成功投递记录飞书消息 ID；同版本发送后冷却 7 天，新跟进版本可独立判断。
- 投递前从 `claimed` 原子转到 `dispatching`。仅确知没有发出的失败才允许进入 15 分钟
  重试；网络超时、未知结果和发送成功后落库失败保持 `uncertain`/`dispatching`，停止自动重发，
  待运营对账。过期但尚未进入投递的 `claimed` 租约可安全重领。
- 账本迁移 `011`/`012` 已在当前开发数据库执行；单测和 Postgres 并发/冷却/重试/未知结果
  集成测试通过。当前仅有可注入的发送端口，没有真实发送器、平台触发器或运行模块接线。
  服务显式启用且有效跟进超过严格 7 x 24 小时才可投递；生产开关保持关闭。
- 上线前仍须逐条确认历史商机状态与可信时间，扫描完成后重新校验租户、当前负责人、状态、
  最新跟进、工作日投递窗和任务可见性；建立受控测试商机的真实本人通知、人工确认和
  `uncertain` 对账恢复。不得把本切片等同于主动提醒已交付。

## 2026-09-29 数据准备度报告切片（只读）

新增 `GET /api/platform/stale-opportunity-readiness`，要求当前 Web 会话具备
`review:read-personal`。接口沿用本人和租户边界，完整读取商机与跟进分页，返回每条商机的：

- 生命周期状态；`unknown` 明确标记为 `status_unconfirmed`，不从当前进展文本推断；
- 最新有效跟进记录和沟通发生时间；没有可验证时间时标记为 `followup_time_missing`；
- 记录链接、阻断原因和可进入停滞扫描的汇总数量。

任一来源分页不完整、游标循环、读取异常或身份/连接不可用时，报告返回
`incomplete`/`unavailable`，不把部分数据作为准备完成。该接口只读，不启用扫描、不写入
状态、不创建任务、不发送提醒；后续仍由销售逐条确认状态并治理历史沟通时间。

以下 2026-09-27 内容保留当时的历史状态；以本节和最新需求追踪为当前口径。

## 2026-09-27 状态维护切片（聊天确认 UI Verified，S4 仍默认关闭）

既有商机状态不再通过脚本或当前进展文本批量推断。当前已完成独立状态更新网关契约：

- 每次更新必须绑定唯一商机记录 ID、当前销售和确认时看到的旧状态；
- 目标只能是 `active`、`won`、`lost`、`closed` 四类已配置值；
- 执行前重新读取并校验负责人及旧状态，只提交生命周期字段；
- 写入后重新读取核对，任何不一致都视为失败；
- `opportunity_operation` 已接入本人商机读取、名称归一化唯一匹配、目标状态澄清、一次确认卡、
  取消和重复确认保护；确认才调用网关，未匹配或目标不明确只追问；状态动作不写客户、跟进
  或任务，并记录 `opportunity_status.pending_confirmation` 审计。
- 自动化已覆盖状态意图、确认执行、取消、重复确认和 fail-closed 分支；受控商机真实飞书卡片、
  写后 Base 回读和审计已验收。其余 4 条历史商机仍为空，因此 S4 仍默认关闭。

2026-09-27 真实只读清单显示 5 条本人商机的“商机状态”均为空。当前进展不能作为生命周期
状态证据；在销售逐条确认前，扫描继续将其映射为 `unknown` 并安全跳过。

状态：`Partial / scan green / status confirmation UI Verified / disabled / production prerequisites open / 2026-09-27`。本规格
属于同一个销售跟进 Agent 的内部触发能力，不是新的用户产品；目前已有无外部副作用的判定
层、逐商机有效沟通汇总、本人范围内的 Base/Task 游标分页，以及默认关闭的只读扫描编排。
尚未实现持久去重、调度和投递。没有创建、启用或运行定时任务，也没有发送主动提醒；本轮仅
按销售确认写入 1 条受控商机，没有批量修改其余 4 条历史商机。

## 目标与前置条件

当本人负责的有效商机超过连续 7 x 24 小时没有有效跟进时，在合适时间向本人发送一次
带证据的提醒，提供可编辑的建议。提醒不是商机状态变更、客户外部消息或飞书任务创建。

上线前必须具备：

1. 为每个商机建立可信的最近有效跟进时间。现有客户表“最后跟进时间”是客户级，多个商机
   共享客户时不能代替逐商机时间。2026-09-26 已只读核对真实 Base 字段：商机表没有
   最近有效跟进时间。跟进表已新增并验证“本次沟通发生时间”（`datetime`，字段 ID
   `fld28D7L08`），并保留“关联商机”；“截止时间”是下一步计划，不能代替已发生跟进。
   未来确认跟进只有在草案提供明确发生时间时才写入该字段；历史记录没有自动回填，只有原始
   证据明确给出时间时才允许后续单独回填，无法核实的保持未知并跳过提醒。仍须明确“有效
   跟进”的来源、与商机的关联、事件时间/时区、删除和修订规则。单纯 `last_modified_time`
   可能被编辑触发，不能猜填。
2. 销售agent应用身份已开通 `task:task:read`，并用该应用自身 actor `open_id` 完成真实只读
   回归：Task v2 搜索返回 `code=0`、5 条本人未完成任务、`notice=false`。接口真实单页上限为
   30，适配器必须消费每个 `page_token`；读取失败或部分可见时不得称“暂无任务”。
3. 商机必须有独立生命周期状态字段，并在租户映射中显式配置字段名及 active/won/lost/closed
   值。2026-09-26 真实商机表已新增“商机状态”（`fldfJ2CIxp`），选项为“进行中”、
   “已赢单”、“已丢单”和“已关闭”，运行时映射已同步。5 条既有商机保持空状态，不从
   “当前进展”猜测；真实只读扫描将其全部映射为 `unknown`，以 `inactive` 跳过，未读取 Task。
   后续由用户确认产生的新商机使用租户配置的首个 active 值初始化，当前为“进行中”；更新
   已有商机时不提交生命周期字段，避免擅自覆盖空状态或重新打开终态商机。
4. 外部定时触发宿主采用部署环境 cron 调用独立 Agent 的受保护 HTTP 入口；不在 Nest 启动
   钩子中启动 `setInterval` 或长轮询。入口契约已实现但 cron 尚未创建或启用。平台
   `@Automation/@BindTrigger` 不属于当前独立 Agent 运行时，不能凭装饰器存在宣称已调度。

## 扫描与判定

- `StaleOpportunityScanService` 默认关闭，仅由显式 `enabled=true` 的受控调用执行。它不创建
  调度器、不写控制库/Base/Task，也不发消息，只返回候选证据和逐商机跳过原因。
- 固定扫描窗口未来由调度器触发；当前编排按租户分页读取本人商机和跟进记录，仅使用当前租户
  映射和负责人 open_id。Base 单页最多 500 条，Task 单页最多 30 条；调用方必须消费全部 token。
  API 声明还有下一页却没有 token、token 循环、达到页数保护上限、Task notice 或任一读取异常，
  都会将整轮标记为 `incomplete`、清空候选并返回 warning。
  不在内存中全量装入多租户数据。已赢单、已丢单、关闭、无负责人、无可靠活动时间的记录
  跳过并记录原因；时间冲突或来源不可用时 fail closed。
- 每条候选读取客户、该商机近况、关联的有效跟进和本人未完成任务；计算
  `now - lastEffectiveFollowupAt > 7 * 24h`。消息解释要展示商机名、最后有效跟进时间、
  关联来源和建议动作，不能将模型推断或 Mem0 当成业务时间事实。
- 同一商机只要存在已关联但沟通时间或来源版本不可验证的跟进，就不使用更早的有效时间
  生成停滞候选；准备度显示沟通时间待确认，待销售治理后再恢复扫描。这样不会把一条
  未填写可信发生时间的新跟进误判为长期未跟进。
- 汇总结果必须保留待确认跟进的 `followupRecordId` 和 `followupVersion`，以便工作台在
  版本仍可校验时逐条治理；`followupVersion`/`sourceVersion` 只用于并发校验，不能代替
  沟通发生时间。若商机版本不可验证，工作台不得提交状态确认；若跟进记录或版本不可验证，
  工作台不得展示可修改沟通日期的操作。
- 默认仅在租户本地工作日 09:00-18:00 投递；窗口外延迟到下一个允许窗口。租户时区来自
  可信配置，不使用宿主机器本地时区。时间窗口与阈值边界需要 DST/跨日测试。
- 去重使用持久化 `(tenantId, opportunityRecordId, lastEffectiveFollowupVersion,
  reminderKind)` 唯一键，并记录最近发送时间、状态和飞书消息 ID。对同一活动版本至少 7 天
  冷却；活动时间变化后重算。重试先查发送状态，避免崩溃重复发送；失败可审计、可重试。
- 只发给商机当前负责人本人，不向客户或主管发送。主管升级、外部消息、任务创建和高风险
  商机字段更新必须再次由人明确确认；初版不实现自动升级主管。

## 默认关闭与验收

功能开关默认关闭，未来触发器建立后仍不自动激活。现有自动化已覆盖无活动时间、7 天边界、
新跟进、负责人/状态、免打扰与夏令时，逐商机最新可信沟通，商机/跟进跨页 token，Task 全
分页、分页缺口、Task 失败/notice、已有未完成任务和 eligible 候选。运行时沟通时间映射已
补齐，Task 权限和商机生命周期字段/映射均已完成真实回归。空或未知状态会在 Task 查询前
安全跳过；无效跟进会在 Task 查询前以 `unverified_followup` 安全跳过，并保留记录 ID/版本
供治理；新建初始化与已有状态保留也有自动化边界测试。状态聊天确认闭环已进入工作流和网关
回归；S4 定向测试 `21/21`、全量 Agent 测试 `288/288` 通过。

未完成项仍包括：既有商机状态分类、历史可信沟通时间治理、部署环境 cron、发送前二次重读、
提醒账本与运行入口接线、确认门和真实投递。持久账本自身的并发、冷却、失败重试和结果未知
保护已经完成自动化，但尚未由 dry-run 入口调用。完成后再在受控测试商机、本人飞书 UI、控制库、
Task 和 Base 对账，并观察错误提醒率、重复提醒率和用户确认率。未完成这些证据前不推送真实
提醒。
