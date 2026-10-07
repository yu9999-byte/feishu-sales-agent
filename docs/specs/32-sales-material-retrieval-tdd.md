# 销售资料检索与推荐 Agent v1 TDD

日期：2026-10-07  
状态：`Green / automated implementation complete / real source not configured / UI pending`

关联 SDD：
[销售资料检索与推荐 Agent v1 SDD](31-sales-material-retrieval-sdd.md)。

## 1. Red 场景

1. 无 `knowledge.sources` 配置时不调用飞书适配器，返回 `not_configured`，原材料需求仍为
   `material_pending`。
2. 白名单 schema 拒绝空 ID、非 HTTPS URL、未知来源类型、空 token、空适用边界、空关键词和
   空分类；不接受“扫描全部”配置。
3. Docx 来源依次读取公开权限、直接协作者、文档元数据和纯文本，版本来自 `revision_id`。
4. Docx 只有 bot/app 协作者、群、部门或未知 ACL 时返回 access denied，且不读取正文。
5. Wiki 来源先解析节点和空间，再验证公开空间或当前销售直接成员；只接受映射到 `docx` 的节点。
6. Wiki 私有空间不含当前销售、节点失效、对象类型不支持或 ACL 查询失败时不泄露元数据。
7. 文档、Wiki API 非零 code、缺少关键字段或正文为空时返回受控来源失败。
8. 检索仅用材料需求和已引用事实；按真实标题、配置关键词和正文命中排序，最多 3 条且去重。
9. 推荐结果包含真实标题、类型、URL、命中理由、原文摘录、正文段落、版本、适用边界、
   `accessVerified: true` 和业务来源键。
10. 配置存在但无命中时返回 `no_trusted_match` 和“未找到可信材料”；部分来源失败且仍有结果时
    返回 `partial`；全部读取失败时返回 `unavailable`。
11. `empty/unavailable` 客户攻略不检索资料，避免通过资料标题反向泄露客户意图。
12. Controller 在原三项权限外要求 `playbook:read`，权限缺失时资料服务零调用。
13. 前端 helper 覆盖五种检索状态、两种材料状态和两类资料来源文案。
14. 页面渲染真实链接、摘录、引用和适用边界；无可信结果显示明确空态，且源码不出现发送、
    保存、建任务或业务写回调用。
15. 测试桩只提供只读资料端口，证明服务没有任何资料或业务写入依赖。

## 2. 回归范围

- 客户沟通内容准备原目标、角度、问题、飞书/邮件草稿和事实引用保持不变。
- 客户拜访攻略、个人/主管商机决策、任务履约、日报、主管复盘和 P0 跟进闭环保持通过。
- 未配置白名单的所有既有租户自动进入 `not_configured`，不因配置升级启动外部读取。
- Agent 全量、Postgres 集成、GitHub 发布器、调度客户端、三套 TypeScript、全仓 Lint、双构建、
  迁移连续两次幂等和完整 Nest 启动均纳入最终质量门。

## 3. 完成证据模板

- 有效 Red：新增契约、适配器、检索服务和页面测试在实现前因符号/行为缺失而失败。
- Green：记录专项与合并回归测试数量，证明权限拒绝、来源失败、无结果和零副作用路径。
- 质量门：记录全量用例数、三套 TypeScript、Lint、构建、迁移和启动冒烟结果。
- 运行边界：若没有真实白名单或飞书读取权限，明确记录“自动化实现完成、真实资料源未配置”，
  不将 mock 或 UI pending 写成真实生产验收。

## 4. 最终结果

- 有效 Red 已先于实现运行；缺失的配置契约、飞书网关、检索服务、共享响应字段和页面状态均按
  预期失败，随后以最小只读闭环转 Green。
- 专项 `30/30`、Agent 全量 `567/567`、Postgres `20/20` 通过；三套 TypeScript、ESLint、统一
  Lint、Stylelint、Agent/Web 构建、两次迁移和完整 Nest 启动冒烟通过。
- 当前真实环境没有任何 `knowledge.sources`，所以只验证到诚实的 `not_configured` 运行边界；
  真实 Docx/Wiki 读取和 UI 验收等待管理员提供明确批准且销售可读的白名单来源。
