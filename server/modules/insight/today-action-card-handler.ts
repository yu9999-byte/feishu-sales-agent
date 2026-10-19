import type { TodayActionState } from '@shared/api.interface';
import type { TodayActionOperationScope, TodayActionStateStore } from './today-action-state.store';
import { applyTodayActionCardState, parseTodayActionCardAction } from './today-action-card-contract';

interface VisibleCardItem {
  itemId: string;
  itemVersion: string;
  revision: number;
}

interface TodayActionStateCallbackDependencies {
  ownsCard(scope: TodayActionOperationScope, messageId: string, value: unknown): Promise<boolean>;
  readVisibleItem(scope: TodayActionOperationScope, itemId: string): Promise<VisibleCardItem | null>;
  store: TodayActionStateStore;
}

// Caller supplies a scope resolved from the verified event and active membership.
const handleTodayActionStateCallback = async (
  dependencies: TodayActionStateCallbackDependencies,
  scope: TodayActionOperationScope,
  messageId: string,
  value: unknown,
  now: Date,
): Promise<TodayActionState> => {
  const action = parseTodayActionCardAction(value);
  if (action.recipientOpenId !== scope.actorOpenId || !messageId ||
    !await dependencies.ownsCard(scope, messageId, action)) throw new Error('ACCESS_DENIED');
  const item: VisibleCardItem | null = await dependencies.readVisibleItem(scope, action.itemId);
  if (item === null) throw new Error('ACTION_CONFLICT');
  return applyTodayActionCardState(dependencies.store, scope, action, item, now);
};

export { handleTodayActionStateCallback };
