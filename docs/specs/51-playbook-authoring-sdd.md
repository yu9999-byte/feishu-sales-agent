# Playbook 版本草稿 SDD / TDD

后续增量：发布与撤回能力见 [SDD 54](54-playbook-publication-sdd.md)；本文件保留草稿切片范围。

目标：已审核进入待编写的候选可由知识审核人主动编写、保存及回看版本。正式发布、采用统计、赢丢单样本发现不属于本切片。

## 契约与边界

- 三个接口均要求可信 Web Session 和 `playbook:review`；租户和作者从 session 注入。
- `GET /api/platform/playbook-candidates/:id/draft` 返回最新版本及每页 20 条历史摘要，`beforeVersion` 为排他游标；未创建返回空状态。
- `GET .../draft/versions/:version` 返回指定不可变版本。
- `POST .../draft/versions` 包含 requestId(UUID)、expectedVersion(0 表示首次)、title(2..120)、body(10..20000)、applicability(2..1000)、changeNote(2..500)，均 trim 后校验。
- 仅 accepted_for_authoring 可保存。候选行事务锁序列化首次及后续竞争；expectedVersion 不等返回 409 且零写入。版本限制 PostgreSQL integer 范围。
- requestId 在租户/候选内幂等，相同作者、expectedVersion 及规范化内容重放返回原版本；改变参数或作者返回 409。重放不读取当前来源重新生成版本。
- 每版从锁内候选冻结 source_refs，客户端不能注入来源。草稿由审核人主动填写，与自动观测的隐私约束分表；不复制问答、摘录，不成为 RAG 来源，不写飞书业务数据、不发送消息。
- 每候选连续整数版本；无更新/删除版本 API。候选/租户删除级联；作者 FK 使用延迟 NO ACTION 保留作者审计，租户删除经候选级联清理。停用成员不影响历史。
- 401/403/404/409/422/503；响应 no-store，数据库错误不返回原始内容。独立控制库增加迁移 032，并加入迁移器和就绪检查。

## 交互

已接受候选显示编写入口。编辑器分编辑和历史，显示当前版本及草稿状态；历史正文只读并按纯文本显示。保存期间锁定表单。失败保留本地输入；响应不确定时冻结原请求并可用相同 requestId 重试。409 先读取最新版本，明确选择使用远端或保留本地、以最新版本为基础再次保存。读取失败不允许绕过冲突继续保存。权限或身份失效清除内容，关闭/切换后忽略迟到响应；未保存关闭需明确确认。

## 验收清单

- [x] Red：服务和 UI 首批测试在模块/行为未实现时失败，再进入实现；后补集成和回归不追认为 Red。
- [x] Green：独立版本表、repository/service/controller 装配与 API。
- [x] Green：编辑、冲突选择、幂等重试、历史翻页和详情。
- [x] 隔离 PostgreSQL：两次迁移、首次/后续竞争、响应丢失重放、来源冻结、作者约束、租户清理、重新连接回读。
- [x] HTTP：身份、权限、状态、no-store 与参数防伪。
- [x] 三套类型、全量单元/集成、Lint 与双构建；1280px/390px 合成组件验证。
- [x] [证据归档](../evidence/playbook-authoring-20261020/verification.md)。代码检查点以项目发布器成功结果为准。
- [ ] 真实飞书身份下按角色完成 UAT；当前路由仅显示身份提示。

状态：Implemented。自动化和合成组件检查通过，不计作 UI Verified；正式发布、采用记录和赢丢单发现仍未实现。
