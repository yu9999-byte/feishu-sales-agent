# 第 8 项：观察历史证据补验

日期：2026-10-21。关联 TASK-008/009、[SDD 53](../../specs/53-task-history-promise-evidence-sdd.md)。

## 修复结果

此前只有可信全量历史校验时间、范围及冲突；观察账本回退按时间排序后直接恢复终态，可能把未来事件、晚于观察时间的完成时间或同时刻相反状态采信为完成/仍未完成。现在两条路径共用事件有效性门禁：

- 验证非空、唯一事件标识和请求内的精确 GUID。
- 验证合法 UTC 时间、请求起止窗口；完成时间有效、大于零且不晚于事件发生时间。
- 完成事件必须有完成时间；重新打开事件必须无完成时间；同 GUID 同时刻存在不同状态时拒绝该批证据。
- 无效批次使本次待恢复的缺失任务对应承诺保留 `unknown`，覆盖为 `unavailable`，无任务变化输出，不计入完成或仍未完成。不能过滤掉无效新事件后再恢复旧终态。
- 正常观察完成/重新打开仍可恢复，覆盖仅为 `agent_observations`；不因此声称全量历史。

## 自动化证据

| 检查 | 实测结果 |
|---|---|
| 新增观察证据回归 | 17 项；先 15 失败/2 通过，修复后全部通过 |
| 历史、履约及任务网关定向回归 | 4 文件/53 项通过 |
| 全量单元 | 133 文件/1209 项通过 |
| 真实 PostgreSQL 和 Nest HTTP | 3 文件/21 项通过，其中新增历史恢复 5 项 |
| 类型 | 服务端、客户端、测试通过 |
| Lint | 全库 ESLint/Stylelint 通过 |
| Agent 构建 | 通过，204 个文件编译成功 |

原始[Red 日志](red.log)包含真实断言差异：未来事件恢复为 completed，同时刻冲突随输入顺序恢复为 completed 或 still_open。最终[全量 Green](unit-green.log)、[隔离集成 Green](integration-green.log)已归档。

新增 HTTP 集成使用真实 TaskFulfillmentController、TaskFulfillmentService 和 PostgresControlStore，并通过真实快照写入产生状态事件；验证正常完成、未来观察、完成时间晚于观察、同刻完成/重新打开冲突以及正常时序重新打开。Task API 和 Session 为明确的隔离测试夹具，不能视为有效飞书身份 UAT。测试在随机租户执行后删除自己的租户，应用和连接均关闭。

专用 PostgreSQL 17.7 集群位于临时目录 `sales-agent-playbook-20261020`。首次启动落在默认 loopback 5432，测试连接指定的 55437 被拒绝；随后停止该专用集群，以 `-p 55437 -h 127.0.0.1` 重启后完成验证。HTTP 种子 JSON 编码问题已修正，最后 21 项全部通过；没有访问 55432 业务库。已检查专用数据库日志，测试结束停止集群。原 runtime 仍有既有 55432 停库导致的 ECONNREFUSED，未处理。

本次只修改后端证据校验及测试/文档，未重做浏览器截图；前阶段页面和本人凭证验收仍见[原记录](../task-promise-evidence-20261020/verification.md)。

## 官方历史源核对

以下公开一手文档于本日通过 web-access 指引下的只读 HTTP 访问核对；没有调用业务 API、授权或订阅写入：

| 官方来源 | 可确认的能力与限制 |
|---|---|
| [顶层索引](https://open.feishu.cn/llms.txt) → [任务目录](https://open.feishu.cn/llms-docs/zh-CN/llms-tasks.txt) | 目录未列出任务全量状态历史回放接口；仅能说明本次公开文档检索结果，不能断言平台不存在其他能力 |
| [任务功能概述](https://open.feishu.cn/document/task-v2/task/overview.md) | 详情、更新、列取任务；完成/重新打开由 completed_at 标识，删除后无法操作或恢复 |
| [列取任务列表](https://open.feishu.cn/document/task-v2/task/list.md) | GET /open-apis/task/v2/tasks，只支持调用者“我负责的”任务，返回当前任务数据而非变化历史 |
| [列取动态订阅](https://open.feishu.cn/document/task-v2/tasklist-activity_subscription/list.md) | GET /open-apis/task/v2/tasklists/:tasklist_guid/activity_subscriptions，返回 guid/name/subscribers/include_keys/disabled，是订阅配置，不是事件回放 |

本地 CLI 任务命令和已安装 SDK 的 task/v2 声明亦未提供满足连续性证明要求的已确认历史来源。现有前向事件回执不记录订阅起点和连续游标，不补偿缺口，也不含可直接采信的本人完整终态历史。因此保持现有 FeishuTaskGateway 不实现 `readTaskHistory`。

## 仍待完成

- 接入实际可信历史源，并以真实身份、精确 GUID、覆盖窗口、无缺口和分页耗尽证明完成验收。
- 在有效飞书身份下验收任务页及本人凭证。独立声明仍不等于自动核验兑现。
- 本次没有新增真实飞书消息、客户/商机/跟进/任务写入、权限扩张或部署；第 8 项整体保持未完成。
