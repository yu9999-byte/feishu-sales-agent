# 飞书文档跟进录入 SDD

状态：`Implemented / automated green / real source and UI pending / 2026-10-13`

关联需求：`ING-005..007`、`FUP-001..003`、`PLT-001..006`

## 1. 本切片目标与边界

销售在与“销售agent”的同一私聊中发送一条自己有权访问的飞书 Docx 或 Wiki 链接，
并明确或由 LangChain/LangGraph 判断为“写跟进”后，系统使用该销售的飞书用户授权读取
文档纯文本，生成现有可编辑跟进草案，并把确认卡发回原聊天。

本切片复用 B4 的用户凭据、草案、检查、确认和执行状态机，不创建第二套写入器。草案
确认前不得写入 Base、飞书任务或其他业务系统。首版只支持 Docx，以及最终解析为 Docx
的 Wiki 节点；不自动读取图片、附件、电子表格、多维表格、画板、思维笔记或子文档，
也不把机器人身份作为用户授权失败后的降级路径。

本切片不读取真实文档、不发送真实消息。自动化通过后状态只能是
`Implemented / automated green / real source and UI pending`。

## 2. 产品与交互流程

```text
销售在机器人私聊发送 Docx/Wiki 链接或“把这份文档写成跟进 + 链接”
-> LangChain/LangGraph 判断是否为 followup_capture
-> 原聊天状态消息：正在读取飞书文档并整理跟进
-> 按 tenant + member 查找有效的飞书用户授权，并校验本来源所需 scope
-> Docx 直接读取；Wiki 先解析节点，且只接受 obj_type=docx
-> 读取文档标题、revision_id 和 raw_content
-> 规范化正文并生成现有跟进草案
-> 原聊天状态消息更新为“已生成待确认草案”
-> 原聊天发送现有一张可编辑确认卡
-> 销售一次性确认后才进入现有 Base/Task 执行器
```

失败交互：

- 缺用户授权或缺少所需 scope：原等待消息更新为授权提示和授权入口；授权后由销售重新
  发送链接，不自动重放旧请求。
- 无权访问、资源不存在或上游用同类状态返回：统一显示“无法读取这份飞书文档”，不泄漏
  资源是否存在、所有者、空间或节点信息。
- Wiki 节点不是 Docx：明确说明首版仅支持飞书文档，不尝试下钻 Sheet/Base/附件。
- 正文为空：提示文档没有可用正文；不以标题、图片 OCR 或附件内容替代。
- 限流、超时、5xx 或读取中断：显示可重试失败，不创建半成品草案。
- 非法 URL：若只是普通外链则继续普通对话；若外形明确指向 Docx/Wiki 但协议、域名、路径
  或 token 非法，则在网络请求前安全拒绝。

## 3. 意图与来源路由

Docx/Wiki URL 解析只识别输入来源，不代替 AI 业务意图：

- `followup_capture` + 合法文档链接：进入本流程。
- `followup_analyze`：只分析，不创建跟进草案；文档分析另立只读规格。
- `sales_qa/general_chat/content_generate`：继续走对应对话分支。
- 仅发送一条合法 Docx/Wiki 链接：作为“从文档导入跟进”的分类示例交给
  LangChain/LangGraph，不通过“文档、链接”等关键词强制主分类。
- 明确命令“写跟进 + 文档链接”可使用既有确定性入口，但不能绕过来源校验、用户授权、
  成员权限和人工确认门。

只接受 `https`，主机必须是 `feishu.cn`/`larksuite.com` 本身或其合法子域，路径必须精确为
`/docx/{token}` 或 `/wiki/{token}`；query/hash 不参与身份。token 只允许字母、数字、
下划线和连字符，长度 8..128。禁止用户名密码、IP、非默认端口、相似后缀和额外路径。
一条消息首版只处理一个文档来源；同时包含多个不同文档来源时拒绝并提示一次提交一份。

## 4. 身份、授权与 scope

文档和 Wiki 都是用户资源，读取固定使用当前销售的 `user_access_token`。授权绑定
`(tenant_id, member_id)`；读取前再次校验成员 active、open_id 一致且拥有
`followup:create-own`。

所需用户 scope：

| 来源 | 必需 scope |
| --- | --- |
| Docx | `docx:document:readonly` |
| Wiki -> Docx | `wiki:node:read` + `docx:document:readonly` |

`FeishuUserTokenService` 必须按调用场景接收 required scopes，不能再把所有 token 获取硬编码为
妙记权限。妙记继续要求其只读 scope；文档只要求文档相关 scope。刷新响应未返回 scope 时保留
原凭据的已知 scope，不能把已知授权静默覆盖为未知。缺 scope 时 fail closed，不调用文档网关。

OAuth 授权入口请求妙记、Docx 和 Wiki 三类最小资源 scope，并必须同时请求
`offline_access`。飞书只在授权包含 `offline_access` 时返回 `refresh_token` 和其有效期；
因此回调继续要求可续期凭据完整，不能把只有短期 access token 的响应保存为长期授权。
access/refresh token 继续只以 AES-256-GCM 密文保存，明文不进入日志、审计、API 响应或
Git。

## 5. 来源与正文契约

内部标准结果：

```text
sourceType: document
referenceType: docx | wiki
sourceRefHash: sha256(tenantId + referenceType + originalReferenceToken)
title: 文档标题（展示元数据）
revisionId: Docx 最新 revision_id
segments[]: { index, text }
normalizedText: raw_content 的确定性规范化正文
truncated: boolean
```

Wiki 链接先通过当前用户 token 调用节点解析，只接受 `obj_type=docx` 且 `obj_token` 完整的
节点，再用同一用户 token 读取 Docx。来源哈希基于销售实际提交的原始 Wiki/Docx 引用，
审计不得保存 token、URL 或正文。

正文事实源只使用 Docx `raw_content`。标题和 revision 只作元数据；图片、附件、Sheet、Base、
画板和内嵌引用不自动下钻。规范化保留非空段落顺序和原文，统一换行。送模正文最大
120,000 个 UTF-16 code unit；超限时优先保留完整首尾段落并插入明确省略标记。单段超长时
安全保留首尾文本，不截断 UTF-16 代理对，最终正文不得突破上限。卡片来源快照携带来源种类、
标题、revision、段落数和截断标记。

## 6. 状态、幂等与审计

- 消息领取键继续是 `(tenant_id, message_id)`；重复事件只读取一次、生成一个草案和一张卡。
- 草案 `sourceMessageId` 保持首次提交消息，等待态、确认卡和失败终态都在同一 `chat_id`。
- 新审计事件为 `document.ingestion.started.v1`、`document.ingestion.completed.v1`、
  `document.ingestion.failed.v1`；只记录来源类型、哈希、revision、段落数、截断和错误码。
- 读取或生成失败不产生待确认动作；确认前 Base/Task 网关调用为零。
- 现有确认门、动作 CAS、执行超时、写入幂等和租户隔离继续生效。

## 7. 端口与异常码

```text
DocumentIngestionService.ingest(integration, actorOpenId, sourceText, now)
FeishuUserTokenService.getValidAccessToken(
  integration, memberId, now, requiredScopes
)
FeishuDocumentGateway.readDocument(integration, reference, accessToken)
```

| code | retryable | 用户动作 |
| --- | --- | --- |
| `DOCUMENT_INVALID_REFERENCE` | false | 重新发送一条合法 Docx/Wiki 链接 |
| `DOCUMENT_MULTIPLE_REFERENCES` | false | 一次只提交一份文档 |
| `DOCUMENT_AUTHORIZATION_REQUIRED` | false | 打开授权页并重新发送 |
| `DOCUMENT_ACCESS_DENIED` | false | 用当前账号申请查看权限 |
| `DOCUMENT_UNSUPPORTED_TYPE` | false | 换用 Docx 链接或复制文字 |
| `DOCUMENT_CONTENT_EMPTY` | false | 补充正文或换一份文档 |
| `DOCUMENT_DEPENDENCY_UNAVAILABLE` | true | 稍后重试 |

## 8. TDD 验收矩阵

| ID | Red 场景 | Green 验收 |
| --- | --- | --- |
| `DOC-AUTH-00` | OAuth 入口只请求三类资源 scope | 同一授权 URL 还包含 `offline_access`，可建立长期用户凭据 |
| `DOC-URL-01` | 合法飞书/Lark Docx、Wiki URL | 提取稳定类型/token，query/hash 不影响 |
| `DOC-URL-02` | HTTP、相似域、IP、端口、凭据、额外路径、非法 token | 网络调用前拒绝 |
| `DOC-URL-03` | 一条消息含两个不同文档来源 | 明确拒绝，不猜选 |
| `DOC-AUTH-01` | Docx、Wiki、妙记分别取 token | 只校验本场景 required scopes |
| `DOC-AUTH-02` | 缺 scope、跨租户/成员、刷新失败 | fail closed，网关零调用 |
| `DOC-AUTH-03` | 刷新响应省略 scope | 保留原 scope 并继续正确校验 |
| `DOC-API-01` | Docx 链接 | 同一 user token 读取 metadata + raw_content |
| `DOC-API-02` | Wiki 指向 Docx | 同一 user token 解析节点后读取 Docx |
| `DOC-API-03` | Wiki 指向 Sheet/Base/文件 | 返回 unsupported，零 Docx 读取 |
| `DOC-TXT-01` | 空、普通、超长和单段超长正文 | 空拒绝；原文有序；截断可见且不超长 |
| `DOC-WF-01` | 明确写跟进 + 文档链接 | 原聊天等待态后只发送现有确认卡 |
| `DOC-WF-02` | 同一消息重复投递 | 只读取一次、只生成一张卡 |
| `DOC-WF-03` | 授权/权限/类型/空稿/上游失败 | 原等待消息变终态，零 Base/Task |
| `DOC-WF-04` | 两租户、两成员、两聊天 | token、来源、草案和卡片全部隔离 |
| `DOC-WF-05` | 草案未确认 | 只有待确认动作，没有业务写入 |

## 9. 完成定义

自动化完成：规格、Red/Green、单元/工作流/租户与权限负向测试、三套 TypeScript、Lint、
Agent/Web 构建和隔离启动全部通过。

真实完成：应用已开通 `docx:document:readonly` 与 `wiki:node:read`，当前销售以三类资源 scope
和 `offline_access` 重新 OAuth，
并提供本人可读的 Docx 和 Wiki->Docx 各一条；在真实私聊核对等待态、同聊天确认卡、正文证据、
失败终态和确认前零写入。完成前不得标记 `ING-005..007` 为 `UI Verified`。

## 10. Red 记录（2026-10-13）

首次运行文档录入、飞书文档网关、用户 token 和 OAuth 定向测试，共有 4 个测试文件失败：

- `document-ingestion.spec.ts`：`DocumentIngestionService`、安全引用解析和正文规范化模块不存在；
- `feishu-document.gateway.spec.ts`：`FeishuDocumentGateway` 不存在；
- `feishu-user-token.spec.ts`：Docx/Wiki required scopes 被旧妙记 scope 硬编码错误拦截，刷新
  scope 保留用例失败；
- `feishu-web-auth.spec.ts`：授权 URL 仍只请求妙记 scope。

该失败发生在实现前，证明测试不是对既有行为的事后描述。本节保留原始失败原因。

## 11. Green 与回归证据（2026-10-13）

- 已实现 Docx/Wiki 安全引用解析、120,000 字符正文规范化、当前成员权限校验、按场景
  required scopes 取用户 token、Docx/Wiki 读取网关、来源快照、同聊天等待/失败终态、审计和
  现有确认卡接入。
- Docx 使用 metadata + `raw_content`；Wiki 使用同一用户 token 解析节点且仅接受 Docx。
  HTTP 401/403/404 与已知无权错误统一为不可读取，非 Docx Wiki 明确拒绝。
- OAuth 入口请求妙记、Docx 和 Wiki 最小资源 scope；本次真实 OAuth 诊断发现当时未请求
  `offline_access`，导致飞书不返回 refresh token。该缺口按 `DOC-AUTH-00` 进入独立 Red/Green，
  在完成前不能把页面授权动作记为长期授权成功。token 刷新响应省略 scope 时保留原已知授权，
  妙记与文档不再被彼此 scope 错误阻断。
- 新增跨租户/成员 token 与来源哈希隔离、妙记与文档混发零读取、无标题 Docx 安全回退回归。
  后两项先分别复现“无标题正文被误拒”和“混合来源提示错误”，再完成最小 Green 修复。
- 文档定向回归、全量 Agent、PostgreSQL 集成、三套 TypeScript、Lint/Stylelint、Agent/Web 构建、
  差异检查与隔离 webhook 启动均通过；隔离服务已关闭。
- 自动化全过程没有读取真实文档、发送飞书消息、写 Base/Task 或启用 cron。真实 Docx/Wiki
  来源和 UI 仍按第 9 节门禁待验收，因此不得升级为 `UI Verified`。
- `DOC-AUTH-00` 的 Red 先稳定复现授权 URL 仅含三类资源 scope；实现只在统一授权列表增加
  `offline_access`，不放宽 refresh token 校验。最小 Green `7/7`，OAuth 定向 `21/21`，全量
  Agent `83 files / 705 tests`，PostgreSQL `32 passed / 3 controlled probes skipped`，三套
  TypeScript、统一 Lint 和双构建通过。真实凭据与 Session 落库仍待重新 OAuth 验收。
