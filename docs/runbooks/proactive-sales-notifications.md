# 主动销售通知运行手册

状态：代码、自动化、PostgreSQL 与一次本人真实投递已验证；生产投递和 cron 默认关闭。

1. 在 Secret 管理中设置独立的 `PROACTIVE_SALES_NOTIFICATION_TRIGGER_TOKEN`，不得复用 S4
   扫描、观察或执行凭证。
2. 将 `PROACTIVE_SALES_NOTIFICATION_RUN_URL` 设置为固定 HTTPS 地址，路径必须以
   `/internal/proactive-sales-notifications/run` 结尾。
3. 先开启 `PROACTIVE_SALES_NOTIFICATIONS_ENABLED=true`，保持
   `PROACTIVE_SALES_NOTIFICATIONS_DELIVERY_ENABLED=false`，手动运行一次 runner 并核对
   `plan_only` 的租户、成员与计划数量。
4. 完成迁移 020、机器人发送权限、测试租户/本人收件人和未知投递运营流程检查。
5. 经产品负责人单独确认后，只在测试租户开启一次真实投递，回读飞书消息、账本和重复调用。
6. 全部通过后才可安装每 5 分钟 cron；仓库中的 cron 文件始终保持注释，避免代码发布即启用。

命令：

```text
npm run run:proactive-sales-notifications
```

退出码：`0=completed`、`2=plan_only`、`3=disabled`、`4=partial`、`5=blocked`、
`10..14=配置或调用错误`。输出不包含 Token、open_id 或业务正文。

本地验证已完成：项目 PostgreSQL 只监听 `127.0.0.1:55432`，迁移 020/021 首次 apply、再次
skip，主动通知仓储 `8/8`、全套集成 `31 passed / 3 controlled live probes skipped`。
部署环境仍必须重复迁移、plan-only 和测试租户本人投递门禁，不得直接继承本地证据开启发送。

2026-10-12 一次性验收记录：固定租户当地 `18:05` 的 plan-only 唯一命中 1 个本人个人日报；
首次请求因 Card 2.0 混入旧版 `note` 被 HTTP 400 明确拒绝。完成组件与错误分类 TDD 修复并
人工对账为未送达后，用相同业务键和稳定 UUID 重试成功；账本唯一 `sent` 行，重复运行为
0 新发送、1 个 `already_sent` 跳过，飞书回读为“销售日报” interactive 卡片并含 HTTPS 入口。
本次只发本人，未发主管/群，未启用 cron；两个持久开关仍为 `false`。这份证据只证明当前
测试租户本人个人日报链路，不自动放行其他通知类型或生产调度。

## unknown 人工对账

1. 只有拥有 `admin:manage-policies` 的当前租户管理员可以打开
   `/admin/notification-deliveries`；普通销售、主管、高管和未登录请求均不得读取清单。
2. 先在真实飞书会话核对消息，再选择一项裁决：
   - “确认已送达”：填写真实消息 ID 和带时区发送时间，之后不再领取该业务键；
   - “确认未送达并释放一次重试”：只增加一次后续尝试资格，本次不会发送；
   - “证据不足，继续冻结”：保持 `uncertain`，等待后续证据。
3. 页面提交中不可关闭，完成后再显示成功、冲突或失败。冲突必须刷新后重新核对，不能覆盖
   其他管理员的新版本。
4. 每次成功裁决都会追加不可变审计；禁止直接改
   `proactive_sales_notifications` 绕过操作人、证据和并发保护。
5. 对账完成不等于允许生产投递。持久开关和 cron 仍需独立发布决策，不得因清单为空自动开启。

迁移 021 建立通用对账表及稳定通知 UUID/尝试上限；已进入迁移账本，后续结构变化必须新增
迁移文件，不能修改 021。当前真实组织没有 admin 角色，因此自动化和未登录启动冒烟已通过，
真实管理员页面仍是 `UI pending`。
