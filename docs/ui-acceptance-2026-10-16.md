# 销售 Agent 全量 UI 验收记录（2026-10-16）

状态：`Executing / Goal v1`

## 1. 验收口径

- 验收账号：当前本人账号。
- 验收企业：当前 Demo 企业。
- UI 证据只来自真实飞书或 Web 界面；自动化、接口和数据库回读仅作辅助证据。
- 测试写入使用唯一 `UI-UAT-20261016` 标识，不删除或覆盖历史业务数据。
- 不向群、主管或其他用户发送消息，不修改正式 cron、权限或应用发布配置。
- 当前账号不可访问的主管、管理员、第二企业或多角色场景标记 `Blocked`，不伪造通过。
- `Draft` 功能标记 `Not Implemented`；`Partial` 功能只验收当前已存在的产品面。

## 2. 状态定义

| 状态 | 含义 |
| --- | --- |
| `Pending` | 尚未执行本轮 UI 操作 |
| `Pass` | 当前版本有直接 UI 证据，结果符合预期 |
| `Pass (reused)` | 同日、同版本直接 UI 证据已存在，本轮复用以避免重复业务写入 |
| `Fail` | UI 可达，但结果与当前规格不符 |
| `Blocked` | 缺少账号、权限、样本或外部入口，无法诚实完成 |
| `Partial` | 只有部分闭环或只读产品面可验收 |
| `Not Implemented` | 仍为规格或路线项，没有可验收 UI |

## 3. 运行基线

| ID | 检查项 | 状态 | 证据 / 备注 |
| --- | --- | --- | --- |
| `BASE-01` | Agent 服务监听并提供首页 | `Pass` | 2026-10-16 14:51 重启到最新构建，PID `40400`；本地 `3100` 返回 200，首页显示“销策 Agent”，启动日志确认飞书长连接已连接 |
| `BASE-02` | PostgreSQL 可用 | `Pass` | 本地 `55432` 端口监听；仅作运行依赖证据 |
| `BASE-03` | 飞书当前账号已登录 | `Pass` | 飞书消息页可见本人会话列表和“销售agent”单聊 |
| `BASE-04` | 销售 Agent 单聊输入框可用 | `Pass` | 最新运行态只读复核已进入“销售agent”单聊，输入区显示“发送给 销售agent”；未发送消息 |
| `BASE-05` | 裸 Web 地址拒绝无企业信息入口 | `Pass` | `/api/auth/feishu/start` 返回“缺少企业入口信息”；符合企业入口保护，不作为工作台成功证据 |

## 4. 飞书机器人与消息卡片

| ID | 场景 | 预期结果 | 状态 | UI 证据 / 问题 |
| --- | --- | --- | --- | --- |
| `BOT-01` | 普通问候与自然问答 | 正常对话，不误建跟进 | `Pending` |  |
| `BOT-02` | 销售知识问答 | 回答带真实资料来源；无证据时明确降级 | `Pending` |  |
| `BOT-03` | 多轮上下文与意图承接 | 前文内容可被“帮我写跟进”正确承接 | `Pending` |  |
| `BOT-04` | 跟进澄清态中切换知识问答 | 回答问题后仍能继续原跟进上下文 | `Pending` |  |
| `BOT-05` | 文本跟进预填 | 原文转成一次提交表单，字段可编辑 | `Pending` |  |
| `BOT-06` | 实时质检与补充提示 | 缺失项、完整度、风险与建议清晰可见 | `Partial` | 真实飞书历史草案可见事实依据、预算/决策链/时间缺口、逾期风险和建议；同一逾期风险及“确认后才会执行”在历史卡中曾重复显示，当前版本需新草案复测后才能判断是否仍存在 |
| `BOT-07` | 表单校验 | 客户必选；下一步计划按当前规则校验 | `Partial` | 真实飞书历史草案可见“客户 *”“保存前检查”“请先确认：下一步时间”、禁用的无时间待办及“确认保存（不创建待办）”；当前版本提交校验待动作确认 |
| `BOT-08` | 不关联商机 | 确认后只写客户/跟进和所选任务 | `Pass (reused)` | `UI最终-NONE-R3-20261016`，跟进 `reczz28NwagNxZDd`；最新只读复核仍可见对应成功卡 |
| `BOT-09` | 关联已有商机 | 关联指定已有商机且不创建重复商机 | `Pass (reused)` | `UI最终-EXISTING-R4-20261016`，跟进 `reczz28NwuAJUCzO`，商机 `recvvIZtXDfkrg`；最新只读复核可见成功卡、跟进和任务链接，Base“跟进”表显示关联客户/关联商机字段 |
| `BOT-10` | 创建新商机 | 新客户、新商机和跟进关系正确 | `Pass (reused)` | `UI最终-CREATE-R1-20261016`，客户 `reczz28Nwxa7UaY2`，商机 `reczz28NwxcA59y1`，跟进 `reczz28Nwxf2dHj2`；最新只读复核仍可见对应成功卡 |
| `BOT-11` | 确认后的执行中状态 | 原卡立即进入“执行中，请等待” | `Pending` |  |
| `BOT-12` | 唯一成功/失败终态 | 不重复发成功卡；失败可重试 | `Pending` |  |
| `BOT-13` | 查看跟进与任务链接 | 链接可打开正确 Base 记录和飞书任务 | `Pass` | 2026-10-16 从当前成功卡打开跟进 `reczz28NwuAJUCzO` 和任务 `1c43dea7-6b58-4969-a7d6-7c33ba3df584`；任务标题、负责人、截止时间、摘要和 Base 记录 ID 一致 |
| `BOT-14` | 成功后编辑跟进 | 修订原记录而非重复创建 | `Fail / fix automated green / UI retest pending` | 点击 `UI最终-EXISTING-R4-20261016` 成功卡后界面未换成表单；审计已写 `card.edit_started`，但卡片归属被迁给不可见修订动作且失败未回滚。已改用 callback token 专用接口并补原子回滚、取消修订、失败审计与可重试结果卡；真实 UI 仍待最新运行态复测 |
| `BOT-15` | 妙记链接录入 | 读取本人可见逐字稿并生成同聊天草案 | `Blocked` | 当前本人没有已落库的长期 OAuth 凭据，且尚无本人可读妙记样本。唯一解锁：稳定 HTTPS OAuth 回调恢复后重新授权 `offline_access + minutes:minutes:readonly`，并提供一条本人可读妙记链接 |
| `BOT-16` | Docx 链接录入 | 读取本人可见 Docx 并生成草案 | `Blocked` | 三个已配置 Docx 已通过真实飞书 UI 验证本人可读，但当前本人没有已落库的长期 OAuth 凭据。唯一解锁：稳定 HTTPS OAuth 回调恢复后重新授权 `offline_access + docx:document:readonly`；样本无需另找 |
| `BOT-17` | Wiki 链接录入 | Wiki 解析到 Docx 后生成草案 | `Blocked` | 当前本人长期 OAuth 凭据缺失，现有三个样本均为 Docx，没有可验收的 Wiki→Docx 链接。唯一解锁：重新授权 `offline_access + wiki:node:read + docx:document:readonly`，并提供一条本人可读 Wiki→Docx 链接 |
| `BOT-18` | 商机生命周期确认卡 | 用户确认后只更新指定商机状态 | `Pending` |  |
| `BOT-19` | 重复消息与重复点击 | 幂等，不重复写入或重复发终态 | `Pending` |  |

## 5. 日报、周报与主动通知

| ID | 场景 | 预期结果 | 状态 | UI 证据 / 问题 |
| --- | --- | --- | --- | --- |
| `NTF-01` | 手动生成个人日报 | 在本人单聊收到结构化日报卡 | `Partial` | 真实飞书 UI 只读复核可见 2026-10-12、2026-10-13 两张日报卡，含概览、关键变化、下一步和只读提醒；当前版本手动触发仍待动作确认 |
| `NTF-02` | 手动生成本人团队周报 | 在本人单聊收到团队周报卡 | `Partial` | 真实飞书 UI 只读复核可见 2026-10-05 至 10-09、2026-10-12 至 10-16 两张团队周报卡，含团队成员、逾期任务、需关注成员和主管关注；当前版本手动触发仍待动作确认 |
| `NTF-03` | 日报工作日 17:00 计划 | UI 可说明当前启用状态；不改正式计划 | `Partial` | 2026-10-13 卡片显示数据截至 17:00，但聊天中仍有“为什么没有按时推送”的用户反馈；需当前计划/投递结果对账 |
| `NTF-04` | 周五周报计划 | UI 可说明当前启用状态；不改正式计划 | `Partial` | 历史团队周报卡存在；没有当前周五调度 UI 证据，不据此声明按时投递 |
| `NTF-05` | 任务到期/逾期提醒 | 验收当前已启用的本人通知产品面 | `Partial` | 日报和周报卡在真实 UI 中均提示 5 个未完成任务已逾期，证明风险被汇总展示；尚未看到独立的到期前一天、当天或逾期每日提醒卡，不能据此宣称主动提醒闭环已通过 |
| `NTF-06` | 商机停滞风险提醒 | 验收准备度和只读结果，不强启投递 | `Partial` | 历史跟进草案可见逾期任务风险，但没有当前版本的停滞商机主动提醒卡；投递链仍有治理前置条件，保持只读验收 |
| `NTF-07` | 未知投递对账 | 管理员可查看并人工裁决 | `Blocked` | 当前组织没有真实 admin 角色 |

## 6. Web 工作台

| ID | 路由 / 页面 | 预期结果 | 状态 | UI 证据 / 问题 |
| --- | --- | --- | --- | --- |
| `WEB-01` | `/` 首页 | 工作台概览和导航可用 | `Blocked` | 未登录门禁已通过，但当前没有长期用户凭据与稳定 HTTPS OAuth 回调入口，无法进入业务工作台。唯一解锁：提供稳定公网 origin 并登记回调后重新授权 |
| `WEB-02` | `/daily-report` 个人日报 | 日期、指标、明细和来源状态正确 | `Blocked` | 历史“查看完整日报”指向已失效 Tunnelmole 域名，页面显示 `No matching tunnelmole domain`；需稳定公网域名或恢复已备案域名 |
| `WEB-03` | `/stale-opportunity-readiness` | 停滞商机治理和提醒准备度可读 | `Blocked` | 稳定 HTTPS OAuth 入口与有效 Web Session 缺失；只能验证未登录门禁，不能读取业务内容 |
| `WEB-04` | `/customers` 客户组合 | 本人客户、摘要和详情入口正确 | `Blocked` | 稳定 HTTPS OAuth 入口与有效 Web Session 缺失 |
| `WEB-05` | `/customers/:id/briefing` | 拜访目标、问题、风险和来源正确 | `Blocked` | 稳定 HTTPS OAuth 入口与有效 Web Session 缺失 |
| `WEB-06` | `/customers/:id/communication` | 沟通目标、事实角度、问题与草稿正确 | `Blocked` | 稳定 HTTPS OAuth 入口与有效 Web Session 缺失；只读预览，不发送客户 |
| `WEB-07` | `/opportunities` 商机决策 | 排序、健康度、建议和来源链接正确 | `Blocked` | 稳定 HTTPS OAuth 入口与有效 Web Session 缺失 |
| `WEB-08` | `/followups` 跟进入口 | 当前页面能力与空态说明正确 | `Blocked` | 稳定 HTTPS OAuth 入口与有效 Web Session 缺失 |
| `WEB-09` | `/followups/new` 新建跟进 | 表单、校验和保存前确认可用 | `Blocked` | 稳定 HTTPS OAuth 入口与有效 Web Session 缺失；未执行任何保存动作 |
| `WEB-10` | `/followups/:id/edit` 跟进编辑 | 版本、重算、任务候选和修订可用 | `Blocked` | 稳定 HTTPS OAuth 入口与有效 Web Session 缺失；历史临时公网链接已失效 |
| `WEB-11` | `/tasks` 任务履约 | 到期风险、承诺核对、来源与链接正确 | `Blocked` | 稳定 HTTPS OAuth 入口与有效 Web Session 缺失 |
| `WEB-12` | `/reviews/team` 团队复盘 | 主管团队范围、指标和建议正确 | `Blocked` | 需真实 manager/executive 角色 |
| `WEB-13` | `/reviews/opportunities` 团队商机决策 | 团队范围和负责人视角正确 | `Blocked` | 需真实 manager/executive 角色 |
| `WEB-14` | `/analytics` 经营分析 | 仅按当前已实现产品面验收 | `Blocked` | 稳定 HTTPS OAuth 入口与有效 Web Session 缺失 |
| `WEB-15` | `/playbooks` Playbook 优化 | 候选、状态和审核动作边界正确 | `Blocked` | 稳定 HTTPS OAuth 入口与有效 Web Session 缺失；即使登录后仍可能受 `playbook:review` 权限限制 |
| `WEB-16` | `/admin/notification-deliveries` | 对账列表、详情和裁决交互正确 | `Blocked` | 当前组织没有真实 admin 角色 |
| `WEB-17` | `/admin/members` 成员管理 | 如为说明页则按当前产品面验收 | `Blocked` | 稳定 HTTPS OAuth 入口与有效 Web Session 缺失；当前账号是否有对应管理权限无法由未登录页判断 |
| `WEB-18` | `/admin/audit` 审计 | 如为说明页则按当前产品面验收 | `Blocked` | 稳定 HTTPS OAuth 入口与有效 Web Session 缺失；当前账号是否有对应管理权限无法由未登录页判断 |
| `WEB-19` | 未知路由 | 展示 404 并可返回首页 | `Pass` | 首轮真实 UI 返回 Nest JSON 404；按 SDD/TDD 修复后显示“页面不存在 / 返回工作台”，未知 `/api/ui-uat-404` 仍返回 JSON 404 |

## 7. 横向交互与视觉

| ID | 检查项 | 状态 | UI 证据 / 问题 |
| --- | --- | --- | --- |
| `UX-01` | 页面加载态、空态、错误态 | `Partial` | 未登录态和未知路由错误态已验收；业务页面 loading/empty/error 仍需正向 Web 登录 |
| `UX-02` | 权限不足和未登录态 | `Partial` | 裸首页显示“请从飞书中的销策 Agent 入口打开工作台”；缺企业入口的 OAuth 请求返回“缺少企业入口信息”。角色权限态仍待 Web 正向登录 |
| `UX-03` | 桌面宽屏布局 | `Pending` |  |
| `UX-04` | 窄屏响应式布局 | `Partial` | 375×812 下未登录入口和中文 404 页面完整可读、无横向溢出；登录后的业务页面仍受稳定公网入口阻塞 |
| `UX-05` | 卡片/页面查看链接 | `Partial` | 当前跟进成功卡的 Base/Task 链接通过；历史日报 Web 链接因临时域名失效而失败 |
| `UX-06` | 用户动作过程可感知 | `Pending` | loading、执行中、成功或失败 |
| `UX-07` | 用户可回退、结果可编辑 | `Pending` | 取消、返回、编辑、失败恢复 |

## 8. 本轮问题与修复

执行中发现的问题先记录复现证据，再链接到 `docs/issue-log.md` 和相应 SDD/TDD。没有直接 UI
证据的项目不得升级为 `Pass`。

### `ISS-UI-004` 历史 Web 查看链接依赖临时公网域名

- 复现：在“销售agent”单聊打开 2026-10-12 日报卡的“查看完整日报”。
- 结果：新标签进入
  `https://djorw5-ip-183-23-144-230.tunnelmole.net/daily-report?date=2026-10-12`，页面显示
  `No matching tunnelmole domain`。
- 范围：飞书日报卡仍可阅读；Base/Task 原生链接不受影响；所有指向临时 Web 公网域名的历史
  卡片链接不可长期依赖。
- 尝试：项目当前配置的已备案 Serveo 域名返回 `502`；恢复同名子域要求先注册 SSH 公钥。
  随机新域名会要求修改飞书 OAuth 回调，与本轮“不修改应用配置”边界冲突，已关闭未使用隧道。
- 状态：`Open / blocked on stable public origin`。
- 唯一解锁输入：提供一个能长期指向该 Agent 服务、并已加入飞书 OAuth 回调白名单的稳定 HTTPS
  域名；或明确授权单独变更回调地址后再执行临时域名验收。

### 当前证据文件

- `docs/evidence/ui-acceptance-2026-10-16/feishu-sales-agent-chat-before-test.png`
- `docs/evidence/ui-acceptance-2026-10-16/feishu-report-cards-history.png`
- `docs/evidence/ui-acceptance-2026-10-16/expired-daily-report-link.png`
- `docs/evidence/ui-acceptance-2026-10-16/base-followup-record-current.png`
- `docs/evidence/ui-acceptance-2026-10-16/task-detail-current.png`
- `docs/evidence/ui-acceptance-2026-10-16/web-not-found-fixed.png`
- `docs/evidence/ui-acceptance-2026-10-16/web-login-narrow.png`
- `docs/evidence/ui-acceptance-2026-10-16/web-not-found-narrow.png`

### 最新运行态只读预检（2026-10-16 14:51 后）

- 飞书消息页保持本人登录态，“销售agent”会话可进入，输入区可用。
- 当前视口可见 `UI最终-EXISTING-R3-20261016`、`UI最终-EXISTING-R4-20261016` 和
  `UI最终-CREATE-R1-20261016` 的成功卡、查看跟进链接、任务链接及“编辑跟进”按钮。
- Base“销售 Agent P0 Demo / 跟进”真实界面显示 17 条记录，并展示跟进标题、来源消息 ID、
  关联客户、关联商机和跟进原文列；本次仅查看，没有新增、修改或删除记录。
- 向上加载真实聊天历史后，可见一张带事实依据、缺口、风险、建议、上下文、整表字段和任务预览
  的旧版草案，以及两张日报、两张团队周报。日报/周报均直接显示 5 个逾期任务；聊天中同时存在
  “每日日报和周报，为什么没有按时推送”的反馈，因此内容可见与调度准时性分开验收。
- 这些证据用于确认当前 UI 基线可达；自然问答、新草案、重复点击、执行中与编辑恢复仍需
  外发/写入动作确认后执行，不由历史卡片推断通过。

### `ISS-UI-005` 未知页面返回原始服务端 JSON

- 复现：浏览器直接打开 `/ui-uat-404`，首轮显示 NestJS JSON 404。
- Red：新增 `agent-web-spa-fallback.spec.ts`，因 fallback 模块不存在得到预期失败。
- 第一次 Green：纯规则单测 `11/11` 通过，但 middleware 注册在 `app.init()` 之后，真实 UI 仍失败；
  Nest 内置 404 已先结束请求。
- 修复：fallback 改为在静态资源之后、Nest 路由初始化之前注册，并严格排除 `/api`、
  `/webhooks`、`/internal`、带扩展名资源、非 GET 和非 HTML 请求。
- UI 复测：未知页面显示中文 404 和“返回工作台”；未知 `/api/ui-uat-404` 继续返回 JSON 404。
- 状态：`Resolved / automated green / UI Verified`。

## 9. 当前阻塞审计

截至本轮只读 UI、控制库和文档核对完成，矩阵状态为：`Pass 2`、`Pass (reused) 3`、
`Pending 9`、`Partial 8`、`Fail / fix automated green / UI retest pending 1`、`Blocked 22`。

- 9 个 Pending 均为机器人当前版本交互：自然问答、知识问答、多轮承接、文本草案、执行中、
  唯一终态、商机生命周期和重复点击。它们都需要向本人“销售agent”发送测试消息，部分随后会
  点击卡片并写入 Base/Task；缺少动作时确认不能继续。
- 8 个 Partial 中，质检/校验、日报/周报当前版本、任务/商机主动提醒均需外发消息或一次性通知
  触发；正式 cron 仍不得启用。
- `BOT-14` 已代码修复且自动化全绿，但真实编辑复测需要恢复历史测试卡或新建一条成功卡，并
  点击会修订 Base/Task 的确认动作。
- 22 个 Blocked 由三类外部条件造成：稳定 HTTPS OAuth 回调和本人重新授权；本人可读妙记、
  Wiki→Docx 样本；真实 manager/executive/admin/第二企业账号。当前本人无长期 OAuth 凭据；
  三个 Docx 样本已确认本人可读。

当前唯一可立即解锁机器人验收的输入是：
`确认发送全量 UI 测试消息并创建上述测试数据`。

正向 Web、妙记和文档录入的共同解锁输入是：提供长期有效、已登记为飞书 OAuth 回调的 HTTPS
公网 origin，并由当前本人重新授权。妙记和 Wiki 场景随后还分别需要一条本人可读妙记链接与
一条本人可读 Wiki→Docx 链接；角色场景需要相应真实账号。

