# 客户洞察与拜访准备 Agent v1 TDD

日期：2026-10-07  
状态：`Green / Automated Green / UI pending`

关联 SDD：
[客户洞察与拜访准备 Agent v1 SDD](27-customer-visit-briefing-sdd.md)。

## 1. Red 场景

1. 精确客户 ID 返回客户、联系人、全部明确关联商机和最近 10 条跟进。
2. 同名但不同 record ID 的客户、商机和跟进不串联。
3. 进行中商机复用个人决策风险/缺口/建议，关闭商机只作历史背景。
4. 跟进按有效沟通时间倒序，无时间记录排后且不伪造日期。
5. 联系人、客户摘要、进展、金额、下一步、时间和风险分别形成稳定待确认问题。
6. 全部金额未知时保持 `null`；金额为 0 时保留真实 0。
7. 组合部分来源不完整时保留可证明内容并返回 `partial`。
8. 组合网关异常或关键范围不可用时返回 `unavailable`。
9. 客户不在本人组合时返回 `empty`，不透露其他范围是否存在。
10. inactive 集成、空 actor 或无组合网关时失败关闭。
11. Controller 未登录、三权限任一缺失、平台会话不一致和集成跨租户分别返回 401/403/503，
    且攻略服务零调用。
12. 前端 helper 覆盖状态文案、未知金额、日期和风险标签。

## 2. 回归范围

- `opportunity-decision.spec.ts`：原本人商机决策排序、任务只读和客户汇总不回退。
- `sales-context-gateways.spec.ts`：负责人范围、分页和显式关联不回退。
- `CustomerPortfolioPage`：原客户组合仍可加载，新增入口只传 record ID。
- Agent 全量、Postgres 集成、发布器、调度客户端、三套 TypeScript、全仓 Lint、双构建、迁移
  幂等和完整 Nest 启动。

## 3. Green 证据

- 有效 Red：服务和前端 helper 初始因实现文件不存在失败；Controller 初始因控制器不存在失败。
- 客户攻略服务、三权限 Controller 和前端 helper 定向 `17/17` 通过；同名客户/商机、冲突客户
  链接、最近 10 条跟进、未知金额、部分来源和失败关闭均有回归。
- Agent 全量 `516/516`、Postgres 集成 `20/20`、发布器 `4/4`、调度客户端 `10/10` 通过。
- 服务端、客户端和测试 TypeScript、ESLint、统一 Lint、Stylelint、Agent 118 文件构建、Web
  生产构建、迁移连续两次全量 `skip` 和 `git diff --check` 通过。
- 完整 Nest 启动无依赖注入错误；`/`、`/customers`、
  `/customers/customer-a/briefing` 返回 `200`，未登录攻略 API 返回 `401`。
- 未执行真实销售登录态视觉验收，因此继续保持 `UI pending`；本轮未发消息或写业务数据。
