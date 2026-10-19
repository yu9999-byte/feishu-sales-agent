import { describe, expect, it } from 'vitest';

import { createProactiveNotificationCard } from
  '@server/modules/insight/proactive-notification.card';

describe('proactive notification card', (): void => {
  it('omits foreign recipient callbacks and caps the number of buttons', (): void => {
    const value = { action: 'today_action' as const, operation: 'resolve' as const,
      recipientOpenId: 'open', itemId: 'task:1', itemVersion: 'v1',
      expectedRevision: 0, idempotencyKey: 'stable' };
    const message = { tenantId: 'tenant', recipientMemberId: 'member',
      recipientOpenId: 'open', kind: 'task_action' as const, notificationKey: 'day',
      subjectKey: 'today', title: '今日行动', subtitle: '提醒', sections: [], payloadFingerprint: 'hash' };
    const foreign = createProactiveNotificationCard({ ...message,
      shortcuts: [{ label: 'foreign-button', value: { ...value, recipientOpenId: 'other' } }] });
    expect(JSON.stringify(foreign)).not.toContain('foreign-button');
    const bounded = createProactiveNotificationCard({ ...message,
      shortcuts: Array.from({ length: 12 }, (_, index) => ({ label: `button-${index}`, value })) });
    expect((JSON.stringify(bounded).match(/"type":"callback"/gu) ?? []).length).toBe(8);
    const otherKind = createProactiveNotificationCard({ ...message, kind: 'daily_report',
      shortcuts: [{ label: 'foreign-kind', value }] });
    expect(JSON.stringify(otherKind)).not.toContain('foreign-kind');
  });
  it('renders bounded recipient-bound callback shortcuts', (): void => {
    const value = { action: 'today_action' as const, operation: 'resolve' as const,
      recipientOpenId: 'open', itemId: 'task:1', itemVersion: 'v1',
      expectedRevision: 0, idempotencyKey: 'stable' };
    const card = createProactiveNotificationCard({ tenantId: 'tenant', recipientMemberId: 'member',
      recipientOpenId: 'open', kind: 'task_action', notificationKey: 'day', subjectKey: 'today',
      title: '今日行动', subtitle: '提醒', sections: [], payloadFingerprint: 'hash',
      shortcuts: [{ label: '标记已处理', value }],
    });
    expect(JSON.stringify(card)).toContain('"type":"callback"');
    expect(JSON.stringify(card)).toContain('stable');
  });
  it('renders Card 2.0 with bounded sections and a trusted HTTPS link', (): void => {
    const card = createProactiveNotificationCard({
      tenantId: 'tenant', recipientMemberId: 'member',
      recipientOpenId: 'open', kind: 'task_action',
      notificationKey: '2026-10-12', subjectKey: 'task-digest',
      title: '今日任务行动提醒', subtitle: '6 个任务需要关注',
      sections: [{
        title: '今日到期',
        lines: ['一', '二', '三', '四', '五', '六'],
      }],
      actionLabel: '查看任务履约',
      actionUrl: 'https://agent.example.com/tasks',
      payloadFingerprint: 'fingerprint',
    });
    const serialized: string = JSON.stringify(card);
    expect(card.schema).toBe('2.0');
    expect(serialized).toContain('"tag":"column_set"');
    expect(serialized).toContain('"tag":"button"');
    expect(serialized).not.toContain('"tag":"note"');
    expect(serialized).toContain('查看任务履约');
    expect(serialized).toContain('https://agent.example.com/tasks');
    expect(serialized).not.toContain('六');
  });

  it('drops non-HTTPS action links', (): void => {
    const serialized: string = JSON.stringify(createProactiveNotificationCard({
      tenantId: 'tenant', recipientMemberId: 'member',
      recipientOpenId: 'open', kind: 'daily_report',
      notificationKey: '2026-10-12', subjectKey: '2026-10-12',
      title: '销售日报', subtitle: '日报',
      sections: [{ title: '概览', lines: ['完成 1 条跟进'] }],
      actionLabel: '查看完整日报',
      actionUrl: 'http://unsafe.example.com/daily-report',
      payloadFingerprint: 'fingerprint',
    }));
    expect(serialized).not.toContain('unsafe.example.com');
  });
});
