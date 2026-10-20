import { describe, expect, it, vi } from 'vitest';

import type { TaskStatusEvent } from '@server/modules/agent-core/agent.types';
import { MemoryControlStore } from '@server/modules/agent-core/memory-control.store';
import { TaskFulfillmentService } from '@server/modules/insight/task-fulfillment.service';
import type { TaskFulfillmentResponse, PendingActionPayload } from '@shared/api.interface';
import { testIntegration } from '../fixtures/tenant-integration';

const NOW: Date = new Date('2026-10-21T04:00:00.000Z');
const payload: PendingActionPayload = {
  version: 1, sourceMessageId: 'message-a', rawText: 'Deliver proposal',
  draft: {
    customerName: null, contactName: null, opportunityName: null, summary: 'Proposal discussion',
    customerNeeds: [], objections: [], risks: [], progress: null, expectedAmount: null,
    nextAction: 'Deliver proposal', dueAt: null, evidenceQuotes: [],
  },
};
const completion = (patch: Partial<TaskStatusEvent> = {}): TaskStatusEvent => ({
  eventId: 'event-a', guid: 'guid-a', kind: 'completed', title: 'Deliver proposal', status: 'completed',
  completedAt: '2026-10-20T03:00:00.000Z', occurredAt: '2026-10-20T03:01:00.000Z', dueAt: null, url: null,
  previousTitle: null, previousStatus: 'todo', previousCompletedAt: null, previousDueAt: null,
  relatedTaskGuid: null, relation: null, ...patch,
});

const analyzeEvents = async (events: TaskStatusEvent[]): Promise<TaskFulfillmentResponse> => {
  const store: MemoryControlStore = new MemoryControlStore([testIntegration]);
  await store.createPendingAction({
    id: 'action-a', tenantId: testIntegration.tenantId, actorOpenId: 'ou-a', chatId: 'chat-a', payload,
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
  });
  await store.saveExecutionResult(testIntegration.tenantId, 'action-a', 'succeeded', {
    pendingActionId: 'action-a', status: 'succeeded', taskGuid: 'guid-a',
  });
  vi.spyOn(store, 'listTaskStatusEvents').mockResolvedValue({ items: events });
  return new TaskFulfillmentService({ listOwnedTasks: async () => ({ items: [] }) }, store).analyze({
    integration: testIntegration, actorOpenId: 'ou-a', referenceDate: '2026-10-21',
    timezone: 'Asia/Shanghai', now: NOW, readOnly: true,
  });
};

const expectUnknown = (report: TaskFulfillmentResponse): void => {
  expect(report.promises[0]).toMatchObject({
    status: 'task_lookup_unavailable', completionState: 'unknown', taskCompletedAt: null, taskTitle: null,
  });
  expect(report.coverage.taskHistory).toBe('unavailable');
  expect(report.metrics.completedPromiseCount).toBe(0);
  expect(report.metrics.stillOpenPromiseCount).toBe(0);
  expect(report.changes).toEqual([]);
  expect(report.warnings).toContain('任务状态历史包含无效或冲突证据，部分承诺待核实');
};

describe('task observation evidence reconciliation', (): void => {
  it('recovers valid completion without claiming complete history', async (): Promise<void> => {
    const report: TaskFulfillmentResponse = await analyzeEvents([completion()]);
    expect(report.coverage.taskHistory).toBe('agent_observations');
    expect(report.promises[0].completionState).toBe('completed');
    expect(report.metrics.completedPromiseCount).toBe(1);
  });

  it.each([
    ['future observation', { occurredAt: '2026-10-22T00:00:00.000Z' }],
    ['invalid observation time', { occurredAt: 'invalid' }],
    ['normalized invalid calendar date', { occurredAt: '2026-02-30T00:00:00.000Z' }],
    ['outside requested window', { occurredAt: '2026-01-01T00:00:00.000Z' }],
    ['completion after observation', { completedAt: '2026-10-20T03:02:00.000Z' }],
    ['nonpositive completion', { completedAt: '1970-01-01T00:00:00.000Z' }],
    ['invalid completion', { completedAt: 'invalid' }],
    ['missing completion', { completedAt: null }],
    ['reopening with completion', { kind: 'reopened', completedAt: '2026-10-20T03:00:00.000Z' }],
    ['blank event identity', { eventId: ' ' }],
    ['foreign task identity', { guid: 'guid-b' }],
  ] satisfies Array<[string, Partial<TaskStatusEvent>]>)(
    'keeps %s evidence unknown', async (_label: string, patch: Partial<TaskStatusEvent>): Promise<void> => {
      expectUnknown(await analyzeEvents([completion(patch)]));
    },
  );

  it.each([false, true])('rejects contradictory simultaneous states, reverse=%s', async (reverse: boolean) => {
    const events: TaskStatusEvent[] = [completion(), completion({
      eventId: 'event-b', kind: 'reopened', status: 'todo', completedAt: null,
    })];
    expectUnknown(await analyzeEvents(reverse ? events.reverse() : events));
  });

  it('rejects reused event IDs at different times', async (): Promise<void> => {
    expectUnknown(await analyzeEvents([completion(), completion({ occurredAt: '2026-10-20T04:00:00.000Z' })]));
  });

  it('does not revive an older terminal event after invalid newer evidence', async (): Promise<void> => {
    expectUnknown(await analyzeEvents([completion(), completion({
      eventId: 'event-b', kind: 'changed', occurredAt: 'invalid',
    })]));
  });

  it('uses valid chronological reopening evidence regardless of input order', async (): Promise<void> => {
    const report: TaskFulfillmentResponse = await analyzeEvents([completion(), completion({
      eventId: 'event-b', kind: 'reopened', status: 'todo', completedAt: null,
      occurredAt: '2026-10-20T04:00:00.000Z',
    })]);
    expect(report.coverage.taskHistory).toBe('agent_observations');
    expect(report.promises[0]).toMatchObject({ status: 'open_changed', completionState: 'still_open' });
    expect(report.metrics.completedPromiseCount).toBe(0);
  });
});
