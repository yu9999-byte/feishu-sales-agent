# 需求追踪矩阵

TASK-008/009：第 8 项的可信历史覆盖证明门禁与无任务承诺独立凭证账本已按 [SDD/TDD 53](53-task-history-promise-evidence-sdd.md) 完成本地实现、单元/组件、隔离 PostgreSQL/HTTP 和桌面/窄屏合成验证。本人声明与自动任务完成分别展示；真实完整历史来源和有效身份 UAT 仍待外部条件，未新增真实业务写入。证据见[验证归档](../evidence/task-promise-evidence-20261020/verification.md)。

`BPA-007` / PLAYBOOK-REVIEW：最新版本提交、管理员批准/退回、旧版失效、不可变记录、双 CAS 和幂等恢复已完成本地实现；全量单元、隔离 PostgreSQL/HTTP、类型、Lint 和双构建通过。审核快照已补冻结来源，新增 2 项先红后绿、面板/工作区 23 项回归通过；1280px/390px 独立审核面板合成截图及布局检查完成，原始审核 Red 日志已归档。真实身份、真实路由及工作区弹窗 UAT 仍待完成；审核通过不等于发布。见 [SDD/TDD 52](52-playbook-review-sdd.md) 和[验证记录](../evidence/playbook-review-20261020/verification.md)。

PLAYBOOK-DRAFT：已接受候选的创建/编辑/历史、租户隔离、可信作者、CAS、幂等重试及失败恢复已实现，自动化和合成组件验证通过；真实登录 UAT 待补。执行与测试见 [SDD/TDD 51](51-playbook-authoring-sdd.md)；发布/采用/样本不计入完成。

2026-10-20 待办执行：用户要求规划并完成剩余事项，执行入口见 [本轮计划](../remaining-capabilities-execution-2026-10-20.md)。RUNTIME-HEALTH 先补存活/就绪分离、有界且脱敏的控制库/迁移检查与启动等待，见 [SDD 50](50-agent-runtime-health-sdd.md)。真实飞书额度、外部依赖和登录 UAT 继续独立标记，不将自动化通过等同全部待办完成。

PREP-TEST-TYPES（2026-10-20，已完成）：覆盖回归先红复现 124 个 spec 被继承 exclude 排除；修复解析/覆盖及实际夹具后，136 个测试源文件全部入选、遗漏为 0。`type:check:test`、全量单元 124 文件/1052 项、本轮 22 个测试/夹具与 3 个配置 ESLint 通过。历史空覆盖成功不计作测试类型证据，生产契约未降低。见 [证据归档](../evidence/preparation-content-20261020/verification.md) 及 SDD 49。

PREP-WEB-ENTRY（2026-10-20，已实现）：真实 Vite HTTP 先 4 失败/12 通过，修复后 16/16；覆盖根路径、参数、结果深链、原入口及排除路径/方法。内置浏览器深链刷新到达身份提示并留证；真实身份结果未验收。

PREP-CONTENT 验收补充（2026-10-20，已验证）：生命周期显示先 2 失败/16 通过，修复后 18/18；active/unknown 空 health 为待核实，won/lost/closed 为历史。桌面/移动测试内容预览留证，真实身份验收另列。

## PREP-CONTENT 准备包完整上下文（2026-10-20，自动化已验证）

要求：新快照及 Web 展示客户近况、商机风险/缺口、最近跟进和具体议程，保存决策证据，区分事实和建议；partial 保留覆盖告警，empty/unavailable 无内容泄漏，旧快照明确历史缺失且不重算。先失败测试，再实现并验证 JSONB 往返、三套类型/Lint/双构建。设计及 Todo 见 [SDD 49](49-customer-preparation-chat-sdd.md)。

当前证据：本轮全量单元 124 文件/1052 项、测试类型及目标测试/配置 ESLint 通过；同日前序隔离 PostgreSQL 集成 55 通过/3 跳过，准备集成 10 项，服务端/客户端类型、目标生产 ESLint 及双构建通过。本轮未重跑集成/双构建。截图仅含合成组件样例和未登录入口，不能代替真实身份验收；遗留后端当前数据库连接拒绝，运行环境恢复另列 Todo。详见证据归档。

## PREP-DELIVERY 准备结果投递恢复（In progress，2026-10-19）

增量：本人投递状态查询已实现，登录/成员/四读取权限/当前客户范围通过后才能读取账本；无账本为 not_recorded，查询零发送及状态变更。新增 10 控制器用例先红后绿，相关 37 单元、8 PostgreSQL 集成及类型/Lint/Agent 构建通过。后续 unknown -> sent 人工核查 API 已实现，核查 UI 与完整恢复验收仍未完成。

Web 状态页通过 7 项页面测试验证五类状态、报告/状态失败隔离及只读刷新；transport 契约 5 项通过。全量单元 1008/1008、客户端/测试类型、目标 ESLint、Agent/Web 构建通过。真实身份 UI 尚未验收。

已实现结果/投递账本原子保存、冻结首次正文及原聊天、并发领取令牌、sent/unknown 禁重发与原子审计；工作流首次投递已接入。本人状态查询、权限重验及 unknown -> sent 人工核查 API 已实现，Web 结果页只读展示各状态；仍缺人工核查 UI、完整恢复验收与真实身份 UI，不得将此项标为完整重试恢复通过。下一步见 [SDD 49](49-customer-preparation-chat-sdd.md)。

## PREP-001..006 客户准备包统一入口

Goal v1 已确认；[SDD 49](49-customer-preparation-chat-sdd.md) 定义请求解析、本人客户/同名澄清、独立持久多轮、可信组合、聊天和 Web 接入。状态 In progress，真实消息额度耗尽仅阻塞对应 UI，自动化与本地实现继续。

### PREP-005 意图切换增量（2026-10-20）

需求：活动准备会话中的消息继续走统一意图模型；准备/歧义/低置信度承接原上下文，高置信度其他意图关闭当前会话并将同一消息路由一次。分类失败保留会话，revision 冲突不得关闭并发更新后的条件。取消保持确定性处理，分流不授权业务写入或外发消息。

证据状态：已实现。活动准备会话先经统一意图分类；准备/歧义/低置信度承接上下文，高置信度其他意图关闭当前会话并复用分类结果，避免重复分类。分类失败保留状态；revision CAS 冲突不路由旧结果。路由专项 5/5、完整工作流 100/100、准备会话 PostgreSQL 集成 8/8、服务端/测试类型、目标 ESLint、Agent 构建通过。真实飞书聊天 UI 尚未验收；本项自动化实现完成，不代表 Goal v1 完成。

### PREP-005 并发重复消息增量（2026-10-20）

同一租户/消息 ID 的失败路径与结果投递路径改为并发重投。失败场景确认条件提取和准备编排至多一次并保留已解析条件、客户/任务零写入；sent 与 unknown 场景确认结果完成、投递结束和稳定结果通知至多一次，unknown 不因重复入站自动重发。此前 AgentWorkflowService 100/100、测试类型和目标 ESLint 通过。本轮两个独立 PostgreSQL 连接池/store 并发 `claimMessage` 实际通过，确认单租户仅一方成功、仅一条领取记录，相同消息 ID 在另一租户独立领取；准备会话集成 9/9、全部集成 54 项通过，3 项未开启的真实知识问答探针跳过。隔离 UTF8 集群已正常停止并保留数据及日志。本轮未重跑全量单元/类型/Lint/构建，真实飞书 UI 仍待完成。

### PREP-006 草稿编辑与复制组件回归（2026-10-20）

新增 React DOM 测试 3 项，确认邮件主题和正文编辑后复制使用编辑值、飞书消息复制编辑后的正文、剪贴板异常时显示失败状态且不谎报成功。准备包相关 9 个测试文件 67/67、测试 TypeScript 检查通过。当前编辑仍仅保存在页面状态，持久保存控件、409/失败恢复和真实身份 UI 尚未完成。

## 2026-10-19 剩余能力执行入口

最新盘点与优先级见 [剩余能力计划](../remaining-capabilities-plan-2026-10-19.md)。旧条目中的“四操作路由、原卡结果、到期调度待实现”已被后续实现覆盖；当前缺的是对应真实验收或稳定运行证明。按 P0 闭环验收、P1 稳定运行准备、P2 扩展能力推进。消息及业务额度已满，继续本地/只读工作，不新增外部写入。

## 到期提醒结果名称（2026-10-19）

到期稍后提醒使用简短按钮标签，结果不能显示“标记已处理：稍后提醒”。仅当通知 subjectKey 精确等于事项 ID 且只有一个事项范围时，使用冻结通知首个 section 的事项标题；其他通知沿用原标签后缀剥离，不猜测跨事项名称。回调、状态版本、投递键不变，先以真实 reminder planner 产物建立失败测试，再修复。跨日失效版本不迁移提醒，真实发送与业务写入额度不增加。

## 今日行动建议证据边界（2026-10-18）

商机建议动作与建议日期必须有非空且全部可解析的本商机 evidenceIds，不能只校验提醒原因的证据。建议引用为空或缺失时，保留有证据的提醒原因，建议降级为“核实并补充商机信息”，时间使用本次参考日；来源覆盖标记 partial 并提示建议未采用。不新增 Agent、外部写入或权限；不扩大来源读取范围。先补无引用、部分缺失与完整有效建议测试，再实现并验证。五类真实样本和聊天验收缺口仍独立保留。

## 聊天行动结果文案纠正（2026-10-18）

真实稍后提醒回显误用了同一事项第一个快捷按钮的标签，出现“标记已处理：稍后提醒”。结果应只展示事项名称和持久化实际状态，剥离已知操作后缀；保留名称内部标点和未识别标签，不改变回调参数、归属、版本、幂等键或其他事项入口。先以四种按钮顺序与名称含分隔符的失败用例验证，再修复并运行相关测试、类型/Lint/构建。真实卡片更新仍受现有授权额度约束，不为纯展示修复新增发送。

## 今日行动限定验收发送设计（2026-10-18）

新增独立手动入口，默认仅预览，显式send才投递；不调用整批run、不启用或改变定时配置。必须同时匹配现有租户/成员/收件人白名单、有效本人会话及customer/opportunity/task读取权限，且会话tenant/member/openId与白名单一致。按明确的1至2个事项ID从本人实时报告中选取，每项标题必须含完整TCL-UAT-YYYYMMDD标记，任何缺失、重复、非open或标记不符整批拒绝。只读取选中事项控制状态，不将历史事项、来源告警原文或其他报表纳入卡片。

复用今日行动卡片四操作、首次payload冻结、投递审计/重试/unknown保护；手动请求以稳定runKey和范围摘要绑定通知键，不用时间戳制造新键。预览返回将发送的卡片，发送最多一张；相同runKey始终占用同一投递槽；重试只使用账本冻结的首次payload，已发送或unknown不重新投递。不写Base/Task，不绕过卡片归属核验。真实场景仅使用剩余4条消息额度，业务额度2跟进/3任务不增加。

TDD覆盖：默认预览零投递；精确过滤且不泄漏历史；空/重复/缺失/非测试/非open拒绝；跨租户/成员/收件人、缺权拒绝；每次最多一张且键稳定；复用现有delivery的重复与unknown集成覆盖。完成后运行单元/集成/类型/Lint/双构建及真实卡片验收，缺样本单独阻塞。

状态：`Approved / Goal v3 aligned / S12 automated Green / UI Verified 2026-10-16`

2026-10-16 Goal v1 最新运行态只读预检：Agent PID `40400` 已在 `3100` 提供首页并连接飞书
长连接；本人真实飞书登录态、“销售agent”单聊、输入区和 Base“跟进”表均可达。真实聊天仍
可见 none / existing / create 三条历史成功路径，以及旧版质检表单、两张日报和两张团队周报；
Base 界面显示 17 条跟进及客户/商机关联字段。日报/周报均提示 5 个逾期任务，但聊天中存在
“为什么没有按时推送”的反馈，故历史内容可见不等于当前调度准时。旧质检卡存在重复风险文案，
当前版本需新草案复测。以上全部为只读 UI 证据；自然问答、新跟进、确认执行、重复点击、编辑恢复
和当前主动通知仍待本人外发/写入动作确认，不能由历史卡片升级为当前版本 UI Verified。

2026-10-16 输入与 Web UI 前置条件复核：当前 active 企业仅本人 1 名 active 成员，但控制库没有
对应 `feishu_user_credentials`，因此妙记、Docx/Wiki 输入和所有正向 Web 业务页面均明确记为
Blocked，而非继续保留 Pending。租户已有 3 个 Docx 白名单来源，已逐一从真实飞书 UI 打开并
确认本人可读；Docx 样本本身已满足，唯一共同阻塞是稳定 HTTPS OAuth 回调与本人重新授权。
妙记另缺本人可读样本，Wiki 另缺 Wiki→Docx 样本。未登录门禁、404 和窄屏证据不替代登录后的
业务内容、权限、加载态、空态或错误态验收。

2026-10-16 `EXE-007`、`EXE-010`、`BOT-14` 成功卡编辑恢复已完成自动化 Green：真实飞书 UI
首次点击“编辑跟进”后卡片未变化，但后台已把卡片归属迁给不可见修订动作。根因是换卡错误使用
普通消息 patch，且失败后没有回滚。现已改用 callback token 专用更新接口，失败时原子恢复原
动作、取消修订、记录失败审计并返回可重试结果卡；成功时记录成功审计。定向 `114/114`、全量
单元 `734/734`、PostgreSQL `33 passed / 3 controlled skips`，三套 TypeScript、全库 ESLint、
Agent/Web build 和差异检查通过。当前状态为 `Resolved in code / Automated Green / UI retest
pending`；不得以自动化证据代替同一卡变为预填表单、修订原 Base 记录且不重复创建的真实 UI
复测。

2026-10-16 全量 UI 验收增量：真实浏览器逐页打开全部 18 个现有 Web 路由，未登录时统一进入
企业入口门禁且不泄露业务内容。未知页面首轮返回 NestJS JSON 404，现已按 SDD/TDD 新增严格
SPA fallback：只接管 GET + HTML 页面导航，排除 `/api`、`/webhooks`、`/internal`、静态资源、
非 GET 和非 HTML 请求。Red 按预期失败；定向 Green `1 file / 11 tests`、服务端/测试
TypeScript、相关 ESLint、Agent/Web 构建通过。真实 UI 复测显示“页面不存在 / 返回工作台”，
未知 API 继续返回 JSON 404。状态：`ISS-UI-005 / Resolved / UI Verified`。其余 Web 正向页面仍
受稳定公网 OAuth 入口缺失阻塞，不以未登录路由检查替代业务内容验收。

2026-10-16 `FUP-012..020` 客户—商机—跟进关系重构已进入自动化 Green：跟进始终关联客户，
商机可选；确认卡在同一表单提供暂不关联、关联已有和创建新商机三种模式。无明确商机名默认
不关联，唯一精确匹配可预选已有商机，只有销售提交创建模式才新增商机；系统不再创建
“客户名 - 销售机会”占位记录。已有商机 ID 必须来自当前客户授权上下文，伪造 ID 在任何业务
写入前拒绝；修订为不关联会清空旧链接。Card 以 `keep_current` 保护未操作默认值，Pending Action
解析已补无损往返回归。定向 `3 files / 123 tests`、新增关联定向 `2 files / 38 tests`、全量 Agent
`83 files / 721 tests`、PostgreSQL `32 passed / 3 controlled probes skipped`，三套 TypeScript、
ESLint、Agent/Web 构建和差异检查通过。历史只读盘点完整读取商机 5 条、跟进 8 条、客户 5 条，
仅发现“华南科技 - 销售机会”1 条候选；因关联 3 条跟进且含线上演示、发送报价等保留证据，
结论为待确认、暂时保留，盘点全程零写入。真实飞书 none/existing/create 三路径、唯一成功卡、
Base 关系和 Task v2 均已验收，状态为 `Implemented / Automated Green / UI Verified`；未经逐条
确认仍不修改历史业务数据。

2026-10-07 `KNO-001..009` 销售资料检索与推荐 Agent v1 已实现：沟通准备页只从当前租户
`base_mapping.knowledge.sources` 白名单读取单篇 Docx 或单个 Wiki 文档节点，并在排序前同时
验证管理员授权和当前销售本人 ACL。推荐包含真实标题、类型、链接、命中理由、原文摘录、段落、
版本和适用边界；无配置和无可信命中均诚实显示，不发送或写入任何业务数据。当前控制库为
1 个 active 租户、3 个 Docx 来源；应用仅有 `view`，销售直接 ACL 精确匹配。真实生产 Gateway
配置/检查/可信结果 `3/3`、无 warning，返回真实摘录、`revision:3` 和
`accessVerified=true`。Gateway `13/13`、资料与沟通准备 `50/50`、跨层 `89/89`、Agent
`570/570`、Postgres `20/20` 及完整质量门通过；UI 按用户要求保持 pending。

2026-10-07 `COP-023..029` 客户沟通内容准备 Agent v1 已实现：销售从拜访攻略进入
`/customers/:customerRecordId/communication`，查看沟通目标、推荐角度、重点问题、材料待补充
清单、飞书消息和邮件草稿及来源。内容复用本人范围的客户攻略；资料检索无可信命中时不生成
虚构文件、链接、案例或报价。专项 `17/17`、Agent `533/533`、Postgres `20/20` 和完整质量门/启动冒烟
通过。页面只预览、临时编辑和复制，不发送、不保存修改、不建任务、不写业务数据；真实销售
登录态视觉验收按用户要求暂缓，状态为 UI pending。

2026-10-07 `COP-017..022` 客户洞察与拜访准备 Agent v1 已实现：销售从 `/customers`
选择本人可见客户并进入 `/customers/:customerRecordId/briefing`，查看客户概况、显式关联商机、
最近 10 条跟进、风险、待确认问题和三段式议程。API 同时要求客户、商机和跟进读取权限，
只按当前登录销售 `open_id` 读取；同名文本不关联，有冲突客户链接的跟进不会被商机链接覆盖。
定向 `17/17`、Agent `516/516`、Postgres `20/20` 和完整质量门/启动冒烟通过。功能完全只读，
不联系客户、不创建任务、不修改业务记录；未做真实登录态视觉验收，状态为 UI pending。

2026-10-07 `COP-012..016` 主管团队客户与商机决策 Agent v1 已实现：manager 只聚合本人和
递归下属，executive/admin 聚合租户全部 active 成员；复用每名销售的本人商机事实和确定性排序，
输出团队排名、负责人、风险、建议管理动作和成员组合。新 API
`GET /api/platform/team-opportunity-decisions` 同时要求 `review:read-team` 与
`opportunity:read`；`/reviews/opportunities` 已覆盖 loading、error、empty、partial 和
unavailable。建议只读未执行，本轮不做真实 UI、不发消息、不写业务数据。

2026-10-06 `COP-001..011` 客户与商机决策 Agent v1 已从 Draft 进入自动化 Green：按当前销售
本人范围分页读取客户、商机和历史跟进，复用只读任务履约证据，只对进行中/状态待确认商机
输出风险优先级、缺口、依据和下一步建议；关闭类商机排除，普通任务不按标题猜测关联。
机器人 `business_query` / `project_diagnosis` 与
`GET /api/platform/opportunity-decisions` 均已接入真实服务；`/opportunities` 已提供主从决策面，
`/customers` 已提供客户组合摘要。客户汇总保留无进行中商机客户，未知金额保持
`null`，无明确客户关联的商机不按标题猜绑。本轮没有 UI 验收、真实消息或业务写入；
完整 CRM 客户 360 和主管团队组合决策仍未完成。

2026-10-03 飞书机器人成员入口已补齐第一道准入门：在消息和卡片动作解析出租户后，
`PlatformSessionService.getActiveMember` 只允许活跃租户中的活跃成员继续进入模型调用、
上下文读取、草稿生成、消息领取或确认执行。未知成员、停用成员和成员查询异常均 fail closed；
无效消息不领取也不回复，无效卡片保持原待确认动作且不触发业务写入，并记录相应审计事件。
聚焦测试 `74/74`、全量 Agent `310/310`、三套 TypeScript、ESLint、统一 Lint、Stylelint、
Agent/Web 构建和 `git diff --check` 通过。本轮未使用真实飞书消息或 UI；真实平台角色映射尚未
配置，不能把成员门禁表述为销售、主管或管理员角色授权。

2026-10-03 任务履约切片的本地数据库验证已补齐：项目自带 Postgres 在
`127.0.0.1:55432` 启动，迁移 014/015 成功应用，3 个 Postgres 集成测试文件共 `12/12`
通过；该证据不替代真实飞书/Web UI 验收，UI 仍保持 `UI pending`。

2026-10-03 任务履约已完成范围接入与证据加固：任务网关按负责人分页读取
`is_completed=true` 的已完成任务，解析 ISO/秒/毫秒 `completed_at`，只有可解析且
大于 0 的时间作为完成证据；`"0"` 即使伴随冲突的完成状态也保持未完成。迁移 014、
快照前后完成时间、API 和 `/tasks` 展示已接入。完成任务覆盖明确为检索范围而非全量历史；
无精确任务 GUID 的承诺不推断兑现。定向 `35/35`、Agent `281/281`、本地 Postgres
迁移 003..015 与快照集成 `1/1`、三套 TypeScript、统一 Lint、Stylelint、Agent/Web 构建和
`git diff --check` 通过。本轮不做飞书 UI，因此状态仍为 `UI pending`。

同日任务状态事件账本已接入迁移 015、内存/Postgres 控制库和履约服务：记录
`observed`/`changed`/`completed`/`reopened`，只按租户、销售和精确任务 GUID 隔离读取。
事件账本只代表 Agent 观察证据，不是飞书全量历史；只有明确完成/重新开放事件可恢复历史判断，
不按标题、时间或列表缺失建立跨任务关系；较新的普通事件不会被旧的完成/重开事件覆盖。
API 现通过 `coverage.taskHistory` 显式标记 `agent_observations`、`unavailable`（未来可信
全量历史来源才可使用预留的 `full`），Web 页面同步展示该边界，避免调用方把观察账本误读为
全量历史。
本轮新增 `TaskGateway.readTaskHistory` 可信来源扩展口和完整性门禁：只有来源返回
`coverage=full` 且无警告时才允许 `full`，当前 FeishuTaskGateway 未实现该来源，故现网输出
保持不变。履约定向测试 `25/25` 通过。
本轮已接入飞书 SDK 的 `task.task.update_user_access_v2`。该接收器只记录订阅后可见事件的最小
回执元数据和 SHA-256 哈希，并以 `(tenantId, eventId)` 去重；不保存原始事件体、不二次读取任务、
不更新快照、不推断销售归属。它不能覆盖订阅前历史，也不能单独证明事件无丢失，因此不能改变
`full` 的门禁。
跨任务替代只接受当前租户、当前销售成功 Agent 动作结果中的成对
`relatedTaskGuid + relation: replaces`；缺字段、冲突、自替代、读取失败、跨租户、跨销售
均 fail closed，原任务可见时不被替代证据覆盖。
Agent 全量 `303/303`、Postgres `13/13`、服务端/
测试 TypeScript、ESLint、统一 Lint、Stylelint、Agent/Web 构建和 `git diff --check` 通过；
本轮不做飞书 UI，UI 仍 pending。

2026-09-30 最新运行态复核：Agent `260/260`、Postgres 集成 `11/11`，服务端/客户端/测试
TypeScript、ESLint、Agent/Web 构建通过；本地 Agent `72384` 在 `3100` 返回 `200`。由于
`WEB_PUBLIC_URL` 的 Tunnelmole 临时域名失效，飞书 OAuth 无法回调；Codex 内置浏览器随后虽恢复
标签控制，但目标会话和输入控件不可用，因此 S1、`REV-001` 和 `S4` 工作台的真实 UI 证据仍为
`UI pending / blocked`。本轮不以自动化结果替代 UI，不发布 GitHub milestone。

同日后续只读复核已恢复 Codex In-app Browser 标签控制，但标签实际为“消息 - 轮动”空白首页，
没有“销售agent”会话或输入框；搜索入口还触发 `dispatchSearchSetInputEvent not impl on web`。
因此 UI 阻塞原因更新为“目标会话/输入控件不可用”，不改变任何 `UI pending` 或 `blocked` 状态。

2026-09-29 产品方向确认：本项目建设为多 Agent、多场景销售助手。销售跟进、商机推进、
任务履约、商机停滞提醒、销售日报、团队 Review 和 Playbook 优化共享同一权限、上下文、
确认、执行和审计底座；本矩阵继续分别记录每个 Agent/场景的自动化与 UI 证据。详见
[多 Agent 销售助手产品方向](../decisions/2026-09-28-multi-agent-sales-assistant.md)。

项目规划总入口见[销售 Agent 项目主计划](../project-master-plan.md)，后续 Codex 执行模板见
[项目执行提示词](../project-operating-prompts.md)。本表是完成度唯一入口；主计划负责路线，
本表负责证据。

统一状态口径：`UI Verified`、`Automated Green / UI pending`、`Partial`、`Draft`。只有
自动化和 UI 两列都有当前版本的直接证据，才能标记为 `UI Verified`；历史版本证据必须注明
日期和场景，不能替代最新运行态复验。

2026-09-20 已确认原聊天卡内编辑、保存前内容质检、本人待办预览与一次确认，以及条件性
项目推进质检。以下既有自动化/Web 证据不覆盖这些新增场景；详见
[决策问答](../decisions/2026-09-20-followup-chat-cards.md)。

本表是完成度唯一入口。`自动化` 和 `UI` 两列都具备直接证据后，需求才能标记为完成。
对话入口与质检显示修正参见
[2026-09-20 决策](../decisions/2026-09-20-conversation-and-quality.md)，既有评分/UI 证据
是历史版本证据，不能冒充新卡片体验已经验收。

2026-09-23 新增 `FUP-010..011` 执行反馈与结果修订，详见
[执行反馈 SDD](09-action-execution-feedback-sdd.md)。在真实飞书中看到执行中并完成原记录
修订前，该增量只能标记为 implementing。

2026-09-23 复核补充：自然语言意图由 LangChain/LangGraph 主分类；`executing` 增加超时回收；
Web 确认后的待办候选跨版本幂等；Mem0 接入 `memory_save` 和 ACL 召回。飞书机器人角色权限
校验当时作为 P1 TODO；2026-10-03 已完成活跃成员入口门禁，但真实平台角色映射仍未配置，
因此角色授权继续受阻。Web OAuth state 会话绑定已补齐。

2026-09-24 代码复查将 OAuth 缺 Cookie、Web 失败动作跨版本重试、补充态 LLM 主路由和
LangGraph thread TTL 重新打开为整改项。现已按 [项目复查整改 SDD](13-project-hardening-sdd.md)
完成 Red/Green：22 个单测文件 168/168、Postgres 集成 8/8、三套类型检查、ESLint 和两端构建
通过；数据库迁移命令连续执行两次为 apply/skip。真实飞书 UI 仍须使用最新运行态复验。

2026-09-25 Goal v2 冻结产品口径：销售跟进 Agent 是唯一用户-facing 主线；主动任务跟进和
商机推进降级为内部触发/履约/洞察能力。新增 `CTX-001..012` 作为 P1-CTX 上下文读取切片；
首轮代码部分实现，细项见下表，真实 UI 和历史冲突数据评测仍待补。

2026-09-25 Goal v3 完成 `PRG-001..012` 自动化切片：本次沟通与唯一匹配商机的状态比较、
信息缺口、风险、下一步建议和待确认动作已进入飞书/Web 草案及版本存储。全量 Agent
`191/191`、Postgres 集成 `8/8`、三套 TypeScript、ESLint、Agent/Web 构建通过；真实 UI
尚未对账，因此保持 `UI pending`。

2026-09-26 真实飞书草案回归暴露富文本客户读取、模型商机提示、日期钟点和 Task 应用权限问题。
适配器和安全降级经 `203/203` Agent、`8/8` Postgres 集成、三套类型检查、ESLint、
Agent/Web 构建及真实来源只读重放验证；最新飞书卡片/UI 仍待验收。Task 应用权限缺失是
外部阻塞，不能把任务状态读取或 S4 主动提醒标为完成。

2026-09-26 S4 前置汇总能力新增 `StaleOpportunityContextService`，用 4 项单测锁定逐商机
最新可信沟通时间和无效记录跳过规则；与判定层合计 Agent `219/219` 通过。随后新增
`FeishuBaseGateway.readStaleOpportunityFollowupPage`：按本人负责人过滤、500 条游标分页、
跨页 token 和不完整分页 warning 均有单测；该能力仍是只读适配器，不能替代 Task 权限、扫描、
去重或提醒投递。

2026-09-26 Task 应用权限已开通并真实验证 `code=0`、5 条未完成任务、无 notice。新增默认关闭的
`StaleOpportunityScanService`，完整消费商机/跟进/Task 页并只输出候选与跳过原因；任一来源
不完整时整轮无候选。真实商机表没有独立生命周期状态字段，扫描会明确停止，禁止从“当前进展”
自由文本猜测；持久去重、调度和提醒仍未实现。全量 Agent `229/229`、Postgres 集成
`8/8`、三套类型检查、ESLint 和 Agent/Web 构建通过。

2026-09-26 后续切片已在真实商机表新增独立“商机状态”，配置进行中/已赢单/已丢单/已关闭
四类值并同步运行时租户映射。没有猜测回填 5 条历史商机；真实只读扫描结果 `complete`，
5 条均为 `unknown -> inactive`，候选、Task 查询和 warning 均为 0。新增安全跳过回归后
全量 Agent `230/230`、Postgres 集成 `8/8`、三套类型检查、ESLint 和 Agent/Web 构建通过；
持久去重、调度和提醒仍未实现。

2026-09-26 新增商机生命周期维护边界：用户确认后确实新建商机时，按租户配置初始化首个
active 值“进行中”；匹配已有商机时，更新请求不包含生命周期字段，避免覆盖历史空状态或
重新打开赢单/丢单/关闭商机。两条写入边界测试使全量 Agent 回归更新为 `232/232`；5 条既有
商机仍未分类，本轮没有写入真实业务记录。

2026-09-27 新增既有商机状态维护闭环：`opportunity_operation` 先读取本人商机并做唯一匹配，
目标状态明确后展示一次确认卡，确认才调用独立状态更新网关；未匹配、多匹配、目标不明确、
取消或重复确认均不写入。网关执行前校验当前销售和确认时旧状态，只提交生命周期字段并写后
回读，同时记录 `opportunity_status.pending_confirmation` 审计。真实只读清单确认 5 条本人
商机状态均为空；随后在受控商机“P0测试-销售系统采购”完成真实飞书确认，原卡显示“未设置 →
进行中”，Base 回读、无其他业务写入和完整审计链均已对账，因此该状态确认场景标记为
`UI Verified`。其余 4 条历史商机仍为空，没有批量回填。

2026-09-27 按 S1 重新执行当前版本质量门禁：Agent `239/239`、Postgres 集成 `8/8`、三套
TypeScript、ESLint、Agent/Web 构建和 `git diff --check` 均通过；Agent 运行态在 3100 端口
启动并建立飞书长连接。使用不接触用户桌面的隔离 Chromium 访问 Agent Web 返回 `200`，但
因没有已认证的飞书会话停在身份验证页；没有发送验收消息或修改业务数据，因此普通问答、
客户事实澄清、自然语言“帮我写跟进”、执行中/唯一终态/结果修订继续保持 `UI pending`。

2026-09-27 14:28 在等待认证期间完成第二次门禁复跑：Agent `239/239`、Postgres 集成 `8/8`、
三套 TypeScript、ESLint、Stylelint、Agent/Web 构建和 `git diff --check` 仍通过；GitHub
publisher dry-run 通过但未发布 milestone。隔离 Chromium 已能打开飞书扫码页，仍无认证会话，
故上述场景继续保持 `Automated Green / UI pending`，不以自动化结果替代真实 UI 证据。

2026-09-27 14:35 对 S1 待验收范围做定向回归：6 个关键测试文件 `94/94` 通过，覆盖意图路由、
普通/澄清/补充态、自然语言跟进、执行中反馈、失败恢复、唯一成功/失败终态和结果修订；这只
增强自动化证据，不改变 UI pending 状态。14:36 连续三轮认证复核仍停在飞书扫码页，S1 真实
UI 由 `pending` 明确标记为 `blocked`；唯一解锁动作是用户完成一次 Codex 隔离网页扫码。

2026-09-28 补充隔离回调端到端回放：通过 SDK EventDispatcher 的
`card.action.trigger` 进入真实 Bridge、Workflow、Executor 和 MemoryStore，覆盖确认回调、
执行中、同卡唯一成功/失败终态、失败重试、终态返回编辑及修订原跟进/任务。外部消息、Base
和 Task 网关全部为测试替身；全量 Agent `242/242`、Postgres `8/8`，类型、Lint 和构建
通过。此项状态为 `Isolated callback E2E Verified`，不改变真实 UI pending，
也不表示真实客户/商机/跟进/任务发生写入。

2026-09-28 按用户要求改为不依赖手工 UI 的 API E2E 复验：普通问答位置 97→98、客户事实澄清
位置 99→100、自然语言“帮我写跟进”输入卡位置 104→106、带沟通原文的草案位置 107→109 均已
在唯一“销售agent”私聊中成功完成。位置 101 首次复现 Card 2.0 输入长度超限导致的 400，已将
`communicationContent` 的 `max_length` 从 5000 修正为 1000，定向测试 `81/81`、服务端类型检查、
ESLint 和 Agent 构建通过。控制库回读确认两张最新卡均停在 `pendingConfirmation`，没有确认回调、
客户/商机/跟进/任务写入或执行审计；因此录入与草案生成标记为 `API E2E Verified / UI pending`，
执行中、成功/失败终态和结果修订标记为 `API E2E Partial / UI pending`。

| 需求范围 | 阶段 | 规格状态 | 自动化证据 | UI 证据 |
| --- | --- | --- | --- | --- |
| `SIA-000..000D` 对话入口、意图与安全路由 | B0 | Implemented / UI partial, clean-state retest pending | LangGraph 主分类覆盖普通态、澄清态和补充态；明确跟进命令确定性直达，24 小时 checkpoint TTL 具备保留/删除回归；进入 168 项全量回归 | WebSocket 已收到并完成两条真实私聊工作流；卡片内容与补充态仍待干净状态重放 |
| `PLT-001..006` 多租户、身份、授权、审计 | A | Implemented / automated green / UI pending | 独立 Agent 以自身 Postgres 为租户、成员、角色和策略事实源；机器人消息与卡片动作在租户解析后依次校验活跃成员和当前有效角色。未知、停用、无角色、成员查询故障和角色查询故障均 fail closed，在模型、上下文读取、草稿、领取和确认执行前停止，并写入分类审计。角色恢复后的同消息重试可继续处理。工作流 `66/66`、全量 Agent `314/314`、Postgres `13/13`、三套 TypeScript、Lint 和双构建通过 | 本轮未做机器人 UI 或运行态部署验收；此前 Web OAuth/页面权限证据不等同于机器人多账号授权。旧妙搭应用角色未接入目标运行时，仍需四类真实角色账号和第二真实企业验收 |
| `WEB-001..003` 页面授权、状态和飞书深链 | A | Implementing | OAuth 缺 state Cookie、不一致和重放均拒绝；Session/导航/页面 API 边界通过；深链签名尚未实现 | 桌面、390px 窄屏、角色导航及 forbidden 已通过；最新 OAuth 回归和卡片详情深链待验收 |
| `ING-001..002` 表单与文本输入 | B1 | Implementing / API E2E verified / UI pending | Web 创建 API、同键并发与租户归属通过；最新真实 API E2E 已验证普通“帮我写跟进”输入卡、带原文跟进草案和确认前无写入 | 本轮不要求手工 UI；视觉和按钮点击仍未声明 UI Verified，其他输入来源待验收 |
| `FUP-001..003` 提取、生成和证据 | B1 | Implemented / UI verified | 来源 quote、生成正文与版本通过；本次沟通方式/时间/主题、`nowLocal` 与显式 offset 契约已进入 126 项回归 | 真实飞书卡片已正确区分本次“飞书”与下一步“飞书会议”，时间为 `2026-09-21T10:15:00+08:00`，主题为“试点方案” |
| `FUP-004..006` 保存前可用性、卡内编辑和检查修改 | B2 | Implementing / regression fix | 阻断/建议分离、无数字等级、中文化去重，以及“检查修改只更新、确认保存携编辑值一次执行” Red/Green 均已进入 137 项回归 | 无评分主视觉和取消终态已验收；本次确认按钮修复待真实复测 |
| `ING-003` 语音输入 | B3 | Draft | 待飞书语音契约测试 | 待真实语音验收 |
| `ING-004` 妙记/会议输入 | B4 | Implemented / automated green / real source and UI pending | 当前销售 OAuth 密文存储/刷新、`minutes:minutes:readonly + offline_access`、妙记 URL 安全解析、Transcript 说话人/时间证据、120k 上限、LangGraph 意图路由、同聊天单草案、失败原地终态、重复消息幂等和确认前零 Base/Task 已实现；长期 OAuth Red/Green、OAuth 定向 `21/21`、Agent `705/705`、PostgreSQL `32 passed / 3 controlled probes skipped`、三套 TypeScript、统一 Lint 和双构建通过 | 当前销售需使用新授权 URL 重新 OAuth，并提供一条本人可读的真实妙记完成飞书 UI 验收 |
| `ING-005..007` 文档输入和失败恢复 | B5 | Implemented / automated green / real source and UI pending | Docx/Wiki 安全解析、当前销售 user OAuth、按场景资源 scope 与 `offline_access`、Wiki 仅解析到 Docx、`raw_content` 事实源、120k 可见截断、同聊天等待/失败终态、重复消息幂等、跨租户/成员隔离、混合来源拒绝、无标题回退和确认前零写入均已实现；长期 OAuth Red/Green、Agent `705/705` 和完整门禁见 `40-document-ingestion-sdd.md` | 当前销售使用新 URL 重新 OAuth 后，以本人可读 Docx 和 Wiki->Docx 在真实私聊验收；本轮尚未读取真实文档或发送消息 |
| `FUP-007..009` 写入、结果/项目质检卡、策略推送和幂等 | B6 | Implementing / regression fix | 三项 Base 后建任务、原卡唯一成功终态、原卡 patch 失败时补发、幂等、`followupRecordUrl` 持久化、成功卡记录链接，以及 `card.source_finalized`/补发 `card.result_sent` 审计均进入 137 项回归 | 历史双成功卡仅保留为 D-022 前的缺陷证据；本次唯一“跟进登记成功＋查看跟进记录”待真实复测 |
| `FUP-012..020` 客户必选、商机可选和历史泛化商机治理 | B6 / S12 | Implemented / automated Green / UI Verified | Red 稳定复现无商机仍 upsert；联合类型、Card 2.0 单表单、`keep_current` 默认值防护、条件执行、授权已有商机、Base 空关联、修订清空、伪造 ID 前置拒绝及 payload 无损往返均已实现。定向 `123/123`、新增关联定向 `38/38`、Agent `721/721`、PostgreSQL `32 passed / 3 controlled probes skipped` 和完整质量门通过；历史只读盘点只发现 1 条候选并因真实推进证据暂时保留，零写入 | 真实飞书 `UI最终-NONE-R3`、`UI最终-EXISTING-R4`、`UI最终-CREATE-R1` 三路径均通过；唯一成功卡、查看链接、Base 客户/商机/跟进关系和 Task v2 已对账。未经确认不改历史数据 |
| `FUP-010..011` 即时执行反馈、失败恢复和成功结果修订 | B6 | Isolated callback E2E Verified / real UI pending | 飞书 SDK 回调入口贯通真实 Bridge/Workflow/Executor/MemoryStore；测试替身验证同卡执行中、唯一成功/失败终态、重试及修订原跟进/任务；真实机器人 API E2E 仍只到待确认卡，无真实业务确认 | 本轮不要求手工 UI；真实飞书点击、业务写入和 Base/Task 回读仍待独立验收 |
| `TSK-001..006` 任务预览、一次确认、状态建议/回收和提醒 | B6 / P1-FULFILL | Partial overall / fulfillment v1 automated green / Web implemented / UI pending | 精确版本候选选择、空选择不建任务；`GET /api/platform/task-fulfillment` 和 `/tasks` 按本人范围及租户时区识别未完成任务风险，并按最终选中候选及精确 `taskGuid` 核对最近 180 天 Agent 成功执行的跟进承诺；另按负责人分页读取已完成任务，最多 10 页且仅计入有效 `completed_at`，覆盖范围标记为 `search_scope`/`partial`/`unavailable`；列表未命中时读取精确任务详情，控制库保存最新状态和有效完成时间快照与 `observed`/`changed`/`completed`/`reopened` 事件，输出已完成/部分完成/仍未完成/待核实及变更/重新开放证据；较新的普通事件不覆盖旧终态，`completed_at="0"` 与冲突状态不得误报完成；事件仅是 Agent 观察证据，不是全量历史，且不按标题/时间/列表缺失跨任务关联；跨任务替代仅接受成功 Agent 动作结果中成对的 `relatedTaskGuid + relation: replaces`，原任务可见时不覆盖，缺字段/冲突/读取失败/跨租户/跨销售均待核实；无任务、不可见、详情失败和分页不完整分开呈现，500 条历史上限警告；不发送提醒、不修改任务、不升级主管。Agent `299/299`、完整门禁通过；本地 Postgres 集成 `12/12` 通过 | 真实登录态内容、链接和视觉待验收；全量完成历史、无任务承接的兑现判断、状态更新、提醒与升级仍待闭环 |
| `CTX-001..012` 客户/商机/跟进/任务上下文读取、匹配与来源 | P1-CTX | Partial / UI pending | Base 富文本数组 Red/Green、本人范围商机回退、真实华南科技只读重放成功；Task 读取权限和真实本人范围已验证 | 原草案 UI 曾失败；最新卡片与 Web 多分支待验收 |
| `PRG-001..012` 本次进展、缺口、风险、建议与确认动作 | P1-PROGRESS | Automated Green / UI pending | 风险和行动建议在 Task 缺权限时保留；任务候选 fail-closed；编辑重算、Postgres 回读及旧草案兼容；201 项 Agent 测试和真实来源只读重放 | 最新飞书/Web 四层展示、编辑和确认边界仍待 UI 对账 |
| `S4-001` 商机 7 天未更新提醒 | P1 internal trigger | Partial / cron-ready dry-run green / ledger green / workbench UI pending / disabled / prerequisites open | 纯判定、本人商机/跟进/Task 全分页、数据治理、持久账本和专用令牌内部调用入口均有测试；发送前二次核验与账本的独立编排有假发送器测试。入口仍固定 dry-run，未知数据不推断、不创建伪造历史跟进；尚无真实 cron、运行时投递接线或本人提醒 | 配置但保持关闭的外部 cron；完成历史治理、受控运行时接线、本人通知和 `uncertain` 对账后再允许真实投递 |
| `S4-002` 持久提醒账本与安全投递门 | S4 internal ledger | Automated Green / runtime disabled | 迁移 011/012、9 项定向单测、3 项 Postgres 集成：同键并发唯一 claim、5 分钟租约、7 天冷却、新版本、失败重试及不确定结果停止自动重发；无真实发送器或调度绑定 | 发送前重读最新状态/负责人/时间与任务完整性，受控本人通知及 `uncertain` 人工对账后再验收 |
| `S4-004` 外部调度只读入口 | S4 internal trigger | Automated Green / cron-ready dry-run / default disabled | `POST /internal/stale-opportunity-scan/run` 使用独立 Bearer 令牌；错误令牌在数据读取前拒绝。Agent Postgres 活跃集成枚举、成员/角色/权限重验、跨租户隔离、成员失败整批候选压制和重复只读调用均有测试；全量 Agent `323/323`、Postgres `14/14` 和完整质量门通过；未接提醒账本、消息或业务写入 | 部署外部 cron 与密钥管理但保持关闭；完成真实数据治理和投递门后再接 S4-002 |
| `S4-006` 未知投递只读对账 | S4 reconciliation | Automated Green / runtime disabled | 账本只读查询 uncertain 状态，支持租户过滤、限制和最小证据；数据源异常或参数无效返回空结果与 warning，不改变状态、不重试 | 受控人工运营入口和真实飞书消息核对；人工恢复动作需另行确认和审计 |
| `S4-007` 提醒投递运行时安全门 | S4 runtime gate | Automated Green / runtime disabled | `StaleOpportunityReminderRuntimeService` 默认关闭时零业务读取；开启后检查扫描开关、专用令牌、历史治理标记、sender 配置和 uncertain 对账，静态条件或未知投递存在时阻断；6 项定向单测通过；无 cron、真实 sender 或消息 | 将安全门接入受控扫描/投递运行时；前置标记必须由人工证据支撑，继续保持真实投递关闭 |
| `S4-008` 提醒运行前检查接口 | S4 runtime preflight | Automated Green / runtime disabled | `GET /internal/stale-opportunity-reminder/preflight` 使用专用 Bearer 凭证；认证失败不调用安全门，认证成功只返回 `disabled`/`blocked`/`ready`；无商机扫描、账本领取、sender 或 cron；接口与模块装配定向测试通过 | 未来由受控调度器读取运行状态；不把 preflight 结果当作真实投递或历史治理证据 |
| `S4-009` 只读提醒计划入口 | S4 runtime planning | Automated Green / plan-only / runtime disabled | `POST /internal/stale-opportunity-reminder/plan` 按 preflight -> dry-run -> plan-only 顺序执行；非 ready 时零扫描，扫描不完整或异常时空计划；完整候选保留租户、成员、商机、负责人、跟进、可信时间和版本证据；认证、服务、控制器和模块装配测试通过；全量 Agent `368/368`、Postgres `15/15` 及完整质量门通过 | 尚未领取账本、执行发送前二次核验、调用 sender、发送消息或部署 cron；历史治理、受控投递和 uncertain 人工对账完成前保持关闭 |
| `S4-010` 计划到持久账本的批次执行链 | S4 offline execution | Automated Green / offline only / runtime disabled | ready 计划逐条进入发送前二次重扫和持久账本；重复候选、来源不明、证据/负责人异常、未知投递和执行异常均 fail closed 并停止批次；10 项批次单测和 Postgres + 假 sender 完整链集成通过；全量 Agent `378/378`、Postgres `15/15` 及完整质量门通过 | 未注册 Nest、无 HTTP 执行入口、无真实 sender、无 cron；假消息 ID 不代表真实飞书投递，完成 sender 契约、历史治理、人工对账和受控验收前保持关闭 |
| `S4-011` 飞书本人提醒适配器 | S4 delivery adapter | Automated Green / fake SDK only / runtime disabled | 按租户重新解析有效飞书集成，以 bot 身份向当前负责人 `open_id` 发送静态文本；租户/提醒类型/商机/跟进版本生成稳定幂等键；明确拒绝进入安全重试，网络中断或空消息 ID 进入 unknown 并停止重发；适配器及跨层账本 `7/7`、定向 `15/15`、全量 Agent `385/385` 通过 | 未注册 Nest 或执行入口，无 cron、真实消息或消息回读；需先完成 uncertain 人工对账、历史治理和受控测试租户验收 |
| `S4-012` 未知投递人工对账与恢复 | S4 reconciliation recovery | Automated Green / manual API / real delivery disabled | 管理员 Web 会话 + `admin:manage-policies` 保护列表与裁决；tenant/operator 服务端注入；支持确认已发送、未发送释放一次受控重试、继续冻结。`expectedUpdatedAt` 乐观并发，状态更新和独立审计单 SQL 原子提交，保留原 dispatch/failure 证据；跨租户和并发冲突零写入。迁移 017 幂等通过，单元/接口 `22/22`、S4 定向 `36/36`、全量 Agent `396/396`、完整 Postgres `19/19`、Lint、三套类型检查、diff 检查及 Agent/Web 构建通过 | 无自动飞书消息查询、sender/执行链注册、cron、真实消息或 UI；milestone 待本轮收尾，历史治理和受控本人投递仍是开启条件 |
| `S4-013` 受控真实提醒执行入口 | S4 controlled delivery | Automated Green / real delivery disabled | 新增独立执行令牌和严格两字段请求；重新运行安全门/plan，唯一候选与测试租户、销售成员、本人 open_id 三重白名单完全匹配后，最多调用一次发送链；冷却重复幂等，未知投递 halted。定向 `29/29`、全量 Agent `409/409`、完整 Postgres `19/19`、Lint、三套类型检查、Agent/Web 构建、迁移幂等及 diff 检查通过；未调用真实端点、未发真实消息、未启 cron | 完成历史治理和部署密钥管理后，由人单独确认一次测试租户真实投递并回读消息/账本/审计；通过前保持关闭 |
| `S4-014` 真实环境只读执行准备度 | S4 release readiness | Automated Green / real read-only probe / delivery blocked | `GET /internal/stale-opportunity-reminder/execution-readiness` 使用执行专用凭证，在提醒/执行关闭时核验凭证隔离、精确白名单、租户/成员/open_id、个人 Review 权限、数据源、历史治理/sender 标记、uncertain 账本和当前候选；目标探针不读取其他租户。真实结果中身份/权限/来源/账本通过，当前 0 候选，阻断项为历史治理、sender 和无候选；探针后账本为空，未调用 execute 或发送消息；功能 checkpoint `324ce163dbccc32e7d2586a8cba27c0d293c3976` 已发布到 `github/main` | 完成历史治理和 sender 权限核验；出现真实候选后另行人工确认单条本人投递。此前保持提醒/执行/cron 关闭，不创建测试业务数据制造候选 |
| `S4-015` 历史商机治理证据门 | S4 governance evidence | Automated Green / real read-only probe / governance pending / delivery blocked | readiness 新增真实治理证据，受控 execute 在 plan/sender 前重查；即使人工标记误开，来源异常、空范围或未治理记录仍 fail closed。Base 缺修改时间时以记录 ID/负责人/状态/关联/沟通时间的确定性内容版本支持并发校验。真实白名单结果为 5 条商机、1 条状态已确认、4 条待确认、5 条可信时间缺失，但 5 条均已有安全版本；账本为 0、候选为 0、扫描凭证交叉访问 `401`。定向 `92/92`、Agent `438/438`、Postgres `19/19`、发布器 `4/4`，全仓 lint、三套类型检查、Agent/Web 构建、迁移幂等和 diff 检查通过；未调用 execute、未发消息或写业务数据；功能 checkpoint `bcffd91e0e17ff4fa66e439039469957823f2d2d` 已发布到 `github/main` | 由销售逐条完成真实治理；无已有跟进证据时不伪造时间。证据完成后再核验 sender，仍须等待真实候选并另行确认单条本人投递 |
| `S4-016` 真实 Sender 就绪证据门 | S4 sender evidence | Automated Green / real read-only probe / visibility not checked / delivery blocked | readiness 新增 `senderEvidence`，受控 execute 在 plan 前重查；严格复用 execution 白名单，重读租户/成员/open_id，并以当前租户应用身份只读核验机器人启用和已授权发送权限。真实探针确认 bot 启用、open_id 存在且 `im:message:send_as_bot` 已授权；应用无额外可用范围查询权限，目标可见性明确为 `not_checked` warning，不为探针申请过宽权限。明确不可见、查询失败、凭证/机器人/权限异常均 fail closed。S4 定向 `171/171`、Agent `454/454`、Postgres `19/19`、发布器 `4/4`，全仓 lint、三套类型检查、Agent/Web 构建、迁移幂等、启动日志和 diff 检查通过；整体仍由历史治理、人工 Sender 标记和 0 候选阻断，账本为 0，未调用 execute、未发消息或写业务数据 | 由销售完成历史治理；等待真实候选后由产品负责人另行确认一次本人投递，以消息和账本回读验证最终可达性。此前保持提醒/执行/cron 关闭 |
| `S4-017` 调度前可观测性 | S4 schedule observation | Automated Green / read-only audited / cron not configured / delivery blocked | 新增第三枚独立凭证保护的 `POST /internal/stale-opportunity-reminder/schedule-observation`；只聚合 execution readiness 的 blockers、治理/Sender/账本/候选状态与数量，不返回业务标识或候选明细。每次观察写脱敏 `schedule_observed.v1` 控制库审计；检查异常记 failed，审计目标缺失或落库失败显式返回 `auditRecorded=false` 并降级。凭证复用 scan/execute 时前置拒绝。定向 `24/24`、Agent `465/465`、Postgres `20/20` 通过；未调用 execute、未领取账本、未发消息、未改 Base/Task，也未创建 cron | 在部署密钥管理中配置独立观察凭证，让外部 cron 先只读观察；历史治理、自然候选和产品负责人单次确认前不提供执行凭证、不启用真实投递 |
| `S4-018` 只读调度接入包 | S4 scheduler client | Automated Green / deployment package ready / cron not installed / delivery blocked | 新增固定调用 `schedule-observation` 的单次 Node 工具；仅从环境读取观察 URL/Token/超时，拒绝远程 HTTP、URL 凭证、query/fragment、重定向、超大/非 JSON/不一致响应，不透传 Token、HTTP 正文或底层异常。退出码区分 ready、blocked、incomplete、unavailable 与五类调用故障；附密钥隔离运行手册和完全注释的 30 分钟 cron 示例。客户端 `10/10`、Agent `465/465`、Postgres `20/20`、发布器 `4/4` 及 Lint、类型、构建、迁移幂等通过 | 由部署环境配置固定 HTTPS 地址与观察凭证；产品负责人确认前不安装或启用 cron，不向调度身份提供扫描/执行凭证。历史治理、自然候选和单次本人投递仍是后续门禁 |
| `REV-001` 个人日报 | B7 | Automated Green / API contract ready / UI pending | 日报聚合快照 3/3；Agent 全量 `245/245`、Postgres `8/8`、服务端/客户端/测试 TypeScript、ESLint、Agent/Web 构建通过；`GET /api/platform/daily-report` 已实现登录、租户、销售范围和 `review:read-personal` 权限边界，来源不可用/分页不完整安全降级；当前租户真实只读 Task 探针返回 5 条本人未完成任务、无分页警告 | 尚未在真实登录态回读日报内容，也未完成真实 Web/飞书 UI 验收 |
| `PN-001..007, PN-T12` 主动销售通知 | P1 trigger + B7/E | Single-recipient rollout active | D-061 已把本人日报限定为周一至周五 17:00（工作日零活动仍发），周五 17:05 本人团队周报保持不变；类型白名单与 tenant/member/open_id 三重白名单持久启用，本人角色为 sales + manager。周末不命中、工作日命中 TDD 已通过；既有固定时间 plan-only、团队周报真实投递和应用身份回读、账本唯一 sent、重复 already_sent、Agent 709 项、PostgreSQL 32 项及每 5 分钟 Windows 调度退出码 0 均通过 | 当前工作日按星期定义，未接法定节假日/调休日历；仅本机登录态运行，无服务器级 SLA；临时隧道不用于报告详情链接。任务/风险/个人周报、其他成员/租户、稳定服务器调度和 HTTPS 详情入口仍须独立验收 |
| `PN-008..013` 通用主动通知 unknown 对账 | P1 operations | Implemented / UI pending / delivery disabled | 当前租户清单、`admin:manage-policies`、三类人工裁决、乐观并发、独立不可变审计和 `/admin/notification-deliveries` 已实现。释放重试只增加一次尝试资格，裁决不调用 sender；提交中对话框不可误关。迁移 021 幂等，主动通知仓储 `8/8`，Agent `643/643`，PostgreSQL `31 passed / 3 controlled live probes skipped`，完整类型/Lint/构建与隔离启动冒烟通过 | 当前真实组织没有 admin 角色，不能执行真实管理员 UI；不发送消息、不启 cron、不写 Base/Task，保持 `UI pending` |
| `COP-001..011` 客户商机决策 | C / P1-PROGRESS | Automated Green / Web implemented / API and bot integrated / UI pending | 本人客户、商机、历史跟进和 Agent 明确确认任务证据已形成只读组合；进行中/未知生命周期商机按确定性规则排序，关闭类排除；机器人、Web API、`/opportunities` 主从决策面和 `/customers` 客户组合摘要已接入。客户汇总保留无进行中商机客户，金额缺失不补 0，无明确客户关联的商机不猜绑；只读不执行建议 | 真实销售机器人回复和 Web 登录态/UI 尚未验收；完整 CRM 客户 360 和任何建议执行均未完成；团队聚合由 `COP-012..016` 承接 |
| `COP-012..016` 主管团队客户与商机决策 | E / P1-PROGRESS | Automated Green / Web implemented / UI pending | manager 本人+递归下属、executive/admin 租户 active 范围与 sales-only/cross-tenant fail-closed 已测试；团队按健康、分数、真实金额、名称稳定排序并保留负责人/个人排名；单成员失败 partial、全部失败 unavailable、全员无商机 empty、未知金额 null。双权限 API 和 `/reviews/opportunities` 已接入，管理动作只建议不执行。定向 `30/30`、Agent `499/499`、Postgres `20/20`、发布器 `4/4`、调度客户端 `10/10` 及完整质量门/启动冒烟通过 | 真实主管/高管登录态的团队范围、内容、链接和视觉呈现未验收；自动派发、消息、客户触达和任何商机写入未实现 |
| `COP-017..022` 客户洞察与拜访准备 | C / P1-PROGRESS | Automated Green / Web implemented / UI pending | 客户卡进入只读拜访准备页；精确客户 ID、客户链接优先的跟进规则、同名隔离、进行中商机决策复用、关闭商机历史背景、最近 10 条跟进、未知金额和缺口转问题均有测试。三权限 API 只传当前销售 open_id 和 URL 客户 ID。定向 `17/17`、Agent `516/516`、Postgres `20/20`、发布器 `4/4`、调度客户端 `10/10` 及完整质量门/启动冒烟通过 | 真实销售登录态的内容、原记录链接和响应式视觉未验收；联系客户、建任务、更新客户/商机/跟进均未实现且不得自动执行 |
| `COP-023..029` 客户沟通内容准备 | C / P1-PROGRESS | Automated Green / Web implemented / UI pending | 复用精确客户攻略生成沟通目标、最多 3 个事实角度、待确认问题、全部标记为材料待补充的准备清单，以及飞书/邮件可编辑预览草稿；每项建议保留来源键与原记录链接。三权限 API 和 `/customers/:customerRecordId/communication` 已接入；专项 `17/17`、Agent `533/533`、Postgres `20/20`、发布器 `4/4`、调度客户端 `10/10` 及完整质量门/启动冒烟通过 | 真实登录态内容与响应式视觉未验收；真实资料检索、发送、保存编辑、建任务和业务写回均未实现，且不得由本切片自动执行 |
| `KNO-001..009` 销售资料检索与推荐 | C / P1-PROGRESS | Real source verified / read-only retrieval verified / Web implemented / UI pending | 当前租户显式配置 3 份 Docx 白名单；应用只有 `view`，唯一 active 销售 `open_id` 与三份直接所有者 ACL 精确匹配。生产 Gateway `ready`，检查/可信结果 `3/3`、无 warning，返回真实标题、链接、摘录、`revision:3` 和 `accessVerified=true`。Docx 继续要求租户可读链接或销售直接协作者，互联网公开链接、群、部门、应用等不推导为本人权限。真实接入删除导致 `1063001` 的非法 SDK `fields` 参数并调整 ACL 检查顺序。Gateway `13/13`、资料与沟通准备 `50/50`、跨层 `89/89`、Agent `570/570`、Postgres `20/20` 及类型、Lint、双构建、两次迁移和 `3199` 启动冒烟通过 | 按用户要求真实 UI 仍 pending；v1 只推荐，不发送、不修改资料、不写业务数据。后续来源仍须逐条白名单、只读授权并通过销售本人 ACL |
| `SIA-001..006` 销售知识问答 / RAG Agent v1 | D | Real source verified / bot integrated / Automated Green / UI pending | 唯一“销售agent”私聊的高置信度 `sales_qa` 已在普通会话、跟进澄清态和跟进补充态接入必需问答端口；active 成员、`playbook:read`、租户白名单和销售本人 ACL 缺一不可。回答最多 3 条真实摘录并带标题、段落、版本、适用边界和链接；无证据不采用模型回答。真实三问均 `answered`，首条分别命中产品能力、拜访准备、数据权限文档且均为 `revision:3`。知识问答与工作流 `76/76`、模块装配 `2/2`、真实探针 `3/3`、Agent `580/580`、Postgres `20/20` 及完整质量门、`3198` 启动冒烟通过 | 按用户要求真实 UI 保持 pending；v1 只读问答，不发送客户、不建任务、不写客户/商机/跟进/记忆/文档。知识候选、审核发布和操作型问答由 Playbook 后续切片承接 |
| `REV-002..006` 团队 Review 和经营分析 | E | Automated Green / Web implemented / UI pending | `GET /api/platform/team-review` 已覆盖主管递归范围、高管租户范围、成员日报聚合、逾期/无跟进关注项、来源降级和无效成员 fail-closed；`/reviews/team` 已展示团队指标、关注成员、管理建议和逐人状态；团队/平台权限/导航 16 项定向回归、全量 Agent `264/264`、Postgres `11/11`、三套 TypeScript、全库 ESLint、Stylelint 和 Agent/Web 构建通过 | 尚未在真实主管/高管登录态核对团队范围、真实内容和视觉呈现；管理动作执行、调度和幂等仍未实现 |
| `BPA-001..006` 最佳实践与 Playbook | F | Automated Green / UI pending | 候选、不可变版本草稿和发布前审核本地实现；审核服务/权限、组件及 PostgreSQL/HTTP 回归见 SDD 51/52 与对应证据 | 真实身份 UAT 待补；采用记录、正式发布、赢丢单样本发现仍待定义/实现，未实际发布 |
| `BPA-007` 发布前审核 | F | Implemented / Automated Green / UI pending | 提交、管理员批准/退回、版本失效、只追加审计、双 CAS、幂等和错误边界通过；全量单元 129 文件/1155 项，审核隔离 PostgreSQL/HTTP 16 项通过 | 真实身份 UAT 与 1280px/390px 审核工作台视觉检查待验；批准仅表示审核通过，不触发发布 |
| `OPS-001..002` 正式运行保障 | G | Draft | 待故障/恢复/备份测试 | 待两个真实租户验收 |

## P0 回归基线

以下能力已有证据，但在 Goal v3 中仍需持续回归：

| 基线 | 当前证据 |
| --- | --- |
| 文本跟进到确认卡片 | 真实飞书消息和确认卡片 |
| Base 客户/商机/跟进写入 | 三条真实 record ID |
| 飞书任务创建 | 真实 Task GUID |
| 重复确认和部分失败恢复 | 现有 Vitest 工作流测试 |
| 两租户代码级隔离 | 现有负向测试 |

旧证据只证明 P0 行为，不自动证明新角色权限、多模态、Web、RAG、报告或 Playbook。

## 2026-10-16 本轮需求追踪

| 需求 | 设计 | 状态 | 验收证据 |
| --- | --- | --- | --- |
| TCL-001..002 | 47-trusted-followup-action-center-sdd | Design / existing capability to revalidate | 本轮待验证，不沿用旧 Green 结论 |
| ACT-001..005 | 47-trusted-followup-action-center-sdd | Design | 聚合、操作、权限、恢复、Web/飞书与质量门待实现/验证 |

## 2026-10-16 当前验收状态
本轮新增行动 API、聚合及来源覆盖，定向联合跟进回归 113/113；server/client/test TypeScript、Agent 构建通过。持久操作、Web 展示与四操作、飞书快捷操作、Postgres 集成和真实 UI 尚未完成。未执行真实飞书发送或 Base/Task 写入，未满足 checkpoint 门槛。
2026-10-16 ACT-002 task confirmation: `today-actions/task-drafts` creates a tenant/member-scoped PendingAction with `actionKind=task`; confirmation acquires the existing execution lease before TaskGateway scheduling. No customer/opportunity/followup writes occur in this branch. Covered by TodayActionController and AgentActionExecutor tests; real gateway remains separately gated.

2026-10-16 飞书今日行动快捷回调：契约层测试 today-action-card-contract.spec.ts 3/3（非法操作、修订、接收人、稳定提醒时间与幂等键）；授权/原卡绑定、四操作执行及真实 UI 尚无完成证据，保持未验收。

2026-10-17 飞书回调入口：TodayActionCardService 已接 HTTP/长连接 today_action 路由，认证成员、读取权限、原卡归属与事项版本后复用状态账本。局部单测 30/30，仓储集成 14/14、类型/Lint/build 和通知模块装配通过；按钮渲染、业务确认交互、原卡更新、到期调度和真实 UI 仍未验收。

2026-10-17 投递一致性证据：首次载荷冻结单测与跨仓储实例 Postgres 重试测试通过；回调伪造 itemId 的失败测试已修复。联合仓储集成 15/15，相关单测、类型与 Agent build 通过；原卡更新、到期调度、业务确认快捷操作及真实 UI 保持未验收。

### 卡片状态回显恢复切片（2026-10-17）
- 设计：基于已发送卡片冻结载荷与当前事项状态生成原卡片替换内容；保留其他事项与工作台入口，已处理/稍后提醒事项移除旧操作按钮。
- 恢复：回调重试重放持久操作结果，再按最新状态重建卡片；不新增消息、不重复业务写入。卡片返回失败仅影响展示，保留原操作键供重试。
- 验收：状态渲染覆盖多事项、旧版本隔离和重复重建；真实卡片展示仍待真实账号验收。

### 到期提醒调度切片（2026-10-17）
- 到期提醒沿用现有单租户、单成员、单收件人 rollout 与发送开关；task_action 启用时，在每次调度读取到期 snoozed 状态。
- 重新读取可见事项并精确匹配版本；事项失效、来源不可用或已处理时不发送。投递键由事项 ID、版本与状态 revision 组成，失败重试不提前消费提醒，未知投递由现有账本冻结。
- 普通每日摘要过滤已处理和稍后提醒事项，避免绕过提醒时间。每条提醒包含原因、证据、建议动作与完成日期。
- 验收先覆盖纯规划去重、过期版本和未到期过滤，再接生产调度并验证模块装配；真实发送单独确认。

### 完整行动摘要切片（2026-10-17）
- 飞书每日 task_action 摘要复用 TodayActionService，覆盖客户跟进、任务与商机信号，并读取持久状态过滤已处理/稍后提醒项。
- 每条展示原因、证据、建议动作、建议完成日期；来源降级明确显示。保持本人权限、现有 rollout、投递幂等与人工确认边界。
- 本切片先测试摘要内容与状态过滤，再接生产 runner；聊天业务草案快捷操作继续单独实现，不直接写业务数据。

### 聊天独立任务确认卡切片
创建任务快捷操作先生成本人可编辑草案，完整展示标题、截止时间、执行方式和参与人。确认回调携带 action ID 与版本；严格验证表单、身份、原卡片及租约后才调现有独立任务执行器。过期、重复、旧版本与失败恢复沿用持久状态边界。真实任务创建单独确认，开发验证不调用外部写入。

### Web 任务执行结果查询切片
新增本人任务草案只读状态查询，返回等待确认、执行中、成功或失败及原任务链接。服务端检查 task:read、本人归属与 task 类型；客户端不得通过确认接口轮询，避免读操作触发重试。后续工作台保存 action ID 并短轮询，失败显式重试原 action。
# 2026-10-18 今日行动真实验收增量

PREP-RESULT（2026-10-20 当前）：聊天准备结果快照、本人隔离查询、Web 查看编辑及投递账本已实现，设计见 SDD49。自动化覆盖保存失败不成功、修订冲突、取消/过期、跨租户/成员、权限撤回、编辑冲突与未知投递核查；真实身份聊天/Web UAT 仍待补，不以默认成功文字代替验收。

PREP-DELIVERY-RECONCILE：unknown 投递支持当前有权用户依据人工消息证据，通过版本 CAS 确认 sent，并原子审计；不包含确认未发送或重发授权，unknown 仍不可重领。单测与 PostgreSQL 重放/旧版本集成通过；Web 核查表单、失败后先回读和回读失败锁定已验证，真实消息核验仍待验收。

ACT：本人测试事项稍后提醒、已处理持久状态、独立任务确认/失败原键恢复/成功状态查询真实通过；生成跟进草案、证据和质检真实通过，最终写入因D-052必建待办与额度2/2未关闭。技术证据：product-api-transport、feishu-read-retry、today-action.controller、agent-validation及Postgres today-action-state；失败先行与UI截图详见trusted-loop-ui-acceptance-2026-10-17.md。聊天快捷、五类全样本和剩余UI未计通过。

PREP-EDIT（本地完成）：准备话术独立编辑快照、严格字段校验、本人当前权限复核、CAS 防覆盖及原子元数据审计；Web 共享版本/串行保存、冲突比较、临时故障保留输入、切换结果及迟到响应隔离、权限失效清空已实现并验证。设计见 SDD49；真实登录验收仍待补。

OPS-HEALTH（本地完成，SDD50）：live 独立存活，ready 校验控制库及 28 项迁移名，503 脱敏/no-store；只读事务、1500ms 语句超时、2 秒 HTTP 截止和单个在途探测。隔离 HTTP 集成与完整 runtime 停库/恢复通过，启动脚本拒绝仅端口存活。正式 HTTPS、托管、监控、备份和调度准时未验收。

2026-10-20 收尾质量门：125 文件/1074 单元、59 隔离集成通过/3 真实探针跳过、5 健康 CLI；三套类型、ESLint、Stylelint、双构建通过。1280px/390px 实际组件合成验证完成，真实登录 UAT 未完成。详见[证据](../evidence/remaining-capabilities-20261020/verification.md)和[剩余执行计划](../remaining-capabilities-execution-2026-10-20.md)。

