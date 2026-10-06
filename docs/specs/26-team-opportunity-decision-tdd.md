# 主管团队客户与商机决策 Agent v1 TDD

日期：2026-10-07  
状态：`Green / Automated Green / UI pending`

关联 SDD：
[主管团队客户与商机决策 Agent v1 SDD](25-team-opportunity-decision-sdd.md)。

## 1. Red 场景

首轮 Red 已用不存在的团队服务和页面 helper 验证，测试因无法解析
`team-opportunity-decision.service` 和 `team-opportunity-decision-view` 失败，而不是因断言错误
或环境故障。实现后进入 Green。

| 场景 | 预期 |
| --- | --- |
| manager 有多级下属和外部团队 | 只调用本人和递归下属的个人决策，不读取外部团队 |
| executive/admin 范围 | 读取当前租户全部 active 成员，排除 disabled 和跨租户成员 |
| sales-only、失效 viewer、跨租户 | 业务读取前失败关闭 |
| 多销售有不同健康等级、分数和金额 | 按确定性团队规则排序并保留负责人、个人排名 |
| 一名成员读取抛错 | 保留其他成员结果，整体 partial，失败成员 unavailable |
| 全部成员不可读 | 返回 unavailable 和空优先级 |
| 全部金额未知 | 团队和成员已知金额为 `null`，页面显示“金额待补充” |
| 全员可读但无进行中商机 | 返回 empty |
| 个人建议存在 | 形成待确认主管动作，不产生任何执行调用 |
| Web 无登录、权限缺一、会话身份不一致、集成跨租户 | 分别 401、403 或 503，聚合服务零调用 |
| 页面选中记录刷新后消失 | 回退到当前第一优先；队列为空回退 null |

## 2. 测试分层

1. `team-opportunity-decision.spec.ts`：组织范围、聚合排序、降级、金额、管理动作和零越权读取。
2. `team-opportunity-decision.controller.spec.ts`：401、双权限 403、认证/平台会话一致性和跨租户
   集成失败关闭。
3. `team-opportunity-decision-view.spec.ts`：中文健康状态、未知金额和失效选择回退。
4. `team-review.spec.ts`：共享范围抽取后原团队 Review 行为不回退。
5. `opportunity-decision.spec.ts` 与 controller 回归：个人事实、排序和权限契约不回退。
6. Agent 全量、Postgres 集成、发布器、调度客户端、三套类型、Lint、双构建和启动冒烟。

## 3. Green 证据

- 团队服务、控制器、页面 helper、原团队 Review 和个人商机决策定向共 `30/30` 通过。
- 服务端、客户端、测试三套 TypeScript 通过。
- 全仓 ESLint、统一 Lint、Stylelint 通过。
- Agent 构建成功编译 114 个文件，Web 生产构建通过。
- Agent 全量 54 个文件 `499/499`、Postgres 集成 4 个文件 `20/20` 通过。
- GitHub publisher `4/4`、调度观察客户端 `10/10` 通过。
- 迁移 `003..017` 连续两次全部 skip，幂等通过。
- 完整 Agent 启动成功并注册新控制器；首页、团队 Review、团队商机决策页均返回 `200`，
  未登录团队决策接口按预期返回 `401`。
- `git diff --check` 通过；真实 UI、真实消息和业务写入均未执行。

## 4. UI 待验收

- 使用真实 manager 登录态核对本人、递归下属和外部团队隔离。
- 使用 executive/admin 登录态核对全租户 active 范围。
- 核对部分成员不可读、未知金额、空组合、原记录链接和选中项刷新后的呈现。
- 验证页面没有派任务、发消息、修改客户/商机/跟进或触发 S4 执行。
