import { randomUUID } from 'node:crypto';
import type { ControlStore } from '@server/modules/agent-core/agent.ports';
import type { IncomingCardAction, PendingAction, TenantIntegration } from '@server/modules/agent-core/agent.types';
import { parseTodayTaskConfirmation, parseTodayTaskForm } from './today-action-task-card';

interface TaskConfirmationExecutor {
  schedule(integration: TenantIntegration, action: PendingAction, callbackToken: string | null, traceId: string): void;
}

const confirmTodayTaskCard = async (
  control: Pick<ControlStore, 'getPendingAction' | 'acquirePendingAction'>,
  executor: TaskConfirmationExecutor,
  integration: TenantIntegration,
  incoming: IncomingCardAction,
): Promise<'executing' | 'succeeded'> => {
  const callback = parseTodayTaskConfirmation(incoming.value);
  if (callback.recipientOpenId !== incoming.operatorOpenId || !incoming.cardMessageId) {
    throw new Error('ACCESS_DENIED');
  }
  const pending = await control.getPendingAction(integration.tenantId, callback.actionId);
  if (!pending || pending.actorOpenId !== incoming.operatorOpenId ||
    pending.cardMessageId !== incoming.cardMessageId || pending.chatId !== incoming.chatId ||
    pending.payload.actionKind !== 'task') throw new Error('ACCESS_DENIED');
  if ((pending.payload.draftVersion ?? 1) !== callback.version) throw new Error('ACTION_CONFLICT');
  if (pending.status === 'succeeded') return 'succeeded';
  if (pending.status === 'executing') return 'executing';
  if (pending.status !== 'pendingConfirmation' || pending.expiresAt <= incoming.receivedAt) {
    throw new Error('ACTION_CONFLICT');
  }
  const form = parseTodayTaskForm(incoming.formValue);
  const payload = { ...pending.payload, draft: { ...pending.payload.draft,
    nextAction: form.title, dueAt: form.dueAt, nextActionChannel: form.channel,
    nextActionParticipants: form.participants } };
  const acquired = await control.acquirePendingAction(integration.tenantId, pending.id,
    incoming.operatorOpenId, ['pendingConfirmation'], incoming.receivedAt, payload, callback.version);
  if (!acquired) throw new Error('ACTION_CONFLICT');
  executor.schedule(integration, acquired, incoming.callbackToken, randomUUID());
  return 'executing';
};

export { confirmTodayTaskCard };
