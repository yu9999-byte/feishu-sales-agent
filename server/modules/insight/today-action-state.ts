import type { TodayActionOperationRequest, TodayActionState } from '@shared/api.interface';

const transitionTodayAction = (
  current: TodayActionState,
  request: TodayActionOperationRequest,
  now: Date,
): TodayActionState => {
  if (!Number.isSafeInteger(current.revision) || current.revision < 0 ||
    request.itemId !== current.itemId || request.itemVersion !== current.itemVersion ||
    request.expectedRevision !== current.revision) {
    throw new Error('ACTION_CONFLICT');
  }
  if (!Number.isFinite(now.getTime())) throw new Error('INVALID_REFERENCE_TIME');
  if (!request.idempotencyKey.trim()) throw new Error('INVALID_IDEMPOTENCY_KEY');
  if (request.operation === 'snooze') {
    const raw: string = request.remindAt ?? '';
    const day: string = raw.slice(0, 10);
    const calendarDate: Date = new Date(`${day}T00:00:00Z`);
    if (!Number.isFinite(calendarDate.getTime()) ||
      calendarDate.toISOString().slice(0, 10) !== day) {
      throw new Error('INVALID_REMINDER_TIME');
    }
    const timestamp: number = Date.parse(raw);
    if (!/(Z|[+-]\d{2}:\d{2})$/u.test(request.remindAt ?? '') ||
      !Number.isFinite(timestamp) || timestamp <= now.getTime()) {
      throw new Error('INVALID_REMINDER_TIME');
    }
    return { ...current, revision: current.revision + 1, status: 'snoozed',
      remindAt: new Date(timestamp).toISOString() };
  }
  if (request.operation === 'resolve') {
    return { ...current, revision: current.revision + 1, status: 'resolved', remindAt: null };
  }
  throw new Error('CONFIRMATION_FLOW_REQUIRED');
};

export { transitionTodayAction };





