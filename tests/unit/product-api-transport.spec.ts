import { beforeEach, expect, it, vi } from 'vitest';
import type { TodayActionOperationRequest } from '../../shared/api.interface';

const transport = vi.hoisted(() => ({ send: vi.fn(), shortcut: vi.fn() }));
vi.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: transport.send,
}));
vi.mock('axios', () => ({ default: {
  isAxiosError: (): boolean => false,
  get: transport.shortcut, post: transport.shortcut, patch: transport.shortcut,
} }));
import { operateTodayAction, confirmTodayTaskDraft, updateFollowupDraft,
  createTodayFollowupDraft, createTodayTaskDraft } from '../../client/src/api';

beforeEach((): void => {
  transport.send.mockResolvedValue({ data: { accepted: true } });
  transport.shortcut.mockResolvedValue({ data: {} });
});

it('preserves the operation method, credentials and exact idempotent body', async (): Promise<void> => {
  const input: TodayActionOperationRequest = { itemId: 'opportunity:test',
    itemVersion: 'v1', expectedRevision: 0, operation: 'snooze',
    remindAt: '2026-10-18T12:00:00Z', idempotencyKey: 'test-key' };
  await operateTodayAction(input);
  expect(transport.send).toHaveBeenCalledWith({ method: 'POST',
    url: '/api/platform/today-actions/operations', data: input, withCredentials: true });
  expect(transport.shortcut).not.toHaveBeenCalled();
});

it('preserves task confirmation and encoded action identity', async (): Promise<void> => {
  await confirmTodayTaskDraft('action/1');
  expect(transport.send).toHaveBeenCalledWith({ method: 'POST',
    url: '/api/platform/today-actions/task-drafts/action%2F1/confirm',
    data: { expectedVersion: 1 }, withCredentials: true });
});

it('keeps followup and task draft bodies separate from transport configuration', async (): Promise<void> => {
  const input = { itemId: 'test', itemVersion: 'v1',
    idempotencyKey: 'draft-key', communicationText: '已发生的测试沟通' };
  await createTodayFollowupDraft(input);
  expect(transport.send).toHaveBeenLastCalledWith({ method: 'POST',
    url: '/api/platform/today-actions/followup-drafts', data: input, withCredentials: true });
  const task = { itemId: 'test', itemVersion: 'v1', idempotencyKey: 'task-key',
    title: '测试任务', dueAt: '2026-10-19T06:00:00Z', channel: '电话', participants: [] };
  await createTodayTaskDraft(task);
  expect(transport.send).toHaveBeenLastCalledWith({ method: 'POST',
    url: '/api/platform/today-actions/task-drafts', data: task, withCredentials: true });
});

it('retains PATCH revision semantics', async (): Promise<void> => {
  const input = { expectedVersion: 1, communicationText: '修订原文' };
  await updateFollowupDraft('draft/1', input);
  expect(transport.send).toHaveBeenCalledWith({ method: 'PATCH',
    url: '/api/platform/followup-drafts/draft%2F1', data: input, withCredentials: true });
});
