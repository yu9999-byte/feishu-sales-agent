import { beforeEach, expect, it, vi } from 'vitest';
import type {
  ConfirmPreparationDeliveryRequest,
  ConfirmPreparationDeliveryResponse,
  CustomerPreparationDeliveryStatus,
  TodayActionOperationRequest,
  SavePlaybookDraftRequest,
  RecordPlaybookDraftReviewRequest,
  UpdateFollowupDraftRequest,
} from '../../shared/api.interface';

const transport = vi.hoisted(() => ({ send: vi.fn(), shortcut: vi.fn() }));
vi.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: transport.send,
}));
vi.mock('axios', () => ({ default: {
  isAxiosError: (): boolean => false,
  get: transport.shortcut, post: transport.shortcut, patch: transport.shortcut,
} }));
import { operateTodayAction, confirmTodayTaskDraft, updateFollowupDraft,
  createTodayFollowupDraft, createTodayTaskDraft,
  getCustomerPreparationDelivery, confirmCustomerPreparationDelivery,
  getPlaybookDraft, getPlaybookDraftVersion, savePlaybookDraft } from '../../client/src/api';
import { getPlaybookDraftReview, recordPlaybookDraftReview } from '../../client/src/api';

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
  const input: UpdateFollowupDraftRequest = {
    expectedVersion: 1, generatedBody: '修订原文',
    draft: {
      customerName: null, contactName: null, opportunityName: null,
      summary: '修订摘要', customerNeeds: [], objections: [], risks: [],
      progress: null, expectedAmount: null, nextAction: null,
      dueAt: null, evidenceQuotes: [],
    },
  };
  await updateFollowupDraft('draft/1', input);
  expect(transport.send).toHaveBeenCalledWith({ method: 'PATCH',
    url: '/api/platform/followup-drafts/draft%2F1', data: input, withCredentials: true });
});

it('reads persisted preparation delivery without side effects', async (): Promise<void> => {
  const status: CustomerPreparationDeliveryStatus = { status: 'unknown',
    reconciliationVersion: 2 };
  transport.send.mockResolvedValueOnce({ data: status });
  await expect(getCustomerPreparationDelivery('result/1')).resolves.toEqual(status);
  expect(transport.send).toHaveBeenCalledWith({ method: 'GET',
    url: '/api/platform/customer-communications/results/result%2F1/delivery',
    withCredentials: true });
});

it('confirms only the supplied preparation delivery evidence with session credentials', async (): Promise<void> => {
  const input: ConfirmPreparationDeliveryRequest = {
    expectedVersion: 2,
    messageId: 'om_message_verified',
    sentAt: '2026-10-19T12:00:00+08:00',
    note: '已在原飞书会话核实该消息发送成功',
  };
  const response: ConfirmPreparationDeliveryResponse = {
    status: 'sent', updatedAt: '2026-10-19T04:10:00.000Z',
  };
  transport.send.mockResolvedValueOnce({ data: response });
  await expect(confirmCustomerPreparationDelivery('result/1', input))
    .resolves.toEqual(response);
  expect(transport.send).toHaveBeenLastCalledWith({ method: 'POST',
    url: '/api/platform/customer-communications/results/result%2F1/delivery/confirm',
    data: input, withCredentials: true });
});

it('reads draft history and version details with encoded identity and session credentials', async (): Promise<void> => {
  await getPlaybookDraft('candidate/1', 21);
  expect(transport.send).toHaveBeenLastCalledWith({ method: 'GET',
    url: '/api/platform/playbook-candidates/candidate%2F1/draft',
    params: { beforeVersion: 21 }, withCredentials: true });
  await getPlaybookDraftVersion('candidate/1', 20);
  expect(transport.send).toHaveBeenLastCalledWith({ method: 'GET',
    url: '/api/platform/playbook-candidates/candidate%2F1/draft/versions/20', withCredentials: true });
});

it('preserves draft compare-and-swap and idempotent request body', async (): Promise<void> => {
  const input: SavePlaybookDraftRequest = { title: '技术评审', body: '明确双方接口与技术验收标准。',
    applicability: '技术评审阶段', changeNote: '补充验收范围', expectedVersion: 3, requestId: 'request-1' };
  await savePlaybookDraft('candidate/1', input);
  expect(transport.send).toHaveBeenLastCalledWith({ method: 'POST',
    url: '/api/platform/playbook-candidates/candidate%2F1/draft/versions',
    data: input, withCredentials: true });
  expect(transport.shortcut).not.toHaveBeenCalled();
});

it('reads paged review history and records the exact idempotent review request', async (): Promise<void> => {
  await getPlaybookDraftReview('candidate/1', 21);
  expect(transport.send).toHaveBeenLastCalledWith({ method: 'GET',
    url: '/api/platform/playbook-candidates/candidate%2F1/draft/review',
    params: { beforeSequence: 21 }, withCredentials: true });
  const input: RecordPlaybookDraftReviewRequest = {
    requestId: 'request-1', expectedVersion: 3, expectedReviewSequence: 2,
    action: 'approve', note: '已核对范围和证据',
  };
  await recordPlaybookDraftReview('candidate/1', input);
  expect(transport.send).toHaveBeenLastCalledWith({ method: 'POST',
    url: '/api/platform/playbook-candidates/candidate%2F1/draft/review',
    data: input, withCredentials: true });
  expect(transport.shortcut).not.toHaveBeenCalled();
});
