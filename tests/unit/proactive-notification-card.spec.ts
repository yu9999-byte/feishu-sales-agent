import { describe, expect, it } from 'vitest';

import { createProactiveNotificationCard } from
  '@server/modules/insight/proactive-notification.card';

describe('proactive notification card', (): void => {
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
