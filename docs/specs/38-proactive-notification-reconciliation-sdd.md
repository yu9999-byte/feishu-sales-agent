# 主动通知未知投递对账 SDD

状态：`Implemented / UI pending / 2026-10-13`

关联决策：D-042、D-053、D-056

## 1. 背景与目标

统一主动通知已经具备 `claimed -> dispatching -> sent/failed/uncertain` 投递状态机。
网络中断、请求超时或飞书返回空消息 ID 时，系统不能证明消息是否送达，因此必须冻结为
`uncertain`，禁止自动重发。

2026-10-12 的本人真实投递测试证明冻结策略有效，但也暴露了运营缺口：当记录进入
`uncertain` 后，只能由开发人员直接修改数据库，无法通过受权限保护、可审计的产品入口完成
核对和恢复。本切片建立正式的管理员对账闭环，且不发送任何真实消息、不启用调度。

## 2. 产品规则

### PN-008 当前租户未知投递清单

- 只有拥有 `admin:manage-policies` 的当前飞书 Web 会话可以访问。
- 服务端从会话注入 `tenantId`，请求不得指定或覆盖租户。
- 清单只返回当前租户 `uncertain` 记录，按最近更新时间倒序，单次最多 100 条。
- 返回通知类型、业务发生键、收件人姓名、尝试次数、调度开始时间、失败代码、脱敏失败说明和
  乐观并发版本；不返回 Secret、Token 或收件人 open_id。
- 读取失败时返回明确的 `unavailable` 和 warning，不修改账本。

### PN-009 三种人工裁决

管理员必须选择一项裁决并填写 5～2000 字的核对说明：

1. `confirm_sent`（确认已送达）：必须同时提供真实飞书消息 ID 和实际发送时间；记录终态改为
   `sent`，不会再次发送。
2. `authorize_retry`（确认未送达并释放一次重试）：不得提供消息证据；记录改为可领取的
   `failed`，并把本记录的尝试上限固定为“当前尝试次数 + 1”。该动作本身不调用 sender，后续
   只有在主动通知投递开关开启且调度再次命中同一业务键时，才允许一次新的发送尝试。
3. `keep_frozen`（证据不足，继续冻结）：保持 `uncertain`，只更新对账版本并追加审计。

### PN-010 乐观并发与幂等边界

- 写入请求必须携带清单中的 `expectedUpdatedAt`。
- 只有当前状态仍为 `uncertain` 且 `updated_at` 完全一致时才能裁决。
- 记录不存在、已被其他管理员处理或版本变化时返回 404/409，账本与审计均零写入。
- 同一旧版本请求不会重复释放重试或生成第二条成功裁决。

### PN-011 不可变审计

- 每次成功裁决向独立对账表追加一条不可变记录，保存操作人、裁决、理由、原投递状态、原失败
  证据、消息证据和裁决时间。
- 状态修改与审计插入必须由同一条 PostgreSQL CTE 原子完成；不得出现状态改变但缺少审计。
- 审计表以租户和通知 ID 建外键，租户删除时随租户数据一并清理。

### PN-012 管理员 Web 入口

- 新增 `/admin/notification-deliveries`，导航名称为“通知运营”，仅有
  `admin:manage-policies` 权限时显示。
- 页面使用紧凑卡片列表而不是横向表格，兼容 360px、768px 和桌面宽度。
- 页面必须覆盖 loading、ready、empty、error 和 conflict 状态；空态明确表示当前没有需要
  人工核对的未知投递。
- 每条记录一次只处理一个裁决。对话框展示裁决影响、必填说明，以及 `confirm_sent` 独有的
  消息 ID/发送时间字段。
- 提交时按钮进入“正在提交裁决…”状态并禁止重复点击；成功后显示明确成功反馈并刷新清单；
  失败或冲突在当前记录附近显示，不静默失败。
- 提交中隐藏关闭按钮，阻止 Esc、遮罩点击和受控 `open=false` 关闭；表单字段不可编辑并显示
  旋转中的提交状态，直到返回成功或失败，避免用户误以为请求已中断。

### PN-013 零外部副作用

- 本切片的列表和裁决 API 不调用飞书 sender，不发送消息，不写 Base/Task，不启用 cron。
- `authorize_retry` 只改变内部投递资格；当前两个主动通知持久开关继续保持 `false`。
- 自动核验飞书历史消息不在本切片范围内，管理员必须依据真实飞书消息记录人工判断。

## 3. 技术架构

```text
管理员 Web 会话
  -> GET /api/platform/proactive-sales-notifications/reconciliation
  -> FeishuWebAuth + admin:manage-policies
  -> ProactiveNotificationReconciliationService
  -> PostgresProactiveNotificationStore.listUncertain()

管理员裁决
  -> POST /api/platform/proactive-sales-notifications/reconciliation/:notificationId
  -> 会话注入 tenantId + operatorMemberId
  -> 参数/证据校验 + expectedUpdatedAt
  -> 单 SQL CTE 更新通知账本并追加不可变审计
  -> Web 明确成功 / 冲突 / 失败反馈
```

模块仍位于 `insight/ProactiveSalesNotificationModule`，不新增重复的通知账本或第二套发送器。

## 4. 数据模型

### `proactive_sales_notifications` 增量

| 字段 | 规则 |
| --- | --- |
| `id` | UUID，租户内唯一，作为 Web 裁决资源 ID |
| `attempt_limit` | nullable；为空使用系统默认最大尝试次数，人工释放时固定为 `attempt_count + 1` |

领取失败记录时使用
`attempt_count < COALESCE(attempt_limit, runtime_max_attempts)`。人工释放后的下一次领取会把
`attempt_count` 增加到 `attempt_limit`，因此后续明确失败不会再自动领取；再次出现不确定结果仍
回到 `uncertain` 等待新一轮人工核对。

### `proactive_sales_notification_reconciliations`

保存：租户、对账 ID、通知 ID、预期版本、原状态、裁决、结果状态、操作成员、理由、消息证据、
原尝试次数、原调度时间、原失败代码/说明、裁决时间。表只追加，不提供更新或删除业务接口。

## 5. API 契约

### `GET /api/platform/proactive-sales-notifications/reconciliation?limit=50`

- `200`：`{ status: 'ready', items, warnings: [] }`
- 依赖不可用：`{ status: 'unavailable', items: [], warnings: [...] }`
- 无会话 `401`；无权限 `403`。

### `POST /api/platform/proactive-sales-notifications/reconciliation/:notificationId`

请求：

```json
{
  "expectedUpdatedAt": "2026-10-12T10:05:00.000Z",
  "decision": "authorize_retry",
  "note": "飞书会话中未找到对应消息，确认本次未送达"
}
```

`confirm_sent` 额外要求 `messageId`、`sentAt`。成功返回对账 ID、裁决、前后状态和新版本时间。
验证失败 `422`，记录不存在 `404`，版本或状态冲突 `409`，数据源故障 `503`。

## 6. 失败路径

| 场景 | 处理 |
| --- | --- |
| 未登录/会话失效 | 401，零读取或零写入 |
| 无管理员策略权限 | 403，零账本读取或写入 |
| limit、UUID、时间或说明无效 | 400/422，零写入 |
| 已送达但缺消息 ID/发送时间 | 422，保持 uncertain |
| 非已送达裁决夹带消息证据 | 422，保持 uncertain |
| 跨租户通知 ID | 404，不泄露记录是否存在 |
| 并发管理员先完成裁决 | 409，要求刷新，不自动覆盖 |
| 审计插入失败 | 整个 CTE 不生效，通知仍 uncertain |
| 数据库不可用 | 503/页面 error，不调用 sender |

## 7. TDD 验收矩阵

| 编号 | 先失败的验收条件 |
| --- | --- |
| PNR-T01 | 只列出会话租户的 uncertain 记录，且不返回 open_id |
| PNR-T02 | limit 非整数、越界或租户为空时读取前失败关闭 |
| PNR-T03 | `confirm_sent` 缺少消息证据时拒绝，账本零写入 |
| PNR-T04 | `authorize_retry` 只释放一次额外尝试且不调用 sender |
| PNR-T05 | `keep_frozen` 保持 uncertain 并生成不可变审计 |
| PNR-T06 | 旧 `expectedUpdatedAt` 返回冲突且不产生第二条审计 |
| PNR-T07 | 相同通知 ID 在另一个租户返回 not found，零跨租户写入 |
| PNR-T08 | 状态修改与审计插入的 PostgreSQL 集成测试同成同败 |
| PNR-T09 | Controller 从 Web Session 注入租户和操作人并要求管理员权限 |
| PNR-T10 | 导航仅向管理员策略权限暴露，SPA 路由可直接打开 |
| PNR-T11 | 页面具备 loading/empty/error/conflict/提交中/成功反馈文案 |
| PNR-T12 | 全量回归中主动通知默认关闭，测试过程没有真实投递 |
| PNR-T13 | 提交中对话框不可被关闭，字段不可编辑，且完成后才进入成功或失败反馈 |

## 8. 本轮边界与发布门禁

- 本轮不创建 uncertain 测试数据污染真实租户；PostgreSQL 集成使用隔离测试租户并在结束后清理。
- 本轮不进行真实飞书发送，也不安装、启用或修改 cron。
- 自动化、类型、Lint、Agent/Web 构建、迁移幂等和差异检查全部通过后，状态才可改为
  `Implemented / UI pending`。
- 必须使用真实管理员账号在 Web 查看空态或受控 unknown 记录并完成一次人工裁决，才能标记
  `UI Verified`；当前真实组织尚无 admin 角色，因此不伪造 UI 验收结论。

## 9. 实现与验收证据

- 迁移 021 已首次应用并再次 `skip`，后续不修改已入迁移账本的文件。
- 对账服务、Controller、管理员导航、Web 卡片列表和三类裁决均已实现；状态更新和审计使用
  同一 PostgreSQL CTE。
- 定向交互测试经历有效 Red：提交中关闭保护 helper 缺失导致失败；实现受控关闭守卫、
  Esc/遮罩拦截、字段禁用和 loading 后转 Green。
- Agent 全量 `77 files / 643 tests` 通过；PostgreSQL 集成为
  `31 passed / 3 controlled live probes skipped`。其中主动通知仓储 `8/8` 覆盖
  `confirm_sent` 的消息证据、失败字段清理、不可变审计、重复领取阻断、跨租户零写入和
  单次重试释放。
- runner `5/5`、只读 observer `10/10`、GitHub publisher `4/4`、三套 TypeScript、全仓
  ESLint/Lint/Stylelint、Agent/Web 构建和 `git diff --check` 通过。
- 隔离端口 `3213` 以 webhook 接收模式启动成功；页面返回 `200`，未登录列表 API 返回
  `401 UNAUTHENTICATED`。本轮没有调用 sender、没有发送飞书消息、没有写 Base/Task、没有
  创建或启用 cron。
- 当前真实组织没有 admin 角色，因此保持 `UI pending`，不把启动冒烟或自动化结果冒充
  管理员真实 UI 验收。
