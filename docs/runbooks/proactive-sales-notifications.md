# 主动销售通知运行手册

状态：代码、自动化与 PostgreSQL 集成已完成；真实投递和 cron 默认关闭。

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

本地验证已完成：项目 PostgreSQL 只监听 `127.0.0.1:55432`，迁移 020 首次 apply、再次
skip，主动通知仓储 `3/3`、全套集成 `26 passed / 3 controlled live probes skipped`。
部署环境仍必须重复迁移、plan-only 和测试租户本人投递门禁，不得直接继承本地证据开启发送。
