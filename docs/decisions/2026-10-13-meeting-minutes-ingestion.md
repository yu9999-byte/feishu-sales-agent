# 飞书妙记录入跟进：决策问答

状态：`已确认并实现 / 自动化 Green / 真实妙记与飞书 UI 待验收 / 2026-10-13`

本文件保留 B4 妙记输入切片的产品与技术取舍。可执行契约以
[飞书妙记跟进录入 SDD](../specs/39-meeting-minutes-ingestion-sdd.md) 为准，当前完成度以
[需求追踪矩阵](../specs/05-requirements-traceability.md) 为准。

## 问：销售发一条妙记链接后，Agent 应该直接写跟进吗？

答：不直接写。妙记只是输入来源，仍由 LangChain/LangGraph 判断本轮是否是
`followup_capture`。识别为写跟进后，系统读取逐字稿、生成草案，并把现有一张可编辑确认卡
发回原聊天；销售确认前不得写 Base 或创建飞书任务。

明确的“写跟进 + 妙记链接”可以走既有确定性命令入口，但不能绕过链接安全校验、当前销售
授权、成员权限和人工确认门。普通问答、内容生成和只分析会议的意图继续走各自分支。

## 问：为什么不用机器人 token 读取妙记？

答：妙记是用户资源，机器人可用不等于当前销售有权读取。生产读取固定使用当前销售通过
OAuth 获得的 `user_access_token`，授权按 `tenant_id + member_id` 隔离；读取前再次确认成员
仍为 active 且具有本人跟进创建权限。缺授权时只给当前用户授权入口，不回退到 bot token。

## 问：OAuth token 怎么保存？

答：access token 和 refresh token 只以 AES-256-GCM 密文进入独立控制库，密钥由当前租户
应用 Secret 和租户/应用上下文派生。数据库同时保存有效期、scope 和版本；临期 access token
通过最新 refresh token 刷新，并同时轮换两份密文。明文不得进入日志、审计、Git 或 API 响应。

## 问：资源只读 scope 已经开通，为什么还必须请求 `offline_access`？

答：资源 scope 决定“可以读什么”，`offline_access` 决定“能否获得 refresh token 并在
access token 过期后继续代表当前销售访问”。本项目需要长期运行的 Agent，不能只保存一枚短期
access token。授权入口因此固定把 `offline_access` 与妙记、Docx、Wiki scope 一起请求；回调
缺 refresh token 时继续 fail closed，不回退 bot token，也不把页面上的“授权完成”当作凭据
已经落库。

## 问：使用飞书 AI Summary 还是逐字稿？

答：只使用 Transcript 作为跟进事实源。AI Summary、AI Todo 和 Chapter 都不能替代原话，
否则模型结论无法回到说话人和时间位置核验。系统保留每段说话人、相对时间戳和原话，并让
跟进抽取器继续执行现有 evidence quote 校验。

## 问：逐字稿太长怎么办？

答：送模正文上限为 120,000 个 UTF-16 code unit。优先保留完整的开头和结尾发言段，中间
插入明确省略标记；若单个发言段本身已超过预算，则保留该段说话人/时间头和受限正文，且不会
切断代理对。无论来源形态如何，规范化正文都不能突破上限。

## 问：读取过程中用户能看到什么？

答：原聊天先出现“正在读取妙记逐字稿并整理跟进”。成功后发送现有确认卡；授权、权限、空稿
或上游失败时，直接把原等待消息更新为可操作的失败终态，不再额外发送一条失败消息并留下
悬空“正在读取”。同一消息重复投递只读取一次、只生成一张确认卡。

## 问：失败时会产生半成品或业务副作用吗？

答：不会。授权缺失、资源无权、逐字稿为空、限流/超时、非法 URL 或模型抽取失败都不得创建
待确认动作，更不得写 Base/Task。审计只记录稳定哈希、计数、错误码和是否可重试，不记录
minute token、URL、逐字稿或用户 token。

## 问：当前已经可以宣称真实完成吗？

答：不能。当前代码、迁移、单元/集成、类型、Lint、构建和隔离启动已通过，状态为
`Implemented / automated green / real source and UI pending`。升级为 `UI Verified` 还需要：

1. 飞书应用已开通 `minutes:minutes:readonly`；
2. 当前销售重新完成包含该 scope 与 `offline_access` 的 OAuth；
3. 提供一条该账号确实有权访问的真实妙记链接；
4. 在真实飞书私聊核对等待态、同聊天确认卡、说话人/时间证据和确认前零写入。

在完成上述步骤前，不发送测试消息、不读取真实妙记，也不把替身网关测试写成真实 UI 证据。
