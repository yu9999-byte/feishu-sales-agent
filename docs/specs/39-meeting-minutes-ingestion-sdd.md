# 飞书妙记跟进录入 SDD

状态：`Implemented / automated green / real source and UI pending / 2026-10-13`

关联需求：`ING-004`、`FUP-001..003`、`PLT-001..006`

## 1. 本切片目标与边界

销售在与“销售agent”的同一私聊中发送一条自己有权访问的飞书妙记链接，并明确或由
对话中枢判断为“写跟进”意图后，系统使用该销售的飞书用户授权读取妙记逐字稿，保留
说话人和相对时间证据，生成现有可编辑跟进草案，并把确认卡发回原聊天。

本切片复用现有草案、检查、确认和执行状态机，不创建第二套跟进执行器。草案确认前不得
写入 Base、飞书任务或其他业务系统。本切片不实现机器人实时入会录音，不搜索自然语言
描述的历史会议，不把妙记 AI Summary 当作事实来源，也不发送真实测试消息。

首轮真实妙记和飞书 UI 证据缺失时，状态只能是
`Implemented / real source and UI pending`，不能声明端到端完成。

## 2. 产品与交互流程

```text
销售在机器人私聊发送妙记链接或“把这条妙记写成跟进 + 链接”
-> LangChain/LangGraph 判断是否为 followup_capture
-> 原聊天状态消息：正在读取妙记并整理跟进
-> 按 tenant + member 查找有效的飞书用户授权
-> 读取妙记元信息与 Transcript（显式请求说话人、时间戳）
-> 规范化并校验逐字稿，生成带证据的跟进草案
-> 原聊天状态消息更新为“已生成待确认草案”
-> 原聊天发送现有一张可编辑确认卡
-> 销售一次性确认后才进入现有 Base/Task 执行器
```

异常交互：

- 未完成用户授权：原聊天返回一次性飞书授权链接，说明“授权后重新发送该链接”；不读取
  资源、不生成草案、不写业务数据。
- 无权访问、资源不存在或上游用同类状态返回：统一显示“无法读取这条妙记，请确认当前账号
  已获查看权限”，不得泄漏资源是否存在或所有者信息。
- 逐字稿为空：说明当前没有可用逐字稿；不回退使用 AI Summary。
- 限流、超时、5xx 或读取中断：显示可重试失败；不创建半成品草案。
- 非法 URL：按普通对话处理；若 URL 外形明确指向妙记但域名、协议、路径或 token 非法，
  返回安全校验失败，不向该地址发起网络请求。

## 3. 意图与来源路由

妙记 URL 解析只是输入模态识别，不取代 AI 意图识别：

- `followup_capture` + 合法妙记链接：进入本流程。
- `followup_analyze`：只分析，不创建跟进草案；后续另立会议分析规格。
- `sales_qa/general_chat/content_generate`：仍走普通对话。
- 仅发送一条合法妙记链接：对话提示词将其作为“从妙记导入跟进”的产品入口示例，由
  LangChain/LangGraph 分类；业务代码不使用“妙记”等关键词代替主分类。
- 明确命令“写跟进 + 妙记链接”可以使用现有确定性命令直达，但仍必须经过来源校验、
  用户授权和确认门。

只接受 `https` 且主机为 `feishu.cn`/`larksuite.com` 本身或其合法子域，路径必须为
`/minutes/{minute_token}`，忽略 query/hash。token 只允许小写字母和数字，
长度为 8..128。禁止接受用户名密码、IP、端口、相似后缀或跨域重定向形式。

## 4. 身份、授权与凭据

妙记属于用户资源，生产读取必须使用当前销售自己的 `user_access_token`，不能使用
tenant/bot token。授权绑定键为 `(tenant_id, member_id)`，并在读取前再次核对该成员仍为
active 且拥有 `followup:create-own`。

OAuth code 换取的 access/refresh token 必须在完成 tenant/open_id/member 校验后才保存。
数据库只保存 AES-256-GCM 密文、到期时间、scope 和版本；密钥从当前租户应用 Secret 加
tenant/app 上下文派生，明文不得进入日志、审计、API 响应或 Git。应用 Secret 轮换后旧密文
不可读，用户需重新授权。access token 到期前 60 秒刷新，刷新后同时替换 access token 和
refresh token；refresh token 过期或被撤销时进入重新授权，不用 bot token 降级。

授权入口必须同时请求 `offline_access`。飞书只有在用户授权包含该 scope 时才返回
`refresh_token` 和其有效期；因此妙记、Docx、Wiki 三类资源 scope 与 `offline_access` 必须在
同一次用户授权中出现。回调仍须拒绝缺少 refresh token 的响应，不能把短期 access token
冒充为可持续凭据，也不能在凭据到期后回退为 bot token。

## 5. 来源与逐字稿契约

内部标准结果：

```text
sourceType: minutes
sourceRefHash: sha256(tenantId + minuteToken)
title: 妙记标题（只作展示元数据）
segments[]: { index, speaker, relativeTime, text }
normalizedText: 由 segments 确定性拼接的原始证据文本
truncated: boolean
```

规范化行使用 `说话人 相对时间戳` 加下一行原话，保证模型返回的 evidence quote 能在
`normalizedText` 中逐字定位。标题、AI Summary、AI Todo 和 Chapter 不混入事实正文。

逐字稿最大送模长度为 120,000 字符。超限时按完整发言段落保留开头和结尾各约一半，并插入
明确的系统截断标记；不得截断在 token、说话人头或 UTF-16 代理对中。草案携带
`sourceRefHash`、段落数和 `truncated`，但不在普通日志保存原文或 minute token。

## 6. 状态、幂等与审计

- 飞书消息领取键仍为 `(tenant_id, message_id)`；同一事件重投只创建一个来源读取和草案。
- 草案 `sourceMessageId` 保持最初提交消息，卡片和结果都回到同一 `chat_id`。
- 新审计事件只记录哈希与计数：`minutes.ingestion.started.v1`、
  `minutes.ingestion.completed.v1`、`minutes.ingestion.failed.v1`；不得记录 token、URL、逐字稿、
  access token 或 refresh token。
- 读取完成到草案创建之间失败时不产生待确认动作；重新发送新消息可以安全重试。
- 现有确认门、动作 CAS、执行超时和 Base/Task 幂等继续生效。

## 7. API/端口与异常码

```text
MinutesIngestionService.ingest(integration, actorOpenId, sourceUrl, now)
FeishuUserTokenService.getValidAccessToken(integration, memberId, now)
FeishuMinutesGateway.readTranscript(integration, minuteToken, accessToken)
```

| code | retryable | 用户动作 |
| --- | --- | --- |
| `MINUTES_INVALID_REFERENCE` | false | 重新发送合法妙记链接 |
| `MINUTES_AUTHORIZATION_REQUIRED` | false | 打开授权链接并重新发送 |
| `MINUTES_ACCESS_DENIED` | false | 申请当前账号的查看权限 |
| `MINUTES_TRANSCRIPT_EMPTY` | false | 等待转写完成或换一条妙记 |
| `MINUTES_DEPENDENCY_UNAVAILABLE` | true | 稍后重试 |

## 8. TDD 验收矩阵

| ID | Red 场景 | Green 验收 |
| --- | --- | --- |
| `MIN-AUTH-00` | OAuth 入口仅请求资源 scope | 授权 URL 同时包含 `offline_access`，回调可获得可续期凭据 |
| `MIN-URL-01` | 合法飞书/Lark 妙记 URL | 稳定提取同一 token，query/hash 不影响 |
| `MIN-URL-02` | HTTP、相似后缀、IP、端口、路径混淆、短/非法 token | 拒绝且零网络调用 |
| `MIN-AUTH-01` | OAuth code 交换成功 | token 仅以密文按 tenant/member 保存 |
| `MIN-AUTH-02` | access token 临期 | 使用最新 refresh token 刷新并替换 |
| `MIN-AUTH-03` | 缺授权、refresh 过期、跨租户/跨成员 | fail closed，返回重新授权或统一拒绝 |
| `MIN-TXT-01` | 含说话人与时间戳的 Transcript | 生成稳定 segments 和可定位 normalizedText |
| `MIN-TXT-02` | 空、超长、无头文本、读取中断 | 空内容拒绝；超长完整分段；中断可重试 |
| `MIN-SRC-01` | 上游同时存在 Summary 与 Transcript | 草案只使用 Transcript，不读取/搬运 Summary |
| `MIN-WF-01` | 明确写跟进 + 妙记链接 | 原聊天等待态后发送现有确认卡 |
| `MIN-WF-02` | 同一消息重复投递 | 只读取一次、只创建一个待确认动作 |
| `MIN-WF-03` | 两租户、两成员、两聊天 | token、来源、草案、卡片全部隔离 |
| `MIN-WF-04` | 授权/权限/空稿/上游失败 | 原聊天给可操作反馈，零 Base/Task 写入 |
| `MIN-WF-05` | 草案未确认 | 只存在待确认动作，业务网关调用为零 |

## 9. 完成定义

自动化完成：规格、Red/Green、单元/契约/集成、租户与权限负向测试、三套 TypeScript、Lint、
Agent/Web 构建和迁移幂等全部通过。

真实完成：用户提供一条当前销售有权访问的妙记，重新完成带妙记 scope 与
`offline_access` 的用户授权；在真实
飞书私聊验证等待反馈、同聊天草案卡、说话人/时间证据和确认前零写入。只有这一步完成，
`ING-004` 才可标记 `UI Verified`。

## 10. 实现与验证记录（2026-10-13）

- 已实现安全 URL 解析、当前成员 OAuth token 密文存储/刷新、妙记元信息与 Transcript 读取、
  逐字稿规范化、LangGraph 意图示例、同聊天草案和来源快照。
- 单个发言段超过预算时也严格限制规范化正文长度，且不截断 UTF-16 代理对。
- 妙记失败会把原“正在读取”消息更新为授权/权限/空稿/可重试终态；更新失败才降级补发，
  不再留下无终态的等待消息。
- 定向测试 `94/94`，全量 Agent `667/667`；PostgreSQL 集成 `32 passed / 3 controlled live
  probes skipped`；三套 TypeScript、全仓 Lint/Stylelint、Agent/Web 构建通过。
- 迁移 022 已应用，并连续两次幂等跳过；隔离 webhook 模式在 `127.0.0.1:3224` 启动，首页
  `200`、未登录 Session `401`，随后关闭且没有外部消息副作用。
- `gen:db-schema` 属于妙搭平台 schema 工具，本地缺少平台内部域名时安全停止；它没有改写
  独立 Agent 控制库 schema，也不影响迁移 022 的 PostgreSQL 仓储集成验证。
- 当前没有读取真实妙记、发送真实测试消息或写 Base/Task。真实完成条件仍以第 9 节为准。
- 长期 OAuth 修复先把授权 URL 期望改为三类资源 scope 加 `offline_access`，定向测试按预期
  `1 failed / 6 passed`，实际 URL 缺少 `offline_access`；随后只修改统一 scope 列表，Green
  为 `7/7`。OAuth 相关回归 `4 files / 21 tests`、全量 Agent `83 files / 705 tests`、
  PostgreSQL `32 passed / 3 controlled probes skipped`、三套 TypeScript、统一 Lint、Agent/Web
  构建均通过。真实长期凭据与 Session 仍须重新 OAuth 后验收。
