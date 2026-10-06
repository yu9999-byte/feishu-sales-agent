# 主管团队客户与商机决策 Agent v1 SDD

日期：2026-10-07  
状态：`Implemented / Automated Green / Web implemented / UI pending`

关联路线：`P1-PROGRESS / COP-012..016`。关联测试：
[主管团队客户与商机决策 Agent v1 TDD](26-team-opportunity-decision-tdd.md)。

## 1. 产品目标

主管打开团队商机决策工作台时，系统把管理范围内每名销售的本人商机决策聚合成一个团队
优先级队列，回答四个问题：团队现在最需要关注哪些商机、由谁负责、为什么需要介入、主管
建议先核对什么。

该能力不是团队日报的重命名。团队日报回答当天执行情况；本 Agent 使用客户、商机、历史跟进
和 Agent 已明确确认的任务承诺形成跨销售决策视图。

## 2. 用户入口与结果

- Web：`GET /api/platform/team-opportunity-decisions`。
- 页面：`/reviews/opportunities`，并与 `/reviews/team` 双向联通。
- 顶部展示团队人数、可读成员、进行中商机、立即介入、风险和已知金额。
- 团队优先级保留负责人和该商机在负责人个人队列中的排名。
- 选中商机展示负责人、风险、信息缺口、建议动作和原始记录链接。
- 管理动作只表示“主管建议核对”，明确尚未派发、通知或执行。
- 成员组合展示每名销售的商机数、风险数、团队最高排名和首要建议。

## 3. 身份、权限与团队范围

- 入口必须具有有效飞书 Web 会话、活跃租户成员、`review:read-team` 和
  `opportunity:read` 两项权限。
- manager 只读取本人及按当前有效汇报关系递归得到的下属；组织循环产生 warning，并保守限制
  在可确认范围内。
- executive/admin 读取当前租户全部 active 成员；disabled 成员和其他租户成员不进入范围。
- 服务端会话中的租户、成员 ID、飞书 open_id 与认证会话任一不一致均 fail closed。
- 销售单角色、失效主管、跨租户集成、组织范围读取失败都不得调用个人商机决策服务。

## 4. 聚合与排序契约

每名成员复用已经验证的 `OpportunityDecisionService`，因此继续保持本人负责人范围、显式
客户/商机关联、历史跟进证据、任务只按 Agent 明确确认关联和 `readOnly=true` 的边界。

团队排序固定为：

1. `critical > at_risk > needs_attention > on_track`；
2. 个人决策 `priorityScore` 降序；
3. 真实已知金额降序，未知金额排在已知金额之后但不显示为 0；
4. 商机名称、负责人名称稳定排序。

不同销售的同名客户或商机是不同业务记录，不跨销售合并。成员个人排序继续写入
`memberRank`，团队排序写入 `teamRank`。

团队已知金额只累加真实非空金额；全部未知时为 `null`。成员读取失败不会删除其他成员已证明
的结果，失败成员保留 `unavailable` 和 warning。

## 5. 状态和降级

- `ready`：全部范围成员可读，且至少有一条进行中商机。
- `partial`：至少一名成员可读，但有成员或成员来源为 partial/unavailable。
- `empty`：全部范围成员可读，但没有进行中商机。
- `unavailable`：所有范围成员不可读，或身份、权限、租户、组织范围不可可靠确认。

warning 必须附带成员显示名，避免主管无法定位数据缺口；不得用模型、记忆或其他成员的数据
补齐失败成员事实。

## 6. 副作用边界

v1 完全只读：

- 不修改客户、商机、跟进或飞书任务；
- 不自动派任务、不提醒销售、不联系客户、不通知其他主管；
- 不调用 S4 真实提醒执行链，不保存任务观察快照，不启用 cron；
- 不把管理建议解释为已执行动作。

以后若允许主管派发动作，必须另行设计“预览 -> 人工确认 -> 权限校验 -> 幂等执行 -> 回读与
审计”，不能复用本次页面点击直接放开写入。

## 7. 非目标

- 不提供完整 CRM 客户 360 或预测团队业绩。
- 不按商机名称、客户名称、任务标题或文本相似度猜关联。
- 不自动评价销售绩效；风险排序只用于主管经营判断。
- 本切片不做真实主管 Web UI 验收，自动化和启动冒烟不能替代 UI 证据。

## 8. 验收标准

- manager、executive/admin、sales-only 和跨租户范围均有失败路径测试。
- 多销售排序稳定，负责人和个人排名不丢失，同名记录不合并。
- 单成员失败返回 partial 并保留其他结果；全部失败 unavailable；无商机 empty。
- 未知金额保持 `null`；管理动作来自真实个人建议并带 `requiresConfirmation=true`。
- Web 覆盖 loading、error、empty、partial、unavailable 和选择项失效回退。
- 全量测试、三套 TypeScript、Lint、双构建、迁移幂等、启动冒烟和
  `git diff --check` 通过后，只标记 `Automated Green / UI pending`。
