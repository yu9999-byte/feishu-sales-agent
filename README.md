# 销策 Agent

销策 Agent 是一个面向多企业 SaaS 场景的飞书销售 Agent。用户在飞书机器人中提交销售
跟进，Agent 将原始文本整理为客户事实、商机进展和下一步行动；用户通过消息卡片确认后，
系统把结果写入飞书多维表格，并创建真实飞书任务。

## 当前阶段

2026-09-20 已更新 Goal v3 目标交互：机器人先识别自然聊天、销售问答、内容生成、业务查询、
跟进、任务/商机操作和项目诊断；只有明确记录指令或当前跟进补充态才进入跟进链。销售提交
跟进后，在原聊天通过一张“草案＋保存前检查＋待办预览”卡编辑和一次确认；系统先写跟进，再自动创建已预览的本人
任务，并回发“执行结果＋任务”卡。出现新可行动项目风险、关键变化或主动分析时，才发第三种
项目推进质检卡。新版**文本跟进**聊天闭环已在真实飞书 UI 验收；语音、妙记/会议、文档、
跨角色策略推送、任务状态回收、提醒和日报仍按后续切片实施。

P0 已通过真实飞书企业闭环验收：用户私聊机器人提交跟进，智谱 GLM
完成结构化提取，用户确认消息卡片后，Agent 写入客户、商机和跟进三张 Demo Base 表，并
创建分配给发送者的飞书任务。版本 `1.0.1` 已审核发布，应用身份可读取和写入 Demo Base。
2026-09-24 整改基线为 22 个测试文件、158 项测试和 8 项真实 Postgres 集成测试；服务端、
客户端和测试类型检查、ESLint、Agent 与 Web 构建均通过。Vitest 已固定使用 `threads` pool，
避免 Windows/Node 25 默认 fork worker 的原生
CSPRNG 初始化崩溃。

- 已确认 Agent 核心能力由项目代码实现，不依赖妙搭 AI 插件或妙搭运行时。
- 历史 P0 不做独立 Web 页面；Goal v3 已增加可选 Web 工作台，但机器人来源仍在原聊天确认。
- 产品目标是多企业 SaaS；P0 在一个真实测试企业演示，并用自动化测试验证两个租户隔离。
- 已有妙搭应用和脚手架暂时保留为遗留资产，不再属于目标运行架构。
- 已有飞书自建应用 `销售agent`，其 App ID 可用于 P0 测试；App Secret 必须重置后再配置。
- 已实现机器人事件、卡片回调、LLM 提取、Base 写入、任务创建、审计、幂等与重试适配器。
- 已实现独立 Web 产品入口、飞书 OAuth、服务端多租户 RBAC、角色导航、工作台状态与受保护路由；
  客户 360、质检、Review 等业务页面仍按 Goal v3 后续阶段开发，当前占位页不计为完成。
- 已创建真实 Demo Base 及客户、商机、跟进三表，字段和关联关系已回读验证。
- 当前浏览器账号已能管理目标应用 `cli_aa211d0457381bdf`；版本 `1.0.1` 已审核发布。
- 重置后的 Secret 已在 Git 忽略的本地文件中设置，且目标应用换取 Token 成功。
- 临时 HTTPS 隧道只用于真实飞书联调，不是稳定部署资源；每次启动后都必须重新核对飞书
  回调地址、challenge 和实际消息投递，README 不记录瞬时在线状态。
- 目标机器人已作为编辑协作者加入 Demo Base；应用身份已回读三表 24 个字段及本次记录。
- `base:record:retrieve` 已按真实 API 缺权响应补充；Base 查询、创建和更新权限均已生效。
- `task:task:write` 已生效，真实任务已创建并通过 Task v2 回读。
- 真实聊天已完成 Card 2.0 录入、AI 草案、v2/v3 再质检、一次确认、Base 三表写入和本人
任务创建；现行实现将原确认卡就地更新为唯一成功/失败终态。历史双卡只保留为缺陷修复证据，
  不属于当前交互。
- P1-CTX 与 P1-PROGRESS 已达到自动化 Green：草案会读取本人范围的客户、商机、近期跟进和
  任务，展示事实依据、Agent 判断、下一步建议和确认后动作；真实飞书/Web 对账仍为 UI pending。

本次验收数据统一使用 `P0测试` 前缀。智谱免费 `glm-4.7-flash` 在高峰期可能返回模型拥堵
码 `1305`；Agent 会有限退避重试，仍失败时明确回复且不会写入业务数据。

## P0 本地运行

1. 准备独立 Postgres，在 `.env.local` 配置 `DATABASE_URL` 后运行
   `npm run migrate:agent`。该命令固定执行 `003`、`005`、`006`、`007`、`008`、`009`、`010`，记录文件
   校验和并可重复运行；不会执行 Demo 租户种子。
2. 创建客户、商机、跟进三张 Base 表，并按
   `migrations/004_agent_p0_demo_tenant.example.sql` 写入租户配置。
3. 将 `.env.example` 复制为 Git 已忽略的 `.env.local`，通过本地安全环境配置提供：
   `DATABASE_URL`、`FEISHU_APP_SECRET`、`FEISHU_VERIFICATION_TOKEN`、
   `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`。仅在飞书后台启用请求加密后才需填写
   `FEISHU_ENCRYPT_KEY`。
   只填写重置后的新 Secret，不要把值发送到聊天或写回 `.env.example`。
4. 运行 `npm run dev:agent`。
5. 在飞书开放平台将事件地址配置为
   `/webhooks/feishu/events`，卡片回调地址配置为
   `/webhooks/feishu/cards`。

服务默认监听 `0.0.0.0:3100`，可通过 `AGENT_HOST` 和 `AGENT_PORT` 修改。

本地验证命令：

```text
npm run type:check:server
npm run type:check:client
npm run type:check:test
npm run test:agent
npx vitest run --config vitest.integration.config.ts
npm run eslint
npm run build:agent
npm run build:web
```

## P0 闭环

```text
销售发送跟进文本
-> Agent 识别客户、商机、事实和下一步
-> 缺少关键信息时追问
-> 用户通过卡片确认或取消
-> 写入多维表格中的客户、商机和跟进
-> 创建飞书任务
-> 返回成功或明确失败结果
```

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [Goal v3 SDD 规格](docs/specs/README.md) | 完整产品需求、页面、权限、数据架构、TDD 计划和追踪矩阵 |
| [决策记录](docs/decision-log.md) | 已确认决策、假设和需要后续处理的问题 |
| [Agent 交互与能力](docs/agent-experience.md) | 用户入口、卡片状态和 P0 主流程 |
| [产品架构](docs/product-architecture.md) | 产品角色、体验边界和能力组成 |
| [业务架构](docs/business-architecture.md) | 业务对象、规则和数据流 |
| [技术架构](docs/technical-architecture.md) | 飞书、自建后端、LLM、Base 与任务的连接方式 |
| [飞书应用配置](docs/feishu-app-setup.md) | 机器人、事件、卡片、Base 与任务的配置检查 |
| [P0 验收矩阵](docs/p0-acceptance.md) | 每项能力的验证方式、证据和当前状态 |
| [当前工程说明](docs/current-state.md) | 现有文件、遗留资产和真实完成度 |
| [问题日志](docs/issue-log.md) | 当前问题、状态、证据和下一动作 |
| [竞品能力映射](docs/reference-capability-map.md) | APTSell 公开能力与本项目阶段映射 |
| [跟进卡片决策问答](docs/decisions/2026-09-20-followup-chat-cards.md) | 三种条件卡、一次确认、质检/推送边界和被覆盖旧口径 |
| [GitHub 自动检查点](docs/github-publish-automation.md) | 阶段发布、每日补漏、安全门与命令说明 |

## 工程原则

1. Agent 的编排、状态机、租户隔离、工具调用、审计和重试由项目代码实现。
2. LLM 只生成结构化建议，未经用户确认不得写业务数据或创建外部任务。
3. 每个请求先解析飞书 `tenant_key`，再读取该租户的数据源配置，禁止跨租户查询。
4. Secret、Token 和客户原文不得提交到 Git 或输出到日志。
5. 先通过一个最小真实闭环，再扩展 CRM、语音、会议、经营分析和 Playbook。
