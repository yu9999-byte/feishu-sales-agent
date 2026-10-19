# 飞书成功卡编辑恢复 TDD

状态：`Green / UI pending / 2026-10-16`

## Red

1. `FeishuMessengerService` 必须使用 callback token 调用互动卡片更新接口，而不是仅依赖消息
   `message.patch`。
2. 注入编辑换卡失败时，工作流不得抛出并留下不可恢复状态；原动作必须重新持有原卡，失败修订
   必须取消，返回卡必须保留原结果和“可再次点击”提示。
3. 同一原成功卡在失败后再次点击，应创建新的修订并成功打开表单。

## Green

- 增加 callback-token 卡片更新端口与飞书实现。
- 增加 Postgres、MemoryStore 的原子回滚实现。
- 在 `editTerminalAction` 捕获换卡失败、回滚、审计并返回可重试结果卡。

## Verify

- 定向 Vitest：Messenger、Workflow、Card validation。
- PostgreSQL 集成测试覆盖卡片归属回滚。
- server/test TypeScript、相关 ESLint、Agent build、diff check。
- 重启 Agent 后执行真实 UI 复测；代码测试只作为辅助证据。

## Green 证据

- callback-token 卡片更新、失败回滚、重试保留和审计测试共 `114/114` 通过。
- 全量单元测试 `734/734`；PostgreSQL 集成 `33 passed / 3 controlled skips`。
- server/client/test TypeScript、全库 ESLint、Agent/Web build 和 `git diff --check` 通过。
- 当前结论仅为自动化 Green；必须在最新运行态重新点击真实卡片后才能升级为 UI Verified。

