# 待办本地收尾验证（2026-10-20）

本轮完成准备包保存/冲突恢复、unknown 投递核查界面和本地健康检查。整体待办尚未完成；真实登录 UAT、真实来源、剩余业务验收、语音、长期记忆、完整历史和 Playbook 扩展不能由本证据替代。

## 自动化与质量门

| 检查 | 结果 |
|---|---|
| npm run test:agent | 125 文件，1074 测试通过 |
| 隔离 PostgreSQL 全量集成 | 11 文件通过、1 文件跳过；59 测试通过、3 个受控真实探针跳过 |
| npm run test:runtime-health | 5/5 通过 |
| 服务端、客户端、测试 TypeScript | 均通过 |
| 全库 ESLint、Stylelint | 均通过 |
| npm run build:agent | 191 文件构建通过 |
| npm run build:web | 3047 模块构建通过；既有模块格式和大 chunk 提示仍存在 |

草稿/投递页面 34 项测试覆盖跨渠道版本共享、保存返回版本、冲突比较、输入保留、503 刷新、切换结果及迟到响应、重复点击、核查字段/版本、提交结果不确定后先回读、回读失败锁定，以及 401/403/404 清除缓存。新增权限失效与重复提交用例先失败后通过；后端及全部回归最终通过。

健康 HTTP 集成 4 项使用独立随机 schema：复制实际迁移器账本并确认完整/缺项响应，真实表锁验证超时及恢复，关闭连接验证存活不受影响。最初的驱动 cancel() 方案出现未处理 ECONNRESET；改为只读事务的数据库 statement_timeout 与独立 HTTP 截止时间后，集成干净通过，无全局异常抑制。

## 独立 runtime 验证

使用本机 PostgreSQL 17.7 的独立集群端口 55436、专用空业务库及实际 28 项迁移。模型 URL 指向本机关闭端口；飞书使用占位凭证和 webhook 模式；长期记忆、扫描、提醒、通知和投递开关均关闭。没有连接真实业务库、真实模型或飞书写接口。

完整编译产物在 127.0.0.1:3106 启动，测试 PID 3068。验证如下：

| 场景 | 实际结果 |
|---|---|
| 全量迁移、数据库可用 | health CLI 返回 ready，退出 0；启动脚本现有实例分支返回 ready |
| 停止专用数据库 | ready 返回 503、database=unavailable、Cache-Control=no-store；本次响应约 190ms；live 仍返回 200 alive |
| 停库时再次执行启动脚本 | 返回 not_ready 并抛出“Agent process is running but is not ready.”；3106 仍由原测试 PID 监听 |
| 重启专用数据库 | health CLI 恢复 ready，退出 0 |

后台 Start-Process 启动曾被自动审批以 blocked by policy 拒绝；改用可停止的前台 exec 会话完成同一隔离验证。原有 3100 Agent 与 5174 Vite 未重启或停止。临时 runtime 和专用 PostgreSQL 在验证结束后停止。

健康就绪只证明进程、数据库连接与所需迁移名，不证明飞书、模型、生产稳定性、备份或调度准时。

## 浏览器验证

实际开发入口 `/preparations/local-verification` 进入飞书身份提示，未获得业务身份，见 [身份限制](identity-blocked.jpg)。未绕过产品鉴权，也未将此结果计入真实登录 UAT。

在自建浏览器标签页中动态导入实际 Drafts 与 DeliveryPanel 组件，用临时 iframe 的 1280px 和 390px 视口、实际样式、合成数据检查布局。草稿保存/冲突回调仅在内存执行；投递读取通过仅允许 local-ui-only 路径的临时 Axios adapter 返回合成状态，所有其他请求拒绝。夹具未进入产品源代码；截图带“合成数据”标识。

- [草稿编辑桌面与窄屏](component-drafts-desktop-mobile.jpg)：双渠道、主题、正文和操作按钮均在容器内。
- [冲突恢复桌面与窄屏](component-conflict-desktop-mobile.jpg)：最新版比较和两种处理选择可见，未出现横向溢出。
- [投递核查桌面与窄屏](component-delivery-desktop-mobile.jpg)：unknown 状态和三个证据字段均在容器内。
- [核查字段错误](component-delivery-validation.jpg)：空白提交只产生字段验证提示，不发起确认调用。

DOM 几何检查：1280px 草稿 scrollWidth=1280；390px 含滚动条草稿内容宽度 375；投递内容宽度分别为 1280/390。输入框、文本域和按钮均在对应可用宽度内。此为组件渲染与合成本地交互证据，不是完整工作台移动设备或真实消息验收。验证后恢复临时 adapter、卸载夹具并关闭自建标签页。

## 未完成依赖

真实消息额度 8/8、1 客户/1 商机/2 跟进/3 任务均已用满，本轮新增真实消息和业务写入为零。仍需有效飞书身份与可读 Docx/Wiki/妙记样本、剩余真实验收额度、音频资源及 STT 服务、向量库及 Embedding 配置、可读取的连续任务历史与独立兑现证据契约、Playbook 版本及样本门槛规格。生产部署、权限扩张和管理员实际发布未执行。

后续顺序和每项完成条件见[执行计划](../../remaining-capabilities-execution-2026-10-20.md)。
