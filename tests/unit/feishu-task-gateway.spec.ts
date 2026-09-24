import { describe, expect, it } from 'vitest';

import type { PendingAction } from '@server/modules/agent-core/agent.types';
import {
  resolveTaskInput,
} from '@server/modules/integrations/task/feishu-task.gateway';

const action: PendingAction = {
  id: '00000000-0000-4000-8000-000000000001',
  tenantId: '00000000-0000-4000-8000-000000000002',
  actorOpenId: 'ou_owner',
  chatId: 'oc_chat',
  cardMessageId: 'om_card',
  status: 'executing',
  payload: {
    version: 1,
    sourceMessageId: 'om_source',
    rawText: '来源',
    draft: {
      customerName: '北辰制造',
      contactName: '张总',
      opportunityName: '试点项目',
      summary: '客户认可方案',
      customerNeeds: [],
      objections: [],
      risks: [],
      progress: '方案认可',
      expectedAmount: null,
      nextAction: '旧草案动作',
      dueAt: '2026-09-20T18:00:00+08:00',
      evidenceQuotes: [],
    },
    taskCandidates: [{
      id: 'draft:v1:task:0',
      draftId: 'draft',
      draftVersion: 1,
      ownerMemberId: 'member-1',
      title: '安排现场技术交流',
      dueAt: '2026-09-22T14:00:00+08:00',
      channel: '客户现场',
      participants: ['张总', '售前王工'],
      customerName: '北辰制造',
      opportunityName: '试点项目',
      status: 'ready',
      missingFields: [],
    }],
    selectedTaskCandidateIds: ['draft:v1:task:0'],
  },
  result: {
    pendingActionId: '00000000-0000-4000-8000-000000000001',
    status: 'executing',
  },
  expiresAt: new Date('2026-09-23T00:00:00+08:00'),
  createdAt: new Date('2026-09-20T10:00:00+08:00'),
  updatedAt: new Date('2026-09-20T10:01:00+08:00'),
};

describe('Feishu task input mapping', (): void => {
  it('uses the exact selected preview including channel and participants', (): void => {
    expect(resolveTaskInput(action)).toEqual({
      title: '安排现场技术交流',
      dueAt: '2026-09-22T14:00:00+08:00',
      channel: '客户现场',
      participants: ['张总', '售前王工'],
    });
  });
});
