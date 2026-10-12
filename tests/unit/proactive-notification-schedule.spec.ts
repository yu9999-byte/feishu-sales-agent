import { describe, expect, it } from 'vitest';

import {
  matchProactiveNotificationSchedules,
} from '@server/modules/insight/proactive-notification-schedule';

describe('proactive notification schedule', (): void => {
  it('matches each tenant in its own timezone and 30 minute window', (): void => {
    expect(matchProactiveNotificationSchedules(
      new Date('2026-10-12T01:05:00.000Z'),
      'Asia/Shanghai',
    )).toEqual({
      localDate: '2026-10-12',
      localWeekday: 1,
      kinds: ['task_action'],
    });
    expect(matchProactiveNotificationSchedules(
      new Date('2026-10-12T13:05:00.000Z'),
      'America/New_York',
    ).kinds).toEqual(['task_action']);
    expect(matchProactiveNotificationSchedules(
      new Date('2026-10-12T01:30:00.000Z'),
      'Asia/Shanghai',
    ).kinds).toEqual([]);
  });

  it('matches reports and Friday weekly reports without cross-day drift', (): void => {
    expect(matchProactiveNotificationSchedules(
      new Date('2026-10-16T10:05:00.000Z'),
      'Asia/Shanghai',
    )).toEqual({
      localDate: '2026-10-16',
      localWeekday: 5,
      kinds: ['daily_report'],
    });
    expect(matchProactiveNotificationSchedules(
      new Date('2026-10-16T09:05:00.000Z'),
      'Asia/Shanghai',
    ).kinds).toEqual(['weekly_personal', 'weekly_team']);
  });

  it('returns an explicit invalid result for an invalid timezone', (): void => {
    expect(matchProactiveNotificationSchedules(
      new Date('2026-10-12T01:05:00.000Z'),
      'Mars/Olympus',
    )).toEqual({
      localDate: null,
      localWeekday: null,
      kinds: [],
      warning: 'invalid_timezone',
    });
  });
});
