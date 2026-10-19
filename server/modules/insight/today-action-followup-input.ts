import { todayTaskActionId } from './today-task-action-id';
import type { PendingActionPayload } from '@shared/api.interface';
import type { ControlStore, FeishuMessenger } from '@server/modules/agent-core/agent.ports';
import type { TenantIntegration } from '@server/modules/agent-core/agent.types';

interface FollowupInputScope {
  tenantId: string; memberId: string; actorOpenId: string; chatId: string;
  messageId: string; itemId: string; itemVersion: string; now: Date;
}

const openTodayFollowupInput = async (
  control: Pick<ControlStore, 'getPendingAction' | 'createPendingAction' | 'setPendingCardMessage'>,
  messenger: Pick<FeishuMessenger, 'updateCard' | 'sendConfirmationCard'>,
  integration: TenantIntegration,
  input: FollowupInputScope,
): Promise<void> => {
  const id: string = todayTaskActionId(input.tenantId, input.memberId,
    input.itemId, input.itemVersion, `chat-followup:${input.messageId}`);
  const existing = await control.getPendingAction(input.tenantId, id);
  if (existing && (existing.actorOpenId !== input.actorOpenId || existing.chatId !== input.chatId)) {
    throw new Error('ACCESS_DENIED');
  }
  const payload: PendingActionPayload = { version: 1, interactionStage: 'input',
    sourceMessageId: `today-action:${input.itemId}:${input.itemVersion}`, rawText: '',
    draftVersion: 0, taskCandidates: [], selectedTaskCandidateIds: [], inputForm: {},
    draft: { customerName: null, contactName: null, opportunityName: null,
      summary: '等待填写真实沟通内容', customerNeeds: [], objections: [], risks: [],
      progress: null, expectedAmount: null, nextAction: null, dueAt: null, evidenceQuotes: [],
      nextActionChannel: null, nextActionParticipants: [] } };
  const pending = existing ?? await control.createPendingAction({ id, tenantId: input.tenantId,
    actorOpenId: input.actorOpenId, chatId: input.chatId, payload,
    expiresAt: new Date(input.now.getTime() + 24 * 3600000) });
  if (pending.expiresAt <= input.now || pending.status !== 'pendingConfirmation' ||
    pending.payload.interactionStage !== 'input') {
    throw new Error('ACTION_CONFLICT');
  }
  if (pending.cardMessageId) {
    return;
  }
  const messageId: string = await messenger.sendConfirmationCard(integration, input.chatId, pending);
  await control.setPendingCardMessage(input.tenantId, pending.id, messageId);
};

export { openTodayFollowupInput };
