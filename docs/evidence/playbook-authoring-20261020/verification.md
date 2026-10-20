# Playbook 版本草稿验证（2026-10-20）

本阶段完成已接受候选的人工草稿编写、不可变版本、历史、版本冲突和不确定保存恢复。正式发布、采用事件、赢丢单发现、真实登录 UAT 和整体剩余待办没有由本证据替代。规格见 [SDD 51](../../specs/51-playbook-authoring-sdd.md)。

## 自动化与质量门

| 检查 | 实际结果 |
|---|---|
| `npm run test:agent` | 127 文件、1118 项通过 |
| 草稿服务/控制器单元 | 30 项通过 |
| 草稿实际 React 组件交互 | 12 项通过 |
| 产品 API transport | 8 项通过，含新增的草稿读取/保存契约 2 项 |
| 隔离 PostgreSQL 全量集成 | 12 文件通过、1 文件跳过；74 项通过、3 个受控真实探针跳过 |
| 草稿 PostgreSQL/Nest HTTP 集成 | 15 项通过，计入上述 74 项 |
| 客户端、服务端、测试 TypeScript | 均通过 |
| `npm run lint` | 全库 ESLint、客户端/服务端 TypeScript、Stylelint 均通过 |
| 五个草稿相关测试文件显式 ESLint | 通过；使用 `--no-ignore` 覆盖测试目录 |
| `npm run build:agent` | 195 文件构建通过 |
| `npm run build:web` | 3052 模块构建通过，既有模块格式及大 chunk 提示仍存在 |
| `node --test scripts/agent-runtime-health.test.mjs` | 5/5 通过 |

服务和组件首批失败测试先于实现；后补回归不追认为 Red。全量单元首次发现迁移清单期望未包含 032，补齐后 focused 回归及全量 1118 项通过。单元故障注入产生的预期错误日志不代表额外真实服务调用；长期记忆仍默认关闭。

组件测试覆盖首次主动填写、相同 requestId/内容重试、不确定结果锁定、冲突读失败后恢复与明确选择、重复提交、历史分页与纯文本详情、未保存关闭确认、初始读取失败恢复、401/403/404 清除及关闭后的迟到保存隔离。产品 transport 检查 URL 编码、游标、CAS/幂等请求字段及 credentials。

## 隔离 PostgreSQL 与 HTTP

使用 PostgreSQL 17.7 专用集群 `127.0.0.1:55437`，数据目录为系统 Temp 下 `sales-agent-playbook-20261020`。不连接原 55432 业务集群。实际迁移器应用全部 29 项迁移，第二次全部跳过；就绪检查和迁移清单回归同步包含 032。

15 项草稿集成实际覆盖首次/后续并发竞争、CAS 冲突零写入、相同请求重放和变化拒绝、租户隔离、来源冻结、23 版分页与详情、最大 integer 版本首页边界、独立连接回读、作者删除保护及租户级联清理。来源由候选锁内读取，不接受客户端伪造。

Nest HTTP 以测试可信 session stub 注入身份，验证无身份/无权限拒绝、租户/作者/来源防伪、状态码、参数校验与 no-store；不是实际飞书 OAuth UAT。数据库错误脱敏，不返回原始错误。没有草稿版本更新/删除 API，没有 RAG 索引或外部发布。

重新连接持久回读通过，但没有执行本阶段 PostgreSQL 进程重启恢复测试。验证结束后已正常停止专用集群并回收前台测试会话，临时数据保留用于排查。

## 浏览器组件验证

实际开发路由 `/playbooks` 显示[飞书身份提示](identity-blocked.jpg)，未获得业务身份。原遗留 runtime 日志仍报告 `127.0.0.1:55432` 连接拒绝；本轮未恢复该数据库或重启原 Agent/Vite。入口可渲染不能证明后端健康或真实登录闭环。

在唯一自建标签页中，通过临时 iframe 动态导入实际 `PlaybookDraftWorkspace`、React 与项目样式，分别检查 1280x900 和 390x900 视口。夹具没有进入产品源码；临时 Axios adapter 仅接受 `local-ui-only` 候选的草稿路径，其余请求拒绝。截图带“合成数据”标识。

- [桌面编辑](draft-editor-desktop.jpg)和[窄屏编辑](draft-editor-mobile.jpg)：人工填写、保存 v1、修改正文及按钮布局。
- [桌面历史详情](draft-history-desktop.jpg)：读取 v1 正文、适用范围、作者、版本说明及冻结来源版本。
- [桌面冲突](draft-conflict-desktop.jpg)和[窄屏冲突](draft-conflict-mobile.jpg)：合成远端 v2，409 后本地正文保留、保存锁定；明确保留本地后，以 expectedVersion=2 保存 v3 成功。

几何检查：1280px 历史页根内容宽度/scrollWidth 均为 1280，dialog 宽 896；390px 根内容宽度/scrollWidth 均为 390，dialog x=16、宽=358，内容 clientWidth/scrollWidth 均为 341。编辑与冲突中的可见 input/textarea/button 没有超出视口。窄屏使用对话框内部纵向滚动，未出现不连贯重叠。

浏览器脚本错误为 0。共 6 次 adapter 调用（3 GET、3 POST），全部为合成路径；v1/v2/v3 只存在 iframe 内存。首次后台截图超时，前置自建标签页后重试成功；标签切换使用组件实际 mousedown 事件。验证后已恢复 adapter、卸载组件并关闭自建标签页，没有操作用户其他标签页。

## 仍待完成

真实消息 8/8、1 客户/1 商机/2 跟进/3 任务额度均已用满；本轮新增真实消息和业务写入为零。没有生产部署、权限扩张、管理员实际发布或新建 Agent。

真实身份/材料、今日行动样本与实际投递、语音/STT、长期记忆后端与评测、完整任务历史与独立兑现证据、Playbook 采用/发布/样本门槛及正式运行保障仍按[待办执行计划](../../remaining-capabilities-execution-2026-10-20.md)保留。代码里程碑由项目发布器在质量门通过后生成，不等同产品上线。
