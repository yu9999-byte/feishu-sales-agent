import { describe, expect, it } from 'vitest';

import type { FollowupTaskCandidate } from '@shared/api.interface';
import {
  defaultSelectedTaskIds,
  missingTaskFieldLabels,
  taskConfirmationLabel,
} from '../../client/src/pages/FollowupDraftPage/followup-task-selection';

const candidate = (
  id: string,
  status: FollowupTaskCandidate['status'],
  missingFields: FollowupTaskCandidate['missingFields'] = [],
): FollowupTaskCandidate => ({
  id,
  draftId: 'draft-1',
  draftVersion: 1,
  ownerMemberId: 'member-1',
  title: '发送实施计划',
  dueAt: status === 'ready' ? '2026-09-20T18:00:00+08:00' : null,
  channel: status === 'ready' ? '邮件' : null,
  participants: status === 'ready' ? ['张总'] : [],
  customerName: '北辰制造',
  opportunityName: null,
  status,
  missingFields,
});

describe('follow-up task selection view model', (): void => {
  it('selects only ready candidates by default', (): void => {
    expect(defaultSelectedTaskIds([
      candidate('ready', 'ready'),
      candidate('blocked', 'needs_input', ['channel']),
    ])).toEqual(['ready']);
  });

  it('uses human-readable labels for missing task details', (): void => {
    expect(missingTaskFieldLabels(['dueAt', 'channel', 'participants']))
      .toEqual(['时间', '地点/方式', '参与人']);
  });

  it('makes the one-confirmation consequence explicit', (): void => {
    expect(taskConfirmationLabel(1)).toBe('确认保存并创建所示待办');
    expect(taskConfirmationLabel(0)).toBe('确认保存（不创建待办）');
  });
});
