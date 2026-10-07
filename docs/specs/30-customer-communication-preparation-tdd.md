# 客户沟通内容准备 Agent v1 TDD

日期：2026-10-07  
状态：`Green / Automated Green / UI pending`

关联 SDD：
[客户沟通内容准备 Agent v1 SDD](29-customer-communication-preparation-sdd.md)。

## 1. Red 场景

1. 精确客户 ID 只调用一次拜访攻略服务，并把当前租户、销售 `open_id`、日期和时区原样传入。
2. 有进行中商机时，从最高优先级商机的建议、风险和缺口生成沟通目标与最多 3 个沟通角度。
3. 没有进行中商机时，只生成需求确认目标，不虚构商机、预算或成交计划。
4. 每个目标、角度和材料建议都引用响应中的真实来源键，来源只来自客户、明确关联商机和明确
   关联跟进。
5. 攻略待确认问题保持问题语义，不被草稿改写成客户已经确认的事实。
6. 材料建议全部为 `material_pending`，类型中不存在链接或附件字段，序列化结果不出现虚构
   文档 URL、token 或报价数字。
7. 固定返回飞书消息和邮件两份可编辑、仅预览草稿；联系人缺失时使用中性称呼。
8. `partial` 保留可证明输出和警告；`empty` / `unavailable` 返回空计划、空材料和空草稿。
9. 攻略服务异常时安全降级为 `unavailable`，不根据旧状态或其他客户内容继续生成。
10. 未登录、三权限任一缺失、平台会话不一致、inactive 集成和跨租户分别返回 401/403/503，
    且沟通准备服务零调用。
11. Controller 只传认证成员 `open_id` 与 URL 客户 record ID，不接受前端提交销售身份。
12. 前端 helper 覆盖状态文案、来源标签、草稿标签和材料待补充标签。
13. 页面源代码不调用发送消息、发送邮件、创建任务或业务写入 API。
14. 测试桩只提供攻略读取依赖，证明生成过程没有其他写入端口。

## 2. 回归范围

- `customer-visit-briefing.spec.ts`：同名隔离、冲突链接、问题和攻略状态不回退。
- `customer-visit-briefing.controller.spec.ts`：原三权限与本人 `open_id` 契约不回退。
- `CustomerVisitBriefingPage`：原攻略页面仍可加载，并新增明确的沟通内容准备入口。
- 客户组合、个人商机决策、任务履约、日报、主管聚合和 P0 跟进闭环保持通过。
- Agent 全量、Postgres 集成、发布器、调度客户端、三套 TypeScript、全仓 Lint、双构建、迁移
  幂等和完整 Nest 启动。

## 3. Green 证据

- 有效 Red：服务、Controller 和前端 helper 初始均因实现文件不存在而失败。
- 新服务、三权限 Controller、SPA 深链接和页面 helper 定向 `17/17` 通过；与原拜访攻略合并
  回归 `34/34` 通过。
- Agent 全量 60 个文件 `533/533`、Postgres 集成 `20/20`、发布器 `4/4`、调度客户端
  `10/10` 通过。
- 服务端、客户端和测试 TypeScript、全仓 ESLint/统一 Lint、Stylelint、Agent 121 文件构建、
  Web 生产构建、迁移连续两次全量 `skip` 和 `git diff --check` 通过。
- 完整 Nest 在隔离端口启动无依赖注入错误；首页、客户组合、拜访攻略和沟通内容页面均
  `200`，未登录沟通内容 API 返回 `401`。
- 按用户要求未执行真实销售登录态 UI；未发送消息/邮件、未建任务、未写业务数据，因此状态
  保持 `UI pending`。
