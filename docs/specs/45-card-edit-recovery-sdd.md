# 飞书成功卡编辑恢复 SDD

状态：`Approved / Automated Green / UI pending / 2026-10-16`

关联：`EXE-007`、`EXE-010`、`BOT-14`、D-026。

## 1. 问题与证据

真实飞书 UI 中点击成功卡“编辑跟进”后，界面仍停留在成功卡。数据库审计已经出现
`card.edit_started`，新修订动作也取得了原卡 `message_id`，但界面没有出现修订表单。
原动作因失去卡片归属而无法再次处理同一个按钮，形成“界面未变化、后台已换状态”的死状态。

根因是编辑回调在换卡前先迁移卡片归属，随后只调用普通消息 patch；换卡失败时没有回滚、
没有失败审计，也没有可见提示。交互回调本身已经提供专用 callback token，应使用飞书互动
卡片延迟更新接口完成即时换卡。

## 2. 目标

1. 成功卡点击“编辑跟进”后，使用本次回调 token 将同一卡片替换为预填整表。
2. 换卡成功时，卡片归属保留在新修订动作，并记录成功审计。
3. 换卡失败时，原子恢复卡片归属到原终态动作，取消不可见修订动作，并记录脱敏失败原因。
4. 失败回调返回原结果卡并显示“编辑表单暂时未打开，可再次点击”的提示；原链接和按钮保留。
5. 重试不得修改原 Base 跟进或飞书任务，只有修订表单再次确认后才执行更新。

## 3. 非目标

- 不改变跟进、任务或商机关联的业务写入规则。
- 不新增 Web 编辑入口，不改变“同一聊天、同一卡片”产品决策。
- 不修改飞书应用权限、回调配置或正式定时任务。

## 4. 状态时序

```text
terminal action owns card
  -> create pending revision
  -> atomically move card ownership to revision
  -> update card through callback token
      -> success: revision owns card + card.edit_patch_succeeded
      -> failure: atomically move card back, cancel revision
                  + card.edit_patch_failed + retryable result card
```

回滚必须是单条存储语句或内存中的单个同步临界区，不允许出现原动作和修订动作同时持有卡片。

## 5. 端口增量

- `FeishuMessenger.updateCardByCallbackToken(...)`：调用
  `/open-apis/interactive/v1/card/update`，提交 callback token 和完整 Card 2.0 JSON。
- `ControlStore.rollbackPendingCardRevision(...)`：把卡片从待确认修订动作还给原终态动作，
  同时把修订动作标为 `cancelled`。

## 6. 验收

- callback token 更新使用完整卡片 JSON，错误响应不能误判成功。
- 单元测试证明成功换卡仍可修订原记录。
- 单元测试注入换卡失败，证明卡片归属恢复、修订动作取消、失败审计存在且可再次点击。
- 真实 UI 复测必须看到成功卡变为预填表单；若故障则看到可重试提示且第二次点击仍有效。

