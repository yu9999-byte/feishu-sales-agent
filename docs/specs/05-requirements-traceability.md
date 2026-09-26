# 需求追踪矩阵

状态：`Approved / Goal v3 aligned / automated Green / UI pending 2026-09-26`

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
校验按用户要求保留为 P1 TODO，不在本轮改动；Web OAuth state 会话绑定已补齐。

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

| 需求范围 | 阶段 | 规格状态 | 自动化证据 | UI 证据 |
| --- | --- | --- | --- | --- |
| `SIA-000..000D` 对话入口、意图与安全路由 | B0 | Implemented / UI partial, clean-state retest pending | LangGraph 主分类覆盖普通态、澄清态和补充态；明确跟进命令确定性直达，24 小时 checkpoint TTL 具备保留/删除回归；进入 168 项全量回归 | WebSocket 已收到并完成两条真实私聊工作流；卡片内容与补充态仍待干净状态重放 |
| `PLT-001..006` 多租户、身份、授权、审计 | A | Implemented | 51 项单测 + 5 项真实 Postgres 集成测试；包含租户范围 OAuth、RBAC、拒绝/允许审计追加 | 真实飞书 OAuth、管理员允许、销售直达管理页拒绝已通过；四真实账号/两真实租户待验收 |
| `WEB-001..003` 页面授权、状态和飞书深链 | A | Implementing | OAuth 缺 state Cookie、不一致和重放均拒绝；Session/导航/页面 API 边界通过；深链签名尚未实现 | 桌面、390px 窄屏、角色导航及 forbidden 已通过；最新 OAuth 回归和卡片详情深链待验收 |
| `ING-001..002` 表单与文本输入 | B1 | Implementing | Web 创建 API、同键并发与租户归属通过；“写跟进”原聊天表单、异步生成/失败恢复、非本人/空原文/重复提交、回调解析和旧 P0 兼容测试通过 | Web 与真实飞书原聊天文本/卡片录入、字段补充、生成和确认已通过；其他输入来源待验收 |
| `FUP-001..003` 提取、生成和证据 | B1 | Implemented / UI verified | 来源 quote、生成正文与版本通过；本次沟通方式/时间/主题、`nowLocal` 与显式 offset 契约已进入 126 项回归 | 真实飞书卡片已正确区分本次“飞书”与下一步“飞书会议”，时间为 `2026-09-21T10:15:00+08:00`，主题为“试点方案” |
| `FUP-004..006` 保存前可用性、卡内编辑和检查修改 | B2 | Implementing / regression fix | 阻断/建议分离、无数字等级、中文化去重，以及“检查修改只更新、确认保存携编辑值一次执行” Red/Green 均已进入 137 项回归 | 无评分主视觉和取消终态已验收；本次确认按钮修复待真实复测 |
| `ING-003` 语音输入 | B3 | Draft | 待飞书语音契约测试 | 待真实语音验收 |
| `ING-004` 妙记/会议输入 | B4 | Draft | 待 Minutes/Note 契约测试 | 待真实妙记验收 |
| `ING-005..007` 文档输入和失败恢复 | B5 | Draft | 待 Docs 权限/异常测试 | 待真实文档验收 |
| `FUP-007..009` 写入、结果/项目质检卡、策略推送和幂等 | B6 | Implementing / regression fix | 三项 Base 后建任务、原卡唯一成功终态、原卡 patch 失败时补发、幂等、`followupRecordUrl` 持久化、成功卡记录链接，以及 `card.source_finalized`/补发 `card.result_sent` 审计均进入 137 项回归 | 历史双成功卡仅保留为 D-022 前的缺陷证据；本次唯一“跟进登记成功＋查看跟进记录”待真实复测 |
| `FUP-010..011` 即时执行反馈、失败恢复和成功结果修订 | B6 | Automated Green / UI pending | 飞书卡与 Web 均先返回 `executing`；Web 自动轮询；超时回收、失败重试、N/N+1 候选映射、返回编辑和原 Base/Task 更新进入 158 项回归 | 待真实飞书观察执行中、成功/失败及编辑原结果；Web 执行中自动刷新待 UI 复验 |
| `TSK-001..006` 任务预览、一次确认、状态建议/回收和提醒 | B6 | Partial / Task permission blocked | 精确版本候选选择、空选择不建任务；缺 Task 读取权限或未核实商机时不生成候选；只有日期无钟点时不补造时间。历史任务创建曾通过，当前读取返回 `99991672` | 新版预览和禁用状态待真实 UI 复验；权限开通前不能验证状态回收/主动提醒 |
| `CTX-001..012` 客户/商机/跟进/任务上下文读取、匹配与来源 | P1-CTX | Partial / UI pending / Task permission blocked | Base 富文本数组 Red/Green、本人范围商机回退、真实华南科技只读重放成功；Task 来源错误明确为权限缺失，不吞掉 Base 事实 | 原草案 UI 曾失败；最新卡片与 Web 多分支待验收，Task 读权限待开通 |
| `PRG-001..012` 本次进展、缺口、风险、建议与确认动作 | P1-PROGRESS | Automated Green / UI pending | 风险和行动建议在 Task 缺权限时保留；任务候选 fail-closed；编辑重算、Postgres 回读及旧草案兼容；201 项 Agent 测试和真实来源只读重放 | 最新飞书/Web 四层展示、编辑和确认边界仍待 UI 对账 |
| `S4-001` 商机 7 天未更新提醒 | P1 internal trigger | Partial / disabled / prerequisites open | 纯判定层 6 项测试覆盖可信时间、7 天边界、负责人、任务来源和免打扰；尚无真实扫描、持久去重、定时任务或提醒发送 | 先确定逐商机有效跟进时间和 Task 读权限，再接入默认禁用的扫描/去重/本人投递与真实验收 |
| `REV-001` 个人日报 | B7 | Draft | 待报告快照测试 | 待个人日报验收 |
| `COP-001..007` 客户商机决策 | C | Draft | 待查询/评分/权限/评测 | 待销售/主管页面验收 |
| `SIA-001..006` 问答、RAG 和操作 | D | Draft | 待 ACL/RAG/工具测试 | 待问答与操作验收 |
| `REV-002..006` 团队 Review 和经营分析 | E | Draft | 待聚合/调度/幂等测试 | 待主管/高管验收 |
| `BPA-001..006` 最佳实践与 Playbook | F | Draft | 待样本/版本/审核测试 | 待管理员审核验收 |
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
