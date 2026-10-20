# Playbook 发布前审核 SDD / TDD

后续增量：独立发布与撤回账本见 [SDD 54](54-playbook-publication-sdd.md)。审核状态本身仍不表示发布状态。

状态：Implemented / 自动化与隔离集成通过 / 真实身份 UAT pending（2026-10-20）。需求 BPA-003/004/007。范围是本地发布前审核，不是正式发布。

## 结果与边界

- `playbook:review` 可读取审核记录、提交最新且已保存的草稿；批准/退回额外要求 `playbook:publish`（现有策略仅 admin）。身份、租户、操作人来自可信 Web Session，每次重新授权，不接受客户端身份或角色。
- 提交、批准、退回均须 2..500 字说明，绑定不可变草稿版本。状态为 not_submitted / pending_review / approved / changes_requested / superseded；所有状态均未发布。
- 仅 accepted_for_authoring 候选可操作。首次提交或新版提交可产生 pending_review；已提交/批准/退回的同一版不能再提交，需先保存新版。仅当前最新版且最后事件为 submit 才能批准或退回。候选不再接受或出现新版时旧审核显示 superseded，历史不改写。
- 无正式发布/归档接口，无飞书写入、消息发送、RAG 索引、采用统计或赢丢单发现。

## 接口与持久化

- GET `/api/platform/playbook-candidates/:id/draft/review?beforeSequence=...`：一致性快照返回 latestDraftVersion、status、current（最后事件）、history（每页20条）、nextBeforeSequence。分页游标排他，不带全文正文；前端按事件版本另读不可变草稿。
- POST 同一路径：requestId(UUID)、expectedVersion(1..2147483647)、expectedReviewSequence(0..2147483646)、action(submit / approve / request_changes)、note。
- 迁移 033 的只追加事件表：每候选连续序号；记录 requestId、预期序号、绑定版本、动作、说明、操作人、服务端时间。无更新/删除 API；租户/候选删除级联，成员删除延迟 NO ACTION，保留审计。
- 事务内锁候选，与草稿保存串行；预期版本和审核序号双 CAS。冲突零写入。相同 requestId、版本、预期序号、动作、规范化说明、操作人重放返回原事件；改变参数/操作人 409。重放允许在新版之后回读原事件，不把原事件当成当前状态。
- 401/403/404/409/422/503，所有响应 no-store，数据库故障脱敏。

## 交互

沿用工作区 tabs 和现有 shadcn 控件，使用 ui-ux-pro-max 的可访问性/响应式检查。审核页展示精确版本的正文、适用范围、来源及说明；本地未保存、保存冲突、加载中、读取的当前版本不一致时禁用操作。批准/退回按钮仅管理员可见，说明必填，按钮明确表示裁决动作。

提交中锁定动作和说明；临时/未知失败冻结原请求，以相同 requestId 重试。409 丢弃原待重试请求，清空旧快照并锁住操作直到刷新成功，保留说明。成功后刷新当前状态；刷新失败也不得用旧状态继续操作。401/403/404 清除内容并通知父工作区；关闭/切换身份或候选忽略迟到响应。新增保存版本后重新读取审核。

## 验收

- [x] Red：已找到并原样归档原始审核服务/面板缺失与迁移 033 缺失的失败输出；来源展示修复另有 2 项先红后绿记录。
- [x] Green：共享类型、repository/service/controller、迁移及模块装配。
- [x] PostgreSQL：并发提交/裁决、双 CAS、幂等、跨租户、版本失效、分页和删除约束。
- [x] HTTP：可信身份、权限分离、防伪、错误码和 no-store。
- [x] 工作台交互自动化：快照、失败重试、冲突、权限失效和迟到响应。
- [x] 类型、Lint、全量单元/隔离集成和双构建。
- [x] 1280px/390px 真实审核面板合成浏览器截图与布局检查，含冻结来源、长标识、空说明禁用和有效说明启用。
- [ ] 真实飞书身份 UAT，外部条件未具备时仍 pending。

当前验证结果和真实身份限制见[审核验证记录](../evidence/playbook-review-20261020/verification.md)。独立审核面板的合成浏览器验证不等同于真实路由、工作区弹窗或真实身份 UAT；管理员批准也不代表正式发布。
