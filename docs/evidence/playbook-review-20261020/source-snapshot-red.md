# 审核快照来源展示：Red 实录

运行时间：2026-10-20 22:54:48（本地时间）。

命令：`npm run test:agent -- tests/unit/playbook-draft-review-panel.spec.ts`

执行前仅新增两项回归测试，生产组件未修改。退出码 1，原始输出摘录：

```text
FAIL tests/unit/playbook-draft-review-panel.spec.ts > shows the frozen source references inside the reviewed version snapshot
AssertionError: expected '技术评审 · v1技术评审阶段核对双方技术接口与实际验收范围。版本说明：创…' to contain '来源版本'
Expected: "来源版本"
Received: "技术评审 · v1技术评审阶段核对双方技术接口与实际验收范围。版本说明：创建初版"

FAIL tests/unit/playbook-draft-review-panel.spec.ts > explicitly shows missing source records in the reviewed snapshot
AssertionError: expected '技术评审 · v1技术评审阶段核对双方技术接口与实际验收范围。版本说明：创…' to contain '无来源记录'
Expected: "无来源记录"
Received: "技术评审 · v1技术评审阶段核对双方技术接口与实际验收范围。版本说明：创建初版"

Test Files  1 failed (1)
     Tests  2 failed | 9 passed (11)
  Start at  22:54:48
  Duration  2.86s
```

此记录只证明来源展示修复的 Red 阶段。审核核心实现的原始 Red 输出独立收录于 `review-core-red.log`。
