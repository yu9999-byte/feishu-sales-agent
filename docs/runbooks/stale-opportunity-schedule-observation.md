# 商机停滞提醒只读调度观察运行手册

## 1. 这项能力解决什么问题

部署环境可以按固定时间询问销售 Agent：商机停滞提醒现在是“可进入人工放行”“仍被业务门禁
阻断”，还是“检查本身不完整/不可用”。每次有效观察会留下脱敏控制库审计，便于运维确认
系统为什么没有主动提醒销售。

这不是提醒执行器。观察工具只调用：

```text
POST /internal/stale-opportunity-reminder/schedule-observation
```

它不会调用扫描或执行入口，不领取提醒账本，不发送飞书消息，不修改 Base/Task，也不会自行
创建或启用 cron。即使结果为 `ready`，也只表示可以进入后续人工放行评估，不代表已经允许
真实投递。

## 2. 凭证与权限边界

部署密钥管理必须分别保存三种凭证：

| 凭证 | 可调用能力 | 只读调度器是否持有 |
| --- | --- | --- |
| 调度观察凭证 | 只读准备度聚合 + 脱敏审计 | 是 |
| 扫描凭证 | dry-run 商机扫描 | 否 |
| 执行凭证 | 受控单条真实投递入口 | 否 |

三枚凭证必须不同。不要把真实值写入 `.env.example`、crontab、命令行参数、日志或文档。观察
调度器的运行身份只能读取观察凭证；不能授予扫描凭证、执行凭证、飞书 App Secret 或数据库
连接串。

## 3. 配置

外部调度进程需要以下环境变量：

| 环境变量 | 必填 | 规则 |
| --- | --- | --- |
| `STALE_OPPORTUNITY_REMINDER_SCHEDULE_OBSERVATION_URL` | 是 | 完整观察入口 URL；远程环境必须为 HTTPS，路径必须以固定观察路由结尾，不允许 query、fragment 或 URL 内嵌账号密码 |
| `STALE_OPPORTUNITY_REMINDER_SCHEDULE_OBSERVATION_TOKEN` | 是 | 独立观察凭证；通过部署密钥管理注入 |
| `STALE_OPPORTUNITY_REMINDER_SCHEDULE_OBSERVATION_TIMEOUT_MS` | 否 | `1000..60000`；默认 `10000` |

Agent 服务端也需要相同的观察凭证来校验请求，但调度器与 Agent 应分别从密钥管理读取。URL
可以包含反向代理的基础路径，只要最终路径严格指向观察入口。本机联调允许
`http://127.0.0.1`、`http://localhost` 或 `http://[::1]`；远程地址拒绝明文 HTTP。

## 4. 上线前一次性检查

在尚未启用 cron 时，由部署环境执行：

```text
npm run test:schedule-observer
npm run observe:stale-opportunity-schedule
```

第二条命令只使用环境变量，不接受 URL 或 Token 命令行参数。输出为单行 JSON，仅包含
观察状态、trace、阻断代码、汇总数量和稳定 warning；不会回显 Token、Secret、业务名称或
记录标识。

当前真实业务条件下，预期结果是 `blocked`，因为历史治理、人工 Sender/执行开关和自然候选
仍未满足。不要为了得到 `ready` 而伪造跟进时间、批量修改历史商机、开启 Sender 或制造候选。

## 5. 退出码

| 退出码 | 状态 | 运维含义 |
| --- | --- | --- |
| `0` | `ready` | 观察与审计完整，准备度允许进入人工放行评估；仍不执行投递 |
| `2` | `blocked` | 观察完整，但业务/安全门禁仍阻断 |
| `3` | `incomplete` | 准备度已读取，但审计等证据不完整 |
| `4` | `unavailable` | 服务端无法完成准备度检查 |
| `10` | configuration | URL、Token 或超时配置无效 |
| `11` | timeout | 调用超时 |
| `12` | network | 网络调用失败 |
| `13` | http | 服务返回非 2xx；包括凭证错误或入口未装配 |
| `14` | invalid_response | 内容类型、JSON、字段、状态关系或响应大小不符合契约 |

`blocked` 使用独立非零退出码，便于调度平台把“系统正常但业务尚未放行”与 `ready` 分开处理。
监控规则可以把 `2` 设为业务阻断告警，把 `3..14` 设为运行故障；不要把任一非 `0` 结果继续
串接到执行入口。

## 6. 关闭状态的 cron 示例

仓库提供 [禁用示例](../examples/stale-opportunity-schedule-observation.cron.disabled)。示例中的
所有执行行都以 `#` 注释，不会创建或启用任务。平台最小调度间隔按 30 分钟设计；正式启用前
仍需产品负责人单独确认部署身份、密钥范围、固定 HTTPS 地址、日志去向和告警规则。

不要由应用代码在 Nest 启动钩子中创建 `setInterval`，也不要使用
`@Automation/@BindTrigger` 假装独立 Agent 已获得部署调度能力。

## 7. 故障处理与停用

1. 先按 JSON 中的 `category` 和退出码分类，不读取或打印凭证。
2. `13` 时检查服务是否部署、观察凭证是否在服务端和调度端一致；不得改用扫描/执行凭证。
3. `3` 时检查控制库和允许租户审计目标；不能忽略 `auditRecorded=false`。
4. `14` 时视为契约漂移或网关返回了非 JSON 页面，保持 fail closed。
5. 需要停用时，在外部调度平台禁用任务并撤销调度端观察凭证；无需修改业务数据，也不要打开
   真实投递开关。

日志可按 `traceId` 与控制库的
`stale_opportunity_reminder.schedule_observed.v1` 对账。输出不得转存到包含更高权限凭证的共享
日志上下文。
