import { describe, expect, it } from 'vitest';

import type {
  FollowupDraft,
  FollowupTaskCandidate,
} from '@shared/api.interface';
import {
  buildFollowupTaskCandidates,
} from '@server/modules/sales-behavior/followup-task-preview';

const draft = (overrides: Partial<FollowupDraft> = {}): FollowupDraft => ({
  customerName: '北辰制造',
  contactName: '张总',
  opportunityName: '数字化项目',
  summary: '客户认可试点方案。',
  customerNeeds: ['华东工厂先试点'],
  objections: [],
  risks: [],
  progress: '方案已认可',
  expectedAmount: 500000,
  nextAction: '发送实施计划',
  dueAt: '2026-09-20T18:00:00+08:00',
  evidenceQuotes: ['发送实施计划'],
  nextActionChannel: '邮件',
  nextActionParticipants: ['张总'],
  ...overrides,
});

describe('followup task preview', (): void => {
  it('binds a ready candidate to the exact draft version', (): void => {
    const candidates: FollowupTaskCandidate[] = buildFollowupTaskCandidates({
      draftId: 'draft-1',
      version: 3,
      ownerMemberId: 'member-1',
      draft: draft(),
      now: new Date('2026-09-20T10:00:00+08:00'),
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        id: 'draft-1:v3:task:0',
        draftId: 'draft-1',
        draftVersion: 3,
        ownerMemberId: 'member-1',
        title: '发送实施计划',
        dueAt: '2026-09-20T18:00:00+08:00',
        channel: '邮件',
        participants: ['张总'],
        status: 'ready',
        missingFields: [],
      }),
    ]);
  });

  it('only requires the next-step time to create the seller task', (): void => {
    const candidates: FollowupTaskCandidate[] = buildFollowupTaskCandidates({
      draftId: 'draft-2',
      version: 1,
      ownerMemberId: 'member-1',
      draft: draft({
        dueAt: null,
        nextActionChannel: null,
        nextActionParticipants: [],
      }),
      now: new Date('2026-09-20T10:00:00+08:00'),
    });

    expect(candidates[0]).toMatchObject({
      status: 'needs_input',
      missingFields: ['dueAt'],
    });
  });

  it('allows a task without an execution channel or participants', (): void => {
    const candidates: FollowupTaskCandidate[] = buildFollowupTaskCandidates({
      draftId: 'draft-optional-details',
      version: 1,
      ownerMemberId: 'member-1',
      draft: draft({
        nextActionChannel: null,
        nextActionParticipants: [],
      }),
      now: new Date('2026-09-20T10:00:00+08:00'),
    });

    expect(candidates[0]).toMatchObject({
      status: 'ready',
      channel: null,
      participants: [],
      missingFields: [],
    });
  });

  it('returns no candidate when the seller explicitly has no next step', (): void => {
    const candidates: FollowupTaskCandidate[] = buildFollowupTaskCandidates({
      draftId: 'draft-3',
      version: 2,
      ownerMemberId: 'member-1',
      draft: draft({ nextAction: null }),
      now: new Date('2026-09-20T10:00:00+08:00'),
    });

    expect(candidates).toEqual([]);
  });

  it('does not mark a task executable when its due time has passed', (): void => {
    const candidates: FollowupTaskCandidate[] = buildFollowupTaskCandidates({
      draftId: 'draft-overdue',
      version: 1,
      ownerMemberId: 'member-1',
      draft: draft({ dueAt: '2020-09-19T18:00:00+08:00' }),
      now: new Date('2026-09-21T10:00:00+08:00'),
    });

    expect(candidates[0]).toMatchObject({
      status: 'needs_input',
      missingFields: ['pastDueAt'],
    });
  });
});
