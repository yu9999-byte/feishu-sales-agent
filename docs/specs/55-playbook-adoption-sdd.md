# Playbook 可信采用记录 SDD

状态：`Implemented / automated green / real identity UAT pending 2026-10-23`

9c2 只记录销售对当前已发布 Playbook 的可信采用事件。浏览资料、点击页面、口头声明
或没有业务写入凭证都不能计为采用。该切片不发布 Playbook、不修改客户业务数据，也不
推断赢单或丢单因果；9c3 只消费通过本规格门禁的样本。

## 目标与边界

- 采用事件必须绑定租户、候选、当前发布版本、发布序号、当前成员和唯一请求编号。
- `record` 表示采用当前发布版本，必须提供一条本人真实成功写入的跟进、商机或任务证据。
- `retract` 追加撤回事件，不删除旧采用证据；撤回不携带业务证据。
- 采用记录按 CAS 序号追加，成功写入后不可修改；相同 `requestId` 只有参数完全一致时重放。
- 当前发布版本被撤回或替换后，旧版本采用请求拒绝；历史事件继续保留以供审计。

## 可信证据

证据包含 `kind`、真实业务 `recordId`、产生该写入的 `actionId` 和说明。服务端在锁定
候选行后读取 `pending_actions`，同时核对：

1. action 属于当前租户且由当前会话的 `feishuOpenId` 发起；
2. action 状态为 `succeeded` 或 `partialFailure`；
3. 记录 ID 与 action 结果字段精确一致：`followupRecordId`、`opportunityRecordId`
   或 `taskGuid`；
4. 证据类型与结果字段匹配，不能用任务 ID 冒充跟进或商机记录。

因此前端输入只提供检索所需的标识，不能替代服务端事实校验。

## 状态和接口

数据库迁移 `036_playbook_adoptions.sql` 建立 append-only `playbook_adoption_events`，
并为发布事件补充精确版本唯一约束和租户/候选、发布、action、成员外键。

- `GET /api/platform/playbook-candidates/:candidateId/adoption`：返回当前发布绑定、当前采用
  状态、采用/撤回计数和分页历史；始终 `Cache-Control: no-store`。
- `POST /api/platform/playbook-candidates/:candidateId/adoption`：要求
  `playbook:adopt`，只从登录会话注入租户和成员身份；支持 `record`、`retract`。
- 读操作要求 `playbook:read`。sales/manager 可采用本人事件，admin 可在租户范围采用，
  executive 不授予采用权限。
- 401/403/404 不保留前端敏感证据输入；409 刷新服务端状态但保留可重试的本地输入；
  503 表示结果未知，原请求保持可重放。

## 验收门

自动化必须覆盖成功采用、撤回、相同请求重放、请求参数变化、CAS 并发、跨租户、非本人
action、失败 action、证据类型错配、发布版本变化/撤回、HTTP 权限与 `no-store`。
本地集成测试使用临时 PostgreSQL 55437，并在验证后停止；没有 `DATABASE_URL` 时集成套件
按项目约定跳过。真实身份、真实租户资料发布和实际业务写入仍需单独授权与回读证据，
不能用合成 UI 或自动化测试替代。

