import { todayTaskActionId } from './today-task-action-id';
import type { ControlStore, FeishuMessenger } from '@server/modules/agent-core/agent.ports';
import type { TenantIntegration } from '@server/modules/agent-core/agent.types';
import type { TodayActionViewItem } from '@shared/api.interface';

const openTodayTaskDraft = async (
  control: Pick<ControlStore, 'getPendingAction' | 'createPendingAction' | 'setPendingCardMessage'>,
  messenger: Pick<FeishuMessenger, 'sendConfirmationCard'>,
  integration: TenantIntegration,
  input: { memberId: string; actorOpenId: string; chatId: string; messageId: string;
    item: TodayActionViewItem; now: Date },
): Promise<void> => {
  const id: string = todayTaskActionId(integration.tenantId, input.memberId,
    input.item.id, input.item.version, `chat-task:${input.messageId}`);
  const existing = await control.getPendingAction(integration.tenantId, id);
  const pending = existing ?? await control.createPendingAction({ id, tenantId: integration.tenantId,
    actorOpenId: input.actorOpenId, chatId: input.chatId,
    expiresAt: new Date(input.now.getTime() + 24 * 3600000), payload: {
      version: 1, actionKind: 'task', draftVersion: 1, interactionStage: 'draft',
      sourceMessageId: `today-action:${input.item.id}:${input.item.version}`, rawText: input.item.reason,
      draft: { customerName: null, contactName: null, opportunityName: null,
        summary: input.item.reason, customerNeeds: [], objections: [], risks: [],
        progress: null, expectedAmount: null, nextAction: input.item.suggestedAction,
        dueAt: null, evidenceQuotes: [], nextActionChannel: null, nextActionParticipants: [] },
    } });
  if (pending.actorOpenId !== input.actorOpenId || pending.chatId !== input.chatId ||
    pending.payload.actionKind !== 'task') throw new Error('ACCESS_DENIED');
  if (pending.status !== 'pendingConfirmation' || pending.expiresAt <= input.now) throw new Error('ACTION_CONFLICT');
  if (pending.cardMessageId) return;
  const messageId: string = await messenger.sendConfirmationCard(integration, input.chatId, pending);
  await control.setPendingCardMessage(integration.tenantId, pending.id, messageId);
};

export { openTodayTaskDraft };
