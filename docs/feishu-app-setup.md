# 飞书应用配置清单

本文件描述 P0 开发和真实验收所需的飞书开放平台配置。它不保存任何 Secret、Token 或真实
客户数据。

> 第 1–11 节保留 P0 配置和真实证据。Goal v3 卡片新增要求见第 12 节；P0 的
> “确认并执行/取消”两按钮不代表新版聊天卡片已经实现。

## 1. 当前应用

| 项目 | 值 |
| --- | --- |
| 应用名称 | 销售agent |
| 应用类型 | 企业自建应用 |
| App ID | `cli_aa211d0457381bdf` |
| P0 用途 | 所属测试企业内的机器人、卡片、Base 和任务验证 |
| 多企业限制 | 自建应用不能直接作为多个企业安装的 SaaS 分发形态 |

生产阶段需要转换为商店/ISV 应用，或按企业配置独立应用。P0 不进行应用市场发布。

## 2. 凭证安全

- 已在对话中出现过的 App Secret 必须先重置。
- 新 Secret 不得再次发送到聊天、写入 Markdown、源代码或 Git。
- 本地仅通过进程环境变量或 Git 已忽略的 `.env.local` 配置 `FEISHU_APP_SECRET`；仓库中的
  `.env.example` 只能保留空值和占位符。
- 配置 `FEISHU_VERIFICATION_TOKEN`；仅在飞书后台启用请求加密后配置
  `FEISHU_ENCRYPT_KEY`。代码兼容明文验签和启用 Encrypt Key 后的解密验签。
- 日志只能显示凭证是否存在，不得显示值、前缀或哈希片段。

## 3. 应用能力

在飞书开放平台控制台确认：

- [x] 启用机器人能力。
- [x] 设置机器人名称并启用机器人能力。
- [x] 测试用户位于应用可用范围。
- [x] 启用事件订阅，并添加 `im.message.receive_v1`。
- [x] 启用卡片回调配置，并添加 `card.action.trigger`。
- [x] 发布包含最新权限与事件配置的测试版本 `1.0.1`。
- [x] 测试用户能在飞书中找到并私聊机器人。

控制台只保存草稿时，真实客户端不会获得最新能力；必须确认测试版本已生效。

## 4. 事件与回调

| 类型 | 标识 | 身份 | P0 用途 |
| --- | --- | --- | --- |
| 消息事件 | `im.message.receive_v1` | Bot | 接收机器人私聊 |
| 卡片回调 | `card.action.trigger` | Bot | 处理确认和取消 |

已通过本机飞书 CLI Schema 确认：

- `im.message.receive_v1` 的私聊读取 scope 为 `im:message.p2p_msg:readonly`。
- `card.action.trigger` 自动读取原卡片内容需要 `im:message:readonly`。
- 接收消息的业务幂等键使用 `message_id`，不能使用可能随重投变化的 `event_id`。
- 卡片回调的 `event_id` 可用于投递去重，实际业务执行以 `pending_action_id` 原子状态为准。

### 传输模式

目标 SaaS 使用公开 HTTPS 回调，由 NestJS 负责验签、解密和快速响应。开发期可使用
`lark-cli event consume` 的长连接模式抓取样例事件，但长连接调试不替代生产 Webhook 验收。

HTTP 模式至少需要：

```text
POST /webhooks/feishu/events
POST /webhooks/feishu/cards
```

具体是否合并端点由 SDK 决定，消息和卡片必须进入不同的领域处理器。

## 5. 最小权限

| 能力 | 最小目标权限 | 证据来源 |
| --- | --- | --- |
| 接收私聊 | `im:message.p2p_msg:readonly` | Event Schema |
| 读取卡片上下文 | `im:message:readonly` | Card Action Schema |
| 以机器人发送消息/卡片 | 控制台当前版本的“以应用身份发消息”权限 | 实际发送 API 或缺权错误 |
| 创建任务 | `task:task:write` 或控制台等价 write-only 权限 | Task v2 Schema |
| 读取 Base 结构与记录 | 控制台当前 Base 只读权限 | Base API 实际调用 |
| 写 Base 记录 | 控制台当前 Base 记录写权限 | Base API 实际调用 |

飞书权限名称可能随控制台版本调整。除已由本机 Schema 返回的 scope 外，不凭记忆猜名称；
首次失败时以响应中的 `permission_violations` 和控制台链接为准，只申请缺失权限。

2026-09-18 控制台实测状态：

| Scope | 状态 |
| --- | --- |
| `im:message.p2p_msg:readonly` | 已开通 |
| `im:message:readonly` | 已开通 |
| `im:message:send_as_bot` | 已开通 |
| `base:record:read` | 已开通 |
| `base:record:create` | 已开通 |
| `base:record:update` | 已开通 |
| `base:record:retrieve` | 已开通 |
| `base:table:read` | 已开通 |
| `base:field:read` | 已开通 |
| `task:task:write` | 已开通；可指定人员仅包含当前测试用户 |

`base:record:read` 的控制台名称“检索特定记录”并不覆盖 `search` / `list` 接口。真实
OpenAPI 返回 `99991672` 后，按其最小缺权提示补充了 `base:record:retrieve`。

## 6. 消息处理约束

P0 只接受：

- `chat_type == "p2p"`
- `message_type == "text"`
- `sender_type == "user"`
- 发送者位于当前应用可用范围
- 消息所属 `tenant_key` 已启用

事件中的 `sender_id` 是用户 `open_id`，可直接作为 P0 默认任务负责人。P0 不为展示姓名
额外申请通讯录权限。

## 7. 卡片约束

P0 使用 Card 2.0：

- 卡片根节点必须包含 `"schema": "2.0"`。
- “确认并执行”和“取消”按钮配置 callback behavior。
- 按钮 `value` 只携带不可猜测的 `pending_action_id` 与动作名。
- 不在按钮值中携带租户 ID、Base Token、业务完整 payload 或 Secret。
- 回调后校验 `operator_id`、租户、状态和有效期。
- 卡片延迟更新 Token 有效期 30 分钟、最多使用两次。
- 延迟更新必须提交完整新卡片，不支持局部 patch。
- 即使卡片更新失败，后端动作终态仍必须可靠持久化并可查询。

P0 卡片动作：

```json
{
  "action": "confirm",
  "pending_action_id": "opaque-id"
}
```

“取消”只改变待确认动作状态，不调用 Base 或 Task API。

## 8. Demo Base 权限

创建 Demo Base 后执行：

1. 记录真实 `base_token`、三个 `table_id` 和字段 ID。
2. 由创建者确认客户、商机、跟进三表结构。
3. 确认机器人/应用身份对该 Base 具有所需读取和写入权限。
4. 使用目标应用身份完成一次只读 Schema 检查；已通过。
5. 使用专用测试记录完成一次写入；已写入三条带 `P0测试` 前缀的记录并回读。
6. 将 ID 和字段映射写入租户配置，不写死在 Agent 代码中。

Base shortcut 的 `record-upsert` 不会按业务字段自动 upsert。Agent 必须先查询客户或商机，
再使用真实 record ID 更新；不能仅凭命令名称假设业务幂等。

## 9. 飞书任务约束

任务创建使用 Task v2：

- scope 为 `task:task:write` 或控制台提供的等价 write-only scope。
- 负责人使用消息事件中的当前用户 `open_id`。
- 应用身份不能跨租户添加任务成员。
- 标题不能为空，最多 3000 个 UTF-8 字符。
- 日期只给到天时创建全天任务；明确时间时使用毫秒时间戳。
- 使用 `client_token` / idempotency key 防止重复创建。
- 成功证据必须包含任务 `guid` 和可打开的 `url`。
- 用户确认前禁止调用任务创建接口。

## 10. 开发前置检查

进入业务开发后，按顺序验证：

1. 新 App Secret 已安全配置。
2. 应用能力与可用范围正确。
3. 最小权限已添加并发布测试版本。
4. 长连接或 Webhook 能收到一条真实 `im.message.receive_v1`。
5. Bot 能向同一用户发送一条普通测试消息。
6. Bot 能发送 Card 2.0，且收到 `card.action.trigger`。
7. 应用身份能读取 Demo Base Schema。
8. 应用身份能创建一条分配给测试用户的飞书任务。
9. 再进入完整 Agent 闭环联调。

每一步保存非敏感证据：事件类型、message ID、record ID、task GUID、时间和结果；不保存 Token。

## 11. 当前状态

| 检查项 | 状态 |
| --- | --- |
| 自建应用已创建 | 已确认，可由当前登录账号管理 |
| Secret 已重置 | 用户报告已重置；本地 `FEISHU_APP_SECRET` 已设置，换取应用身份 Token 成功 |
| 机器人能力已启用 | 已启用，`1.0.1` 已发布生效 |
| 权限已配置并发布 | 已发布，并补充 `base:record:retrieve` |
| 事件或回调已配置 | 已更新到当前临时 HTTPS 地址，两条公网 URL challenge 均已通过 |
| Demo Base 已创建 | 已完成；目标应用身份可读写，三条验收记录已回读 |
| 飞书任务创建权限 | 已创建并回读真实任务 |
| 公开 HTTPS 回调 | 当前临时 Tunnelmole 已从公网通过两类 challenge；不是稳定生产地址 |

2026-09-18 本地配置核对只检查了是否有值，未回显密钥：`FEISHU_APP_SECRET` 已设置，
`DATABASE_URL`、`LLM_BASE_URL`、`LLM_MODEL`、`FEISHU_VERIFICATION_TOKEN` 和
`LLM_API_KEY` 已设置；`FEISHU_ENCRYPT_KEY` 仍为空。`.env.local` 已被 Git 忽略，
Encrypt Key 未启用时为空属于预期。Verification Token 已在后台轮换，旧值失效；两个
本地 Webhook challenge 均已使用新值通过。替换后的 LLM API Key 已通过真实 HTTP 200
与 JSON 输出验证。
目标应用身份换取 Token 成功；版本发布后已用真实 Bot `open_id` 将机器人加入 Demo Base
协作者，应用身份已读取三表和字段，并完成记录写入与回读。

2026-09-18 重新建立临时公网隧道，控制台事件和卡片回调均已更新到当前地址；真实 Agent
处理的两条公网 URL challenge 均匹配。该证据只证明网络和 Verification Token 配置正确，
不等价于 F-01 真实消息或完整闭环通过。Encrypt Key 未启用，因此本地可暂不配置。

2026-09-18 已用当前登录账号访问目标 App ID `cli_aa211d0457381bdf`，确认应用属于
“轮动|AI数字化解决方案专家”，与 Demo Base 所在的轮动云文档环境一致。已有版本 `1.0.0`
于 2026-09-17 发布；新增机器人能力后控制台提示需要创建并发布新版本才会生效。
版本 `1.0.1` 已由企业管理员审核发布。发布后 Task v2 创建和读取均成功；验收任务 GUID 为
`02faa94b-74be-472b-bed1-804787c1659c`，任务负责人和截止时间均与确认卡片一致。

## 12. Goal v3 Card 2.0 增量约束

- 卡片表单根层使用 `form`；每个 `input` / `picker_datetime` 有唯一 `name`，提交按钮使用
  `form_action_type: submit`。回调中表单字段来自 `action.form_value`，不能误当普通
  `action.value` 确认事件。
- 草案卡回调携带不透明草案/版本/任务候选引用；服务端校验租户、提交人、来源聊天、
  卡片消息、当前版本、候选归属、时效和幂等。任何业务字段和租户信息均不信任客户端值。
- “编辑补充”“检查修改”更新原卡完整内容；Card 2.0 不保证按键级实时，用户提交或点击
  检查后异步刷新。延迟更新 Token 过期时允许在原聊天补发当前状态，但不能重放业务动作。
- 确认按钮根据任务情况写成“确认保存并创建所示待办”或“确认保存（不创建待办）”。
  保存成功后在原聊天发结果任务卡；项目推进质检仅在策略命中时另发。
- 现有 `im:message:*`、`task:task:write` 权限足以覆盖本人任务创建的目标；实现任务状态读取/
  更新、妙记、文档、群推送或用户/组织解析前，须按真实 API 缺权结果申请对应最小权限，
  不根据名称猜测 scope，也不能把应用发布状态误作功能 UI 验收。

2026-09-20 实施证据（历史临时域名）：机器人“写跟进/录入跟进”已返回 Card 2.0 录入表单；提交后立即显示
生成中，后台成功时更新原卡为草案，失败时恢复预填表单。原子
`input -> generating -> draft/input` 状态阻止重复模型调用。当前服务已重建并在
`https://yaagob-ip-113-87-154-44.tunnelmole.net` 通过首页、事件 challenge 和卡片
challenge；开发者后台两类 URL 已保存核对。

2026-09-22 运行态复核：上一条临时域名
`https://xg8hdf-ip-183-23-52-218.tunnelmole.net` 已退出并返回 404，导致飞书事件日志为空。
随后重新启动当前临时域名
`https://hwchvr-ip-183-23-52-218.tunnelmole.net`；事件和卡片回调分别为
`/webhooks/feishu/events`、`/webhooks/feishu/cards`，均已在开发者后台页面回读确认，
首页和两类 challenge 均返回 HTTP 200/合法 JSON。临时隧道重启后仍可能变化，后续复测以
`docs/current-state.md` 顶部最新记录为准。

真实飞书卡片已完成文本录入、v2/v3 再质检、一次确认、结果卡、Base 和任务 UI 对账。
卡片终态更新不得只依赖回调 token 或同步回调响应：服务保存原卡 `message_id`，执行完成后
使用消息 patch 持久化完整终态卡。日期选择器的初始值必须先按租户时区转换；本轮已核对
2026-09-22 14:00。条件风险第三卡仍需使用明确风险样本单独验收。
