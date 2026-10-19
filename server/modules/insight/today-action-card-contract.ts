import { z } from 'zod';
import type { TodayActionState } from '@shared/api.interface';
import type { TodayActionOperationScope, TodayActionStateStore } from './today-action-state.store';

const todayActionCardActionSchema = z.object({
  action: z.literal('today_action'),
  operation: z.enum(['generate_followup', 'create_task', 'snooze', 'resolve']),
  itemId: z.string().trim().min(1).max(512),
  itemVersion: z.string().trim().min(1).max(128),
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  recipientOpenId: z.string().trim().min(1).max(256),
  idempotencyKey: z.string().trim().min(1).max(512),
  remindAt: z.string().datetime({ offset: true }).optional(),
}).strict().superRefine((value, context): void => {
  if (value.operation === 'snooze' && value.remindAt === undefined) {
    context.addIssue({ code: 'custom', path: ['remindAt'], message: 'Reminder time required' });
  }
});

type TodayActionCardAction = z.infer<typeof todayActionCardActionSchema>;
const parseTodayActionCardAction = (value: unknown): TodayActionCardAction =>
  todayActionCardActionSchema.parse(value);

interface TodayActionCardScope {
  operatorOpenId: string;
  itemId: string;
  itemVersion: string;
  revision: number;
}

// Scope must come from authenticated identity and a freshly read visible item.
const assertTodayActionCardScope = (
  action: TodayActionCardAction,
  scope: TodayActionCardScope,
): void => {
  if (action.recipientOpenId !== scope.operatorOpenId) throw new Error('ACCESS_DENIED');
  if (action.itemId !== scope.itemId || action.itemVersion !== scope.itemVersion ||
    action.expectedRevision !== scope.revision) throw new Error('ACTION_CONFLICT');
};

const applyTodayActionCardState = async (
  store: TodayActionStateStore,
  scope: TodayActionOperationScope,
  action: TodayActionCardAction,
  item: Omit<TodayActionCardScope, 'operatorOpenId'>,
  now: Date,
): Promise<TodayActionState> => {
  // The ledger checks revision only after replay lookup, so successful duplicate
  // callbacks can return their original result after the current revision moved.
  assertTodayActionCardScope(action, { ...item, revision: action.expectedRevision,
    operatorOpenId: scope.actorOpenId });
  if (action.operation !== 'snooze' && action.operation !== 'resolve') {
    throw new Error('CONFIRMATION_FLOW_REQUIRED');
  }
  return store.apply(scope, {
    itemId: action.itemId, itemVersion: action.itemVersion,
    expectedRevision: action.expectedRevision, operation: action.operation,
    idempotencyKey: action.idempotencyKey,
    ...(action.remindAt === undefined ? {} : { remindAt: action.remindAt }),
  }, now);
};

export { parseTodayActionCardAction, assertTodayActionCardScope, applyTodayActionCardState };
export type { TodayActionCardAction };
