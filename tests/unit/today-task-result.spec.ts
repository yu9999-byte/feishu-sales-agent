import { expect, it } from 'vitest';
import { createResultCard } from '@server/modules/agent-core/agent.cards';

it('describes editing an existing task as an update', () => {
  const card = JSON.stringify(createResultCard({ pendingActionId: 'task-revision', status: 'succeeded',
    taskGuid: 'guid', taskAction: 'updated' }));
  expect(card).toContain('任务更新成功');
  expect(card).not.toContain('任务创建成功');
});

it('shows only the task outcome for standalone task success', () => {
  const card = JSON.stringify(createResultCard({ pendingActionId: 'task-one', status: 'succeeded',
    taskGuid: 'guid', taskUrl: 'https://applink.feishu.cn/client/todo/detail' }));
  expect(card).toContain('任务创建成功');
  expect(card).toContain('打开飞书任务');
  expect(card).toContain('编辑任务');
  expect(card).not.toContain('跟进登记成功');
  expect(card).not.toContain('客户和跟进已写入');
});

