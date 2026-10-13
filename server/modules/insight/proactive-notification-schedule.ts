type ProactiveNotificationScheduleKind =
  | 'task_action'
  | 'opportunity_risk'
  | 'daily_report'
  | 'weekly_personal'
  | 'weekly_team';

interface ProactiveNotificationScheduleMatch {
  localDate: string | null;
  localWeekday: number | null;
  kinds: ProactiveNotificationScheduleKind[];
  warning?: 'invalid_timezone';
}

interface LocalClock {
  date: string;
  weekday: number;
  hour: number;
  minute: number;
}

interface ScheduleDefinition {
  kind: ProactiveNotificationScheduleKind;
  hour: number;
  minute: number;
  weekday?: number;
}

const WINDOW_MINUTES: number = 30;
const DEFINITIONS: ScheduleDefinition[] = [
  { kind: 'task_action', hour: 9, minute: 0 },
  { kind: 'opportunity_risk', hour: 10, minute: 0 },
  { kind: 'daily_report', hour: 17, minute: 0 },
  { kind: 'weekly_personal', hour: 17, minute: 0, weekday: 5 },
  { kind: 'weekly_team', hour: 17, minute: 5, weekday: 5 },
];

const localClock = (now: Date, timezone: string): LocalClock | null => {
  if (!Number.isFinite(now.getTime())) return null;
  try {
    const parts: Intl.DateTimeFormatPart[] = new Intl.DateTimeFormat(
      'en-US',
      {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      },
    ).formatToParts(now);
    const values: Map<string, string> = new Map(
      parts.map((part: Intl.DateTimeFormatPart): [string, string] => [
        part.type,
        part.value,
      ]),
    );
    const weekdayByName: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const weekdayName: string = values.get('weekday') ?? '';
    const weekday: number | undefined = weekdayByName[weekdayName];
    const year: string = values.get('year') ?? '';
    const month: string = values.get('month') ?? '';
    const day: string = values.get('day') ?? '';
    const hour: number = Number(values.get('hour'));
    const minute: number = Number(values.get('minute'));
    if (
      weekday === undefined || !/^\d{4}$/u.test(year) ||
      !/^\d{2}$/u.test(month) || !/^\d{2}$/u.test(day) ||
      !Number.isInteger(hour) || !Number.isInteger(minute)
    ) return null;
    return {
      date: `${year}-${month}-${day}`,
      weekday,
      hour,
      minute,
    };
  } catch (_error: unknown) {
    return null;
  }
};

const matches = (clock: LocalClock, definition: ScheduleDefinition): boolean => {
  if (
    definition.weekday !== undefined &&
    definition.weekday !== clock.weekday
  ) return false;
  const actualMinute: number = clock.hour * 60 + clock.minute;
  const scheduledMinute: number = definition.hour * 60 + definition.minute;
  return actualMinute >= scheduledMinute &&
    actualMinute < scheduledMinute + WINDOW_MINUTES;
};

const matchProactiveNotificationSchedules = (
  now: Date,
  timezone: string,
): ProactiveNotificationScheduleMatch => {
  const clock: LocalClock | null = localClock(now, timezone);
  if (clock === null) {
    return {
      localDate: null,
      localWeekday: null,
      kinds: [],
      warning: 'invalid_timezone',
    };
  }
  return {
    localDate: clock.date,
    localWeekday: clock.weekday,
    kinds: DEFINITIONS
      .filter((definition: ScheduleDefinition): boolean =>
        matches(clock, definition))
      .map(
        (definition: ScheduleDefinition): ProactiveNotificationScheduleKind =>
          definition.kind,
      ),
  };
};

export { matchProactiveNotificationSchedules };
export type {
  ProactiveNotificationScheduleKind,
  ProactiveNotificationScheduleMatch,
};
