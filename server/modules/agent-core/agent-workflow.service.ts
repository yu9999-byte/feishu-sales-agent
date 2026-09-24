import {
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type {
  ConfirmationCardAction,
  FollowupCardFormInput,
  FollowupDraft,
  JsonObject,
  JsonValue,
  PendingActionStatus,
} from '@shared/api.interface';
import {
  CONTROL_STORE,
  CONVERSATION_ASSISTANT,
  FEISHU_MESSENGER,
  FOLLOWUP_EXTRACTOR,
} from './agent.ports';
import type {
  ControlStore,
  ConversationAssistant,
  FeishuMessenger,
  FollowupExtractor,
} from './agent.ports';
import {
  createAlreadyHandledCard,
  createCancelledCard,
  createConfirmationCard,
  createDraftGenerationProcessingCard,
  createProcessingCard,
} from './agent.cards';
import { FollowupChatDraftService } from '@server/modules/sales-behavior/followup-chat-draft.service';
import type {
  AgentSession,
  ConversationContext,
  ConversationDecision,
  ConversationInput,
  IncomingCardAction,
  IncomingMessage,
  PendingAction,
  TenantIntegration,
} from './agent.types';
import { parseConfirmationCardAction } from './agent.validation';
import { AgentActionExecutorService } from './agent-action-executor.service';
import {
  redactErrorMessage,
  redactErrorStack,
} from './agent.redaction';
import {
  LONG_TERM_MEMORY,
  type LongTermMemoryPort,
} from '@server/modules/llm/long-term-memory.port';

const SESSION_TTL_MS = 30 * 60 * 1000;
const ACTION_TTL_MS = 24 * 60 * 60 * 1000;
const CANCEL_CARD_PATCH_DELAY_MS = 1_000;
const CONVERSATION_WAITING_TEXT = '正在组织回答…';
const MESSAGE_FAILURE_TEXT =
  '这条消息暂时没有处理成功，请稍后再试。业务数据尚未写入。';

interface ReplyToConversationOptions {
  context?: ConversationContext;
  clarificationContext?: ConversationInput['clarificationContext'];
  decision?: ConversationDecision;
  forceFollowupClarification?: boolean;
  waitingMessageId?: string | null;
}

@Injectable()
export class AgentWorkflowService {
  private readonly logger: Logger = new Logger(AgentWorkflowService.name);

  constructor(
    @Inject(CONTROL_STORE)
    private readonly store: ControlStore,
    @Inject(FOLLOWUP_EXTRACTOR)
    private readonly extractor: FollowupExtractor,
    @Inject(CONVERSATION_ASSISTANT)
    private readonly conversation: ConversationAssistant,
    @Inject(FEISHU_MESSENGER)
    private readonly messenger: FeishuMessenger,
    private readonly executor: AgentActionExecutorService,
    private readonly chatDrafts: FollowupChatDraftService,
    @Optional()
    @Inject(LONG_TERM_MEMORY)
    private readonly longTermMemory?: LongTermMemoryPort,
  ) {}

  async handleMessage(message: IncomingMessage): Promise<void> {
    const integration: TenantIntegration | null =
      await this.store.resolveTenant(message.feishuTenantKey);
    if (!integration || integration.status !== 'active') {
      return;
    }

    if (!this.isSupportedMessage(message)) {
      await this.store.appendAudit({
        tenantId: integration.tenantId,
        traceId: message.messageId,
        eventType: 'message.ignored',
        actorOpenId: message.senderOpenId,
        outcome: 'ignored',
        details: {
          chatType: message.chatType,
          messageType: message.messageType,
          senderType: message.senderType,
        },
      });
      return;
    }

    const claimed: boolean = await this.store.claimMessage(
      integration.tenantId,
      message.messageId,
    );
    if (!claimed) {
      return;
    }

    try {
      await this.processMessage(integration, message, {
        tenantId: integration.tenantId,
        actorOpenId: message.senderOpenId,
        chatId: message.chatId,
        sourceMessageId: message.messageId,
      });
    } catch (error: unknown) {
      await this.handleMessageFailure(integration, message, error);
    }
  }

  async handleCardAction(action: IncomingCardAction): Promise<JsonObject> {
    const integration: TenantIntegration | null =
      await this.store.resolveTenant(action.feishuTenantKey);
    if (!integration || integration.status !== 'active') {
      return this.createAccessDeniedCard('当前企业尚未配置销售 Agent。');
    }

    if (
      action.actionName?.startsWith('review_followup_v') ||
      action.actionName?.startsWith('confirm_followup_v')
    ) {
      return this.handleDraftFormAction(integration, action);
    }
    if (action.actionName === 'submit_followup_input') {
      return this.handleInputFormAction(integration, action);
    }

    let cardAction: ConfirmationCardAction;
    try {
      cardAction = parseConfirmationCardAction(action.value);
    } catch {
      await this.store.appendAudit({
        tenantId: integration.tenantId,
        traceId: action.eventId,
        eventType: 'card.invalid',
        actorOpenId: action.operatorOpenId,
        outcome: 'failed',
        details: {
          reason: 'invalid_action_payload',
        },
      });
      return this.createAccessDeniedCard('卡片操作参数无效，请重新发送跟进。');
    }

    const pending: PendingAction | null =
      await this.store.getPendingAction(
        integration.tenantId,
        cardAction.pendingActionId,
      );
    const cardMatches: boolean = pending !== null &&
      pending.actorOpenId === action.operatorOpenId &&
      pending.cardMessageId !== null &&
      action.cardMessageId === pending.cardMessageId &&
      action.chatId !== null &&
      pending.chatId === action.chatId;
    if (!cardMatches) {
      await this.store.appendAudit({
        tenantId: integration.tenantId,
        traceId: action.eventId,
        eventType: 'card.forbidden',
        actorOpenId: action.operatorOpenId,
        entityId: cardAction.pendingActionId,
        outcome: 'failed',
        details: { reason: 'action_or_card_scope_mismatch' },
      });
      return this.createAccessDeniedCard('这张卡片不属于当前用户或租户。');
    }

    if (cardAction.action === 'cancel') {
      return this.cancelAction(
        integration,
        pending,
        action,
      );
    }

    if (cardAction.action === 'edit') {
      return this.editTerminalAction(integration, pending, action);
    }

    const allowedStatuses: PendingActionStatus[] =
      cardAction.action === 'retry'
        ? ['failed', 'partialFailure']
        : ['pendingConfirmation'];
    const acquired: PendingAction | null =
      await this.store.acquirePendingAction(
        integration.tenantId,
        pending.id,
        action.operatorOpenId,
        allowedStatuses,
        action.receivedAt,
      );

    if (!acquired) {
      const current: PendingAction | null =
        await this.store.getPendingAction(
          integration.tenantId,
          pending.id,
        );
      await this.store.appendAudit({
        tenantId: integration.tenantId,
        traceId: action.eventId,
        eventType: 'card.already_handled',
        actorOpenId: action.operatorOpenId,
        entityId: pending.id,
        outcome: 'ignored',
        details: {
          requestedAction: cardAction.action,
          currentStatus: current?.status ?? 'missing',
        },
      });
      return current
        ? createAlreadyHandledCard(current.result)
        : this.createAccessDeniedCard('操作状态已变化，请重新发送跟进。');
    }

    await this.store.appendAudit({
      tenantId: integration.tenantId,
      traceId: action.eventId,
      eventType: `card.${cardAction.action}`,
      actorOpenId: action.operatorOpenId,
      entityId: acquired.id,
      outcome: 'accepted',
      details: {
        status: acquired.status,
      },
    });

    this.executor.schedule(
      integration,
      acquired,
      action.callbackToken,
      action.eventId,
    );
    return createProcessingCard();
  }

  private async processMessage(
    integration: TenantIntegration,
    message: IncomingMessage,
    context: ConversationContext,
  ): Promise<void> {
    const storedSession: AgentSession | null =
      await this.store.getOpenSession(
        integration.tenantId,
        message.senderOpenId,
      );
    const session: AgentSession | null = storedSession?.chatId === message.chatId
      ? storedSession
      : null;
    if (session && this.isFollowupCancelCommand(message.text)) {
      await this.store.closeSession(
        integration.tenantId,
        message.senderOpenId,
      );
      await this.messenger.sendText(
        integration,
        message.chatId,
        '已取消本次跟进补充，尚未写入业务数据。你可以继续正常聊天。',
        `${message.messageId}-cancel-session`,
      );
      return;
    }
    if (session?.draft === null) {
      const explicitSource: string | null = this.explicitFollowupSource(
        message.text,
      );
      if (explicitSource !== null) {
        await this.store.closeSession(
          integration.tenantId,
          message.senderOpenId,
        );
        await this.auditIntentClarificationResolved(
          integration,
          message,
          session,
          'record',
        );
        if (explicitSource.length > 0) {
          await this.processFollowupText(
            integration,
            message,
            explicitSource,
            session,
          );
        } else {
          await this.processFollowupText(
            integration,
            message,
            session.rawText,
            null,
            session.sourceMessageId,
          );
        }
        return;
      }
      const activeContext: ConversationContext = {
        ...context,
        activeWorkflow: 'record_or_analyze',
        activeSourceText: session.rawText,
      };
      const decision: ConversationDecision = await this.conversation.respond({
        text: message.text,
        timezone: 'Asia/Shanghai',
        now: message.receivedAt,
        context: activeContext,
      });
      if (
        decision.intent === 'followup_capture' &&
        decision.confidence >= 0.55
      ) {
        await this.auditIntentClarificationResolved(
          integration,
          message,
          session,
          'record',
        );
        await this.processFollowupText(
          integration,
          message,
          session.rawText,
          null,
          session.sourceMessageId,
        );
        return;
      }
      if (decision.intent === 'memory_save' && decision.confidence >= 0.55) {
        await this.store.closeSession(
          integration.tenantId,
          message.senderOpenId,
        );
        await this.saveApprovedMemory(integration, message);
        return;
      }
      if (
        decision.confidence >= 0.55 && (
          decision.intent === 'followup_analyze' ||
          decision.intent === 'sales_qa' ||
          decision.intent === 'project_diagnosis'
        )
      ) {
        await this.store.closeSession(
          integration.tenantId,
          message.senderOpenId,
        );
        await this.auditIntentClarificationResolved(
          integration,
          message,
          session,
          'analyze',
        );
        await this.replyToConversation(integration, message, {
          context: activeContext,
          decision,
        });
        return;
      }
      if (
        decision.intent === 'ambiguous' ||
        decision.confidence < 0.55
      ) {
        await this.sendConversationText(
          integration,
          message,
          '收到。你希望我把它整理成一份待确认的跟进记录，还是只分析它对商机的影响？',
        );
        return;
      }
      await this.store.closeSession(
        integration.tenantId,
        message.senderOpenId,
      );
      await this.auditIntentClarificationResolved(
        integration,
        message,
        session,
        'topic_switched',
      );
      await this.replyToConversation(integration, message, {
        context: activeContext,
        decision,
      });
      return;
    }
    if (!session) {
      const explicitSource: string | null = this.explicitFollowupSource(
        message.text,
      );
      const waitingMessageId: string | null =
        await this.sendConversationWaiting(integration, message);
      if (explicitSource !== null) {
        await this.auditExplicitFollowupRoute(integration, message);
        if (explicitSource.length > 0) {
          await this.finishConversationWaiting(
            integration,
            message,
            waitingMessageId,
            '已识别为跟进记录，正在生成草案。',
          );
          await this.processFollowupText(
            integration,
            message,
            explicitSource,
            null,
          );
          return;
        }
        await this.finishConversationWaiting(
          integration,
          message,
          waitingMessageId,
          '已识别为跟进记录，请填写下面的表单。',
        );
        await this.openFollowupInputForm(integration, message);
        return;
      }
      let decision: ConversationDecision;
      try {
        decision = await this.conversation.respond({
          text: message.text,
          timezone: 'Asia/Shanghai',
          now: message.receivedAt,
          context,
        });
      } catch (error: unknown) {
        await this.handleMessageFailure(
          integration,
          message,
          error,
          waitingMessageId,
        );
        return;
      }
      if (
        decision.intent === 'followup_capture' &&
        decision.confidence >= 0.55
      ) {
        await this.finishConversationWaiting(
          integration,
          message,
          waitingMessageId,
          '已识别为跟进记录，请填写下面的表单。',
        );
        await this.openFollowupInputForm(integration, message);
        return;
      }
      if (decision.intent === 'memory_save' && decision.confidence >= 0.55) {
        await this.saveApprovedMemory(integration, message, waitingMessageId);
        return;
      }
      await this.replyToConversation(integration, message, {
        context,
        decision,
        waitingMessageId,
        forceFollowupClarification:
          decision.intent === 'ambiguous' &&
          this.isRecordOrAnalyzeClarification(decision.reply),
      });
      return;
    }
    const explicitSource: string | null = this.explicitFollowupSource(
      message.text,
    );
    if (explicitSource !== null) {
      const waitingMessageId: string | null =
        await this.sendConversationWaiting(integration, message);
      await this.auditExplicitFollowupRoute(integration, message);
      await this.finishConversationWaiting(
        integration,
        message,
        waitingMessageId,
        '已识别为跟进记录，正在生成草案。',
      );
      await this.processFollowupText(
        integration,
        message,
        explicitSource.length > 0 ? explicitSource : session.rawText,
        null,
        explicitSource.length > 0 ? undefined : session.sourceMessageId,
      );
      return;
    }
    const activeContext: ConversationContext = {
      ...context,
      activeWorkflow: 'followup_collecting',
      activeSourceText: session.rawText,
    };
    const waitingMessageId: string | null =
      await this.sendConversationWaiting(integration, message);
    let decision: ConversationDecision;
    try {
      decision = await this.conversation.respond({
        text: message.text,
        timezone: 'Asia/Shanghai',
        now: message.receivedAt,
        context: activeContext,
      });
    } catch (error: unknown) {
      await this.handleMessageFailure(
        integration,
        message,
        error,
        waitingMessageId,
      );
      return;
    }
    if (
      decision.intent === 'followup_capture' ||
      decision.intent === 'ambiguous' ||
      decision.confidence < 0.55
    ) {
      await this.finishConversationWaiting(
        integration,
        message,
        waitingMessageId,
        '已识别为当前跟进的补充，正在更新草案。',
      );
      await this.processFollowupText(
        integration,
        message,
        message.text,
        session,
      );
      return;
    }
    if (decision.intent === 'memory_save') {
      await this.store.closeSession(
        integration.tenantId,
        message.senderOpenId,
      );
      await this.saveApprovedMemory(
        integration,
        message,
        waitingMessageId,
      );
      return;
    }
    await this.store.closeSession(
      integration.tenantId,
      message.senderOpenId,
    );
    await this.replyToConversation(
      integration,
      message,
      { context: activeContext, decision, waitingMessageId },
    );
  }

  private async processFollowupText(
    integration: TenantIntegration,
    message: IncomingMessage,
    currentText: string,
    session: AgentSession | null,
    sourceMessageId?: string,
  ): Promise<void> {
    const combinedText: string = session
      ? `${session.rawText}\n补充信息：${currentText}`
      : currentText;
    const draft: FollowupDraft = await this.extractor.extract({
      currentText,
      combinedText,
      previousDraft: session?.draft ?? null,
      timezone: 'Asia/Shanghai',
      now: message.receivedAt,
    });
    const actionId: string = randomUUID();
    const payload = await this.chatDrafts.createPayload({
      integration,
      actionId,
      actorOpenId: message.senderOpenId,
      sourceMessageId: sourceMessageId ?? session?.sourceMessageId ??
        message.messageId,
      rawText: combinedText,
      draft,
      now: message.receivedAt,
    });
    const pending: PendingAction =
      await this.store.createPendingAction({
        id: actionId,
        tenantId: integration.tenantId,
        actorOpenId: message.senderOpenId,
        chatId: message.chatId,
        payload,
        expiresAt: new Date(
          message.receivedAt.getTime() + ACTION_TTL_MS,
        ),
      });
    await this.store.closeSession(
      integration.tenantId,
      message.senderOpenId,
    );
    const cardMessageId: string =
      await this.messenger.sendConfirmationCard(
        integration,
        message.chatId,
        pending,
      );
    await this.store.setPendingCardMessage(
      integration.tenantId,
      pending.id,
      cardMessageId,
    );
    await this.store.appendAudit({
      tenantId: integration.tenantId,
      traceId: message.messageId,
      eventType: 'message.pending_confirmation',
      actorOpenId: message.senderOpenId,
      entityId: pending.id,
      outcome: 'succeeded',
      details: {
        cardMessageId,
        missingFields: payload.quality?.missingItems ?? [],
      },
    });
  }

  private async replyToConversation(
    integration: TenantIntegration,
    message: IncomingMessage,
    options: ReplyToConversationOptions = {},
  ): Promise<void> {
    let waitingMessageId: string | null = null;
    try {
      waitingMessageId = options.waitingMessageId === undefined
        ? await this.sendConversationWaiting(integration, message)
        : options.waitingMessageId;
    } catch (error: unknown) {
      await this.auditProgressFailure(
        integration,
        message,
        error,
        'message.progress_send_failed',
      );
    }

    let decision: ConversationDecision;
    try {
      if (options.decision !== undefined) {
        decision = options.decision;
      } else {
        const conversationInput: ConversationInput = {
          text: message.text,
          timezone: 'Asia/Shanghai',
          now: message.receivedAt,
          context: options.context,
          clarificationContext: options.clarificationContext,
        };
        decision = await this.conversation.respond(conversationInput);
      }
    } catch (error: unknown) {
      await this.handleMessageFailure(
        integration,
        message,
        error,
        waitingMessageId,
      );
      return;
    }
    const requiresFollowupClarification: boolean =
      options.clarificationContext === undefined &&
      (options.forceFollowupClarification === true ||
      options.decision === undefined && (
        decision.intent === 'followup_capture' ||
        (
          decision.intent === 'ambiguous' &&
          this.isRecordOrAnalyzeClarification(decision.reply)
        )
      ));
    const lowConfidence: boolean = decision.confidence < 0.55;
    if (requiresFollowupClarification) {
      try {
        await this.store.saveIntentClarificationSession({
          tenantId: integration.tenantId,
          actorOpenId: message.senderOpenId,
          chatId: message.chatId,
          sourceMessageId: message.messageId,
          rawText: message.text,
          expiresAt: new Date(
            message.receivedAt.getTime() + SESSION_TTL_MS,
          ),
        });
        await this.store.appendAudit({
          tenantId: integration.tenantId,
          traceId: message.messageId,
          eventType: 'message.intent_clarification_opened.v1',
          actorOpenId: message.senderOpenId,
          outcome: 'accepted',
          details: {
            sourceMessageId: message.messageId,
            requestedChoice: 'record_or_analyze',
          },
        });
      } catch (error: unknown) {
        await this.handleMessageFailure(
          integration,
          message,
          error,
          waitingMessageId,
        );
        return;
      }
    }
    const reply: string = requiresFollowupClarification
      ? '收到。你希望我把它整理成一份待确认的跟进记录，' +
        '还是只分析它对商机的影响？'
      : lowConfidence
      ? '我还不确定你希望我做什么。你可以直接说“记录跟进”、' +
        '“帮我写内容”或提出销售问题。'
      : decision.reply;
    if (waitingMessageId) {
      try {
        await this.messenger.updateText(
          integration,
          waitingMessageId,
          reply,
        );
      } catch (error: unknown) {
        await this.auditProgressFailure(
          integration,
          message,
          error,
          'message.progress_update_failed',
        );
        await this.messenger.sendText(
          integration,
          message.chatId,
          reply,
          `${message.messageId}-conversation`,
        );
      }
    } else {
      await this.messenger.sendText(
        integration,
        message.chatId,
        reply,
        `${message.messageId}-conversation`,
      );
    }
    await this.store.appendAudit({
      tenantId: integration.tenantId,
      traceId: message.messageId,
      eventType: 'message.intent_routed.v1',
      actorOpenId: message.senderOpenId,
      outcome: 'succeeded',
      details: {
        intent: lowConfidence || requiresFollowupClarification
          ? 'ambiguous'
          : decision.intent,
        confidence: decision.confidence,
        schemaVersion: decision.schemaVersion,
      },
    });
  }

  private async sendConversationWaiting(
    integration: TenantIntegration,
    message: IncomingMessage,
  ): Promise<string | null> {
    try {
      return await this.messenger.sendText(
        integration,
        message.chatId,
        CONVERSATION_WAITING_TEXT,
        `${message.messageId}-conversation-waiting`,
      );
    } catch (error: unknown) {
      await this.auditProgressFailure(
        integration,
        message,
        error,
        'message.progress_send_failed',
      );
      return null;
    }
  }

  private async finishConversationWaiting(
    integration: TenantIntegration,
    message: IncomingMessage,
    waitingMessageId: string | null,
    text: string,
  ): Promise<void> {
    if (waitingMessageId === null) {
      await this.sendConversationText(
        integration,
        message,
        text,
      );
      return;
    }
    try {
      await this.messenger.updateText(integration, waitingMessageId, text);
    } catch (error: unknown) {
      await this.auditProgressFailure(
        integration,
        message,
        error,
        'message.progress_update_failed',
      );
      await this.sendConversationText(integration, message, text);
    }
  }

  private async sendConversationText(
    integration: TenantIntegration,
    message: IncomingMessage,
    text: string,
  ): Promise<void> {
    await this.messenger.sendText(
      integration,
      message.chatId,
      text,
      `${message.messageId}-conversation-direct`,
    );
  }

  private async openFollowupInputForm(
    integration: TenantIntegration,
    message: IncomingMessage,
  ): Promise<void> {
    const actionId: string = randomUUID();
    const pending: PendingAction = await this.store.createPendingAction({
      id: actionId,
      tenantId: integration.tenantId,
      actorOpenId: message.senderOpenId,
      chatId: message.chatId,
      payload: this.chatDrafts.createInputPayload(message.messageId),
      expiresAt: new Date(message.receivedAt.getTime() + ACTION_TTL_MS),
    });
    const cardMessageId: string =
      await this.messenger.sendConfirmationCard(
        integration,
        message.chatId,
        pending,
      );
    await this.store.setPendingCardMessage(
      integration.tenantId,
      pending.id,
      cardMessageId,
    );
    await this.store.appendAudit({
      tenantId: integration.tenantId,
      traceId: message.messageId,
      eventType: 'followup.input_form.opened.v1',
      actorOpenId: message.senderOpenId,
      entityId: pending.id,
      outcome: 'succeeded',
      details: { cardMessageId },
    });
  }

  private async handleInputFormAction(
    integration: TenantIntegration,
    action: IncomingCardAction,
  ): Promise<JsonObject> {
    if (action.cardMessageId === null) {
      return this.createAccessDeniedCard('卡片来源无效，请重新打开跟进表单。');
    }
    const pending: PendingAction | null =
      await this.store.getPendingActionByCardMessage(
        integration.tenantId,
        action.cardMessageId,
      );
    if (
      pending === null ||
      pending.actorOpenId !== action.operatorOpenId ||
      pending.payload.interactionStage !== 'input' ||
      (action.chatId !== null && pending.chatId !== action.chatId)
    ) {
      return this.createAccessDeniedCard('这张跟进表单不属于当前用户或租户。');
    }
    const communicationContent: string = this.readFormText(
      action.formValue,
      'communicationContent',
    );
    if (communicationContent.length === 0) {
      return this.createAccessDeniedCard('沟通原文不能为空，请补充后再生成。');
    }
    const inputForm: FollowupCardFormInput = this.readInputForm(
      action.formValue,
    );
    inputForm.communicationContent = communicationContent;
    const normalizedSource: string = this.createInputFormSource(
      communicationContent,
      inputForm,
    );
    const generatingPayload = {
      ...pending.payload,
      interactionStage: 'generating' as const,
      rawText: normalizedSource,
      inputForm,
      inputError: undefined,
    };
    const generating: PendingAction | null =
      await this.store.replacePendingActionPayload(
        integration.tenantId,
        pending.id,
        action.operatorOpenId,
        0,
        'input',
        generatingPayload,
        action.receivedAt,
      );
    if (generating === null) {
      return this.createAccessDeniedCard('表单状态已变化，请使用最新卡片。');
    }
    await this.store.appendAudit({
      tenantId: integration.tenantId,
      traceId: action.eventId,
      eventType: 'followup.draft.generation_started.v1',
      actorOpenId: action.operatorOpenId,
      entityId: pending.id,
      outcome: 'accepted',
      details: {},
    });
    this.scheduleInputFormGeneration(
      integration,
      action,
      generating,
      communicationContent,
      normalizedSource,
      inputForm,
    );
    return createDraftGenerationProcessingCard();
  }

  private scheduleInputFormGeneration(
    integration: TenantIntegration,
    action: IncomingCardAction,
    generating: PendingAction,
    communicationContent: string,
    normalizedSource: string,
    inputForm: FollowupCardFormInput,
  ): void {
    queueMicrotask((): void => {
      void this.generateInputFormDraft(
        integration,
        action,
        generating,
        communicationContent,
        normalizedSource,
        inputForm,
      ).catch((error: unknown): void => {
        const normalized: Error = this.toError(error);
        this.logger.error(
          `Input form generation crashed: ${redactErrorMessage(normalized)}`,
          redactErrorStack(normalized),
        );
      });
    });
  }

  private async generateInputFormDraft(
    integration: TenantIntegration,
    action: IncomingCardAction,
    generating: PendingAction,
    communicationContent: string,
    normalizedSource: string,
    inputForm: FollowupCardFormInput,
  ): Promise<void> {
    try {
      const draft: FollowupDraft = await this.extractor.extract({
        currentText: communicationContent,
        combinedText: normalizedSource,
        previousDraft: null,
        timezone: 'Asia/Shanghai',
        now: action.receivedAt,
      });
      const payload = await this.chatDrafts.createPayload({
        integration,
        actionId: generating.id,
        actorOpenId: action.operatorOpenId,
        sourceMessageId: generating.payload.sourceMessageId,
        rawText: normalizedSource,
        draft,
        now: action.receivedAt,
        inputForm,
      });
      const updated: PendingAction | null =
        await this.store.replacePendingActionPayload(
          integration.tenantId,
          generating.id,
          action.operatorOpenId,
          0,
          'generating',
          payload,
          action.receivedAt,
        );
      if (updated === null) return;
      await this.store.appendAudit({
        tenantId: integration.tenantId,
        traceId: action.eventId,
        eventType: 'followup.draft.generated.v1',
        actorOpenId: action.operatorOpenId,
        entityId: generating.id,
        outcome: 'succeeded',
        details: { version: payload.draftVersion ?? 1 },
      });
      await this.messenger.updateCard(
        integration,
        action.cardMessageId,
        createConfirmationCard(updated),
      );
    } catch (error: unknown) {
      await this.handleInputGenerationFailure(
        integration,
        action,
        generating,
        inputForm,
        error,
      );
    }
  }

  private async handleInputGenerationFailure(
    integration: TenantIntegration,
    action: IncomingCardAction,
    generating: PendingAction,
    inputForm: FollowupCardFormInput,
    error: unknown,
  ): Promise<void> {
    const normalized: Error = this.toError(error);
    const retryPayload = {
      ...generating.payload,
      interactionStage: 'input' as const,
      inputForm,
      inputError: '暂时无法生成草案，请稍后重试；业务数据尚未写入。',
    };
    const retryable: PendingAction | null =
      await this.store.replacePendingActionPayload(
        integration.tenantId,
        generating.id,
        action.operatorOpenId,
        0,
        'generating',
        retryPayload,
        action.receivedAt,
      );
    await this.store.appendAudit({
      tenantId: integration.tenantId,
      traceId: action.eventId,
      eventType: 'followup.draft.generation_failed.v1',
      actorOpenId: action.operatorOpenId,
      entityId: generating.id,
      outcome: 'failed',
      details: {
        errorCode: this.errorCode(error),
        message: redactErrorMessage(normalized),
      },
    });
    if (retryable === null) return;
    try {
      await this.messenger.updateCard(
        integration,
        action.cardMessageId,
        createConfirmationCard(retryable),
      );
    } catch (updateError: unknown) {
      await this.messenger.sendText(
        integration,
        generating.chatId,
        '草案生成失败，请重新发送“写跟进”后再试。业务数据尚未写入。',
        `${action.eventId}-input-failed`,
      );
      const cardError: Error = this.toError(updateError);
      this.logger.error(
        `Input failure card update failed: ${redactErrorMessage(cardError)}`,
        redactErrorStack(cardError),
      );
    }
  }

  private async handleDraftFormAction(
    integration: TenantIntegration,
    action: IncomingCardAction,
  ): Promise<JsonObject> {
    if (action.cardMessageId === null) {
      return this.createAccessDeniedCard('卡片来源无效，请重新发送跟进。');
    }
    const pending: PendingAction | null =
      await this.store.getPendingActionByCardMessage(
        integration.tenantId,
        action.cardMessageId,
      );
    if (
      pending === null || pending.actorOpenId !== action.operatorOpenId ||
      (action.chatId !== null && pending.chatId !== action.chatId)
    ) {
      return this.createAccessDeniedCard('这张卡片不属于当前用户或租户。');
    }
    const expectedVersion: number | null = this.actionDraftVersion(
      action.actionName,
    );
    const currentVersion: number = pending.payload.draftVersion ?? 1;
    if (expectedVersion === null) {
      return this.createAccessDeniedCard('草案版本已变化，请使用最新卡片。');
    }
    if (expectedVersion !== currentVersion) {
      const currentCard: JsonObject = pending.status === 'pendingConfirmation'
        ? createConfirmationCard(pending)
        : createAlreadyHandledCard(pending.result);
      return this.updateCardAndReturn(
        integration,
        action.cardMessageId,
        currentCard,
      );
    }
    const reviewed = this.chatDrafts.reviewForm(
      pending.id,
      pending.payload,
      action.formValue,
      action.receivedAt,
    );
    const confirmRequested: boolean =
      action.actionName?.startsWith('confirm_followup_v') ?? false;
    if (!confirmRequested) {
      const updated: PendingAction | null =
        await this.store.replacePendingActionPayload(
          integration.tenantId,
          pending.id,
          action.operatorOpenId,
          currentVersion,
          'draft',
          reviewed.payload,
          action.receivedAt,
        );
      if (updated === null) {
        return this.createAccessDeniedCard('草案状态已变化，请重新发送跟进。');
      }
      await this.store.appendAudit({
        tenantId: integration.tenantId,
        traceId: action.eventId,
        eventType: 'followup.quality.reviewed.v1',
        actorOpenId: action.operatorOpenId,
        entityId: pending.id,
        outcome: 'succeeded',
        details: {
          version: reviewed.payload.draftVersion ?? currentVersion,
          contentChanged: reviewed.contentChanged,
          requestedAction: 'review',
        },
      });
      return this.updateCardAndReturn(
        integration,
        action.cardMessageId,
        createConfirmationCard(updated),
      );
    }
    if (!this.chatDrafts.isConfirmable(reviewed.payload)) {
      const updated: PendingAction | null = reviewed.contentChanged
        ? await this.store.replacePendingActionPayload(
          integration.tenantId,
          pending.id,
          action.operatorOpenId,
          currentVersion,
          'draft',
          reviewed.payload,
          action.receivedAt,
        )
        : pending;
      if (updated === null) {
        return this.createAccessDeniedCard(
          '草案状态已变化，请使用最新卡片。',
        );
      }
      await this.store.appendAudit({
        tenantId: integration.tenantId,
        traceId: action.eventId,
        eventType: 'followup.quality.reviewed.v1',
        actorOpenId: action.operatorOpenId,
        entityId: pending.id,
        outcome: 'succeeded',
        details: {
          version: reviewed.payload.draftVersion ?? currentVersion,
          contentChanged: reviewed.contentChanged,
          requestedAction: 'confirm_blocked',
        },
      });
      return this.updateCardAndReturn(
        integration,
        action.cardMessageId,
        createConfirmationCard(updated),
      );
    }
    const acquired: PendingAction | null =
      await this.store.acquirePendingAction(
        integration.tenantId,
        pending.id,
        action.operatorOpenId,
        ['pendingConfirmation'],
        action.receivedAt,
        reviewed.payload,
        currentVersion,
      );
    if (acquired === null) {
      const current: PendingAction | null = await this.store.getPendingAction(
        integration.tenantId,
        pending.id,
      );
      const currentCard: JsonObject = current
        ? createAlreadyHandledCard(current.result)
        : this.createAccessDeniedCard('操作状态已变化，请重新发送跟进。');
      return this.updateCardAndReturn(
        integration,
        action.cardMessageId,
        currentCard,
      );
    }
    await this.store.appendAudit({
      tenantId: integration.tenantId,
      traceId: action.eventId,
      eventType: 'followup.version.confirmed.v1',
      actorOpenId: action.operatorOpenId,
      entityId: acquired.id,
      outcome: 'accepted',
      details: {
        version: acquired.payload.draftVersion ?? currentVersion,
        selectedTaskCandidateIds:
          acquired.payload.selectedTaskCandidateIds ?? [],
      },
    });
    if (reviewed.contentChanged) {
      await this.store.appendAudit({
        tenantId: integration.tenantId,
        traceId: action.eventId,
        eventType: 'followup.quality.reviewed.v1',
        actorOpenId: action.operatorOpenId,
        entityId: acquired.id,
        outcome: 'succeeded',
        details: {
          version: reviewed.payload.draftVersion ?? currentVersion,
          contentChanged: true,
          requestedAction: 'confirm',
        },
      });
    }
    this.executor.schedule(
      integration,
      acquired,
      action.callbackToken,
      action.eventId,
    );
    return createProcessingCard();
  }

  private async editTerminalAction(
    integration: TenantIntegration,
    pending: PendingAction,
    action: IncomingCardAction,
  ): Promise<JsonObject> {
    const terminalStatuses: PendingActionStatus[] = [
      'succeeded',
      'failed',
      'partialFailure',
    ];
    if (!terminalStatuses.includes(pending.status)) {
      return this.createAccessDeniedCard('当前动作仍在处理中，完成后才能编辑。');
    }
    if (pending.cardMessageId !== action.cardMessageId) {
      return this.createAccessDeniedCard('卡片状态已变化，请使用最新卡片。');
    }
    if (!this.store.movePendingCardMessage) {
      return this.createAccessDeniedCard('当前运行环境暂不支持结果修订。');
    }

    const revisionId: string = randomUUID();
    const revisionPayload = {
      ...pending.payload,
      operationKind: 'update' as const,
      revisionOfActionId: pending.id,
      executionTarget: {
        customerRecordId: pending.result.customerRecordId,
        customerRecordUrl: pending.result.customerRecordUrl,
        opportunityRecordId: pending.result.opportunityRecordId,
        opportunityRecordUrl: pending.result.opportunityRecordUrl,
        followupRecordId: pending.result.followupRecordId,
        followupRecordUrl: pending.result.followupRecordUrl,
        taskGuid: pending.result.taskGuid,
        taskUrl: pending.result.taskUrl,
      },
      inputError: undefined,
    };
    const revision: PendingAction = await this.store.createPendingAction({
      id: revisionId,
      tenantId: integration.tenantId,
      actorOpenId: pending.actorOpenId,
      chatId: pending.chatId,
      payload: revisionPayload,
      expiresAt: new Date(action.receivedAt.getTime() + ACTION_TTL_MS),
    });
    await this.store.movePendingCardMessage(
      integration.tenantId,
      pending.id,
      revision.id,
      action.operatorOpenId,
    );
    await this.store.appendAudit({
      tenantId: integration.tenantId,
      traceId: action.eventId,
      eventType: 'card.edit_started',
      actorOpenId: action.operatorOpenId,
      entityId: revision.id,
      outcome: 'accepted',
      details: {
        revisionOfActionId: pending.id,
        operationKind: 'update',
      },
    });
    return this.updateCardAndReturn(
      integration,
      action.cardMessageId ?? pending.cardMessageId ?? '',
      createConfirmationCard(revision),
    );
  }

  private async updateCardAndReturn(
    integration: TenantIntegration,
    cardMessageId: string,
    card: JsonObject,
  ): Promise<JsonObject> {
    await this.messenger.updateCard(integration, cardMessageId, card);
    return card;
  }

  private actionDraftVersion(actionName: string | null): number | null {
    if (actionName === null) return null;
    const match: RegExpMatchArray | null = actionName.match(/_v(\d+)$/u);
    if (match === null) return null;
    const version: number = Number(match[1]);
    return Number.isInteger(version) && version > 0 ? version : null;
  }

  private async cancelAction(
    integration: TenantIntegration,
    pending: PendingAction,
    action: IncomingCardAction,
  ): Promise<JsonObject> {
    const cancelled: PendingAction | null =
      await this.store.cancelPendingAction(
        integration.tenantId,
        pending.id,
        action.operatorOpenId,
        action.receivedAt,
      );
    if (!cancelled) {
      const current: PendingAction | null =
        await this.store.getPendingAction(
          integration.tenantId,
          pending.id,
        );
      await this.store.appendAudit({
        tenantId: integration.tenantId,
        traceId: action.eventId,
        eventType: 'card.cancel_ignored',
        actorOpenId: action.operatorOpenId,
        entityId: pending.id,
        outcome: 'ignored',
        details: {
          currentStatus: current?.status ?? 'missing',
        },
      });
      const currentCard: JsonObject = current
        ? createAlreadyHandledCard(current.result)
        : this.createAccessDeniedCard('操作状态已变化。');
      if (current?.status === 'cancelled') {
        this.scheduleCancelledCardPatch(
          integration,
          current,
          action.eventId,
          currentCard,
        );
      }
      return currentCard;
    }

    await this.store.appendAudit({
      tenantId: integration.tenantId,
      traceId: action.eventId,
      eventType: 'card.cancel',
      actorOpenId: action.operatorOpenId,
      entityId: pending.id,
      outcome: 'succeeded',
      details: {
        status: cancelled.status,
      },
    });
    const cancelledCard: JsonObject = createCancelledCard();
    this.scheduleCancelledCardPatch(
      integration,
      {
        ...cancelled,
        cardMessageId: cancelled.cardMessageId ??
          pending.cardMessageId ??
          action.cardMessageId,
      },
      action.eventId,
      cancelledCard,
    );
    return cancelledCard;
  }

  private scheduleCancelledCardPatch(
    integration: TenantIntegration,
    action: PendingAction,
    traceId: string,
    card: JsonObject,
  ): void {
    const cardMessageId: string | null = action.cardMessageId;
    if (cardMessageId === null) return;
    setTimeout((): void => {
      void this.persistCancelledCard(
        integration,
        action,
        cardMessageId,
        traceId,
        card,
      );
    }, CANCEL_CARD_PATCH_DELAY_MS);
  }

  private async persistCancelledCard(
    integration: TenantIntegration,
    action: PendingAction,
    cardMessageId: string,
    traceId: string,
    card: JsonObject,
  ): Promise<void> {
    try {
      await this.messenger.updateCard(
        integration,
        cardMessageId,
        card,
      );
      await this.store.appendAudit({
        tenantId: integration.tenantId,
        traceId,
        eventType: 'card.cancel_patch_succeeded',
        actorOpenId: action.actorOpenId,
        entityId: action.id,
        outcome: 'succeeded',
        details: {
          cardMessageId,
        },
      });
    } catch (error: unknown) {
      const normalized: Error = this.toError(error);
      const safeMessage: string = redactErrorMessage(normalized);
      this.logger.error(
        `Cancelled card patch failed for action ${action.id}: ` +
          safeMessage,
        redactErrorStack(normalized),
      );
      await this.store.appendAudit({
        tenantId: integration.tenantId,
        traceId,
        eventType: 'card.cancel_patch_failed',
        actorOpenId: action.actorOpenId,
        entityId: action.id,
        outcome: 'failed',
        details: {
          errorCode: this.errorCode(error),
          message: safeMessage,
        },
      });
    }
  }

  private async handleMessageFailure(
    integration: TenantIntegration,
    message: IncomingMessage,
    error: unknown,
    waitingMessageId: string | null = null,
  ): Promise<void> {
    const normalized: Error = this.toError(error);
    const safeMessage: string = redactErrorMessage(normalized);
    this.logger.error(
      `Message ${message.messageId} failed: ${safeMessage}`,
      redactErrorStack(normalized),
    );
    await this.store.appendAudit({
      tenantId: integration.tenantId,
      traceId: message.messageId,
      eventType: 'message.failed',
      actorOpenId: message.senderOpenId,
      outcome: 'failed',
      details: {
        errorCode: this.errorCode(error),
        message: safeMessage,
      },
    });

    if (waitingMessageId) {
      try {
        await this.messenger.updateText(
          integration,
          waitingMessageId,
          MESSAGE_FAILURE_TEXT,
        );
        return;
      } catch (updateError: unknown) {
        await this.auditProgressFailure(
          integration,
          message,
          updateError,
          'message.progress_update_failed',
        );
      }
    }

    try {
      await this.messenger.sendText(
        integration,
        message.chatId,
        MESSAGE_FAILURE_TEXT,
        `${message.messageId}-failed`,
      );
    } catch (sendError: unknown) {
      const sendFailure: Error = this.toError(sendError);
      this.logger.error(
        `Failure notification could not be sent: ${redactErrorMessage(
          sendFailure,
        )}`,
        redactErrorStack(sendFailure),
      );
    }
  }

  private async auditProgressFailure(
    integration: TenantIntegration,
    message: IncomingMessage,
    error: unknown,
    eventType: 'message.progress_send_failed' |
      'message.progress_update_failed',
  ): Promise<void> {
    const normalized: Error = this.toError(error);
    const safeMessage: string = redactErrorMessage(normalized);
    this.logger.warn(
      `Message ${message.messageId} progress delivery failed: ` +
        safeMessage,
    );
    await this.store.appendAudit({
      tenantId: integration.tenantId,
      traceId: message.messageId,
      eventType,
      actorOpenId: message.senderOpenId,
      outcome: 'failed',
      details: {
        errorCode: this.errorCode(error),
        message: safeMessage,
      },
    });
  }

  private isSupportedMessage(message: IncomingMessage): boolean {
    return (
      message.chatType === 'p2p' &&
      message.messageType === 'text' &&
      message.senderType === 'user' &&
      message.text.trim().length > 0
    );
  }

  private isRecordOrAnalyzeClarification(reply: string): boolean {
    return reply.includes('分析') &&
      (reply.includes('记录') || reply.includes('跟进'));
  }

  private async saveApprovedMemory(
    integration: TenantIntegration,
    message: IncomingMessage,
    waitingMessageId?: string | null,
  ): Promise<void> {
    const sendResult = async (text: string): Promise<void> => {
      if (waitingMessageId !== undefined) {
        await this.finishConversationWaiting(
          integration,
          message,
          waitingMessageId,
          text,
        );
        return;
      }
      await this.sendConversationText(integration, message, text);
    };
    const memoryText: string = message.text.trim()
      .replace(/^(?:请)?(?:帮我)?(?:记住|记下来|以后都记得)[:：，,]?/u, '')
      .trim();
    if (memoryText.length === 0) {
      await sendResult('你希望我长期记住什么？请直接说出偏好或工作习惯。');
      return;
    }
    if (!this.longTermMemory) {
      await sendResult('我已识别为长期偏好，但当前环境还没有启用长期记忆存储。');
      return;
    }
    try {
      const result = await this.longTermMemory.addApprovedMemory(
        {
          tenantId: integration.tenantId,
          actorOpenId: message.senderOpenId,
        },
        {
          text: memoryText,
          category: 'user_preference',
          sourceRef: `message:${message.messageId}`,
          policyVersion: 'memory-policy-v1',
          approved: true,
          approvedBy: message.senderOpenId,
        },
      );
      await this.store.appendAudit({
        tenantId: integration.tenantId,
        traceId: message.messageId,
        eventType: 'memory.approved.v1',
        actorOpenId: message.senderOpenId,
        outcome: result.status === 'written' ? 'succeeded' : 'ignored',
        details: {
          status: result.status,
          memoryCount: result.memoryIds.length,
        },
      });
      await sendResult(
        result.status === 'written'
          ? '已记住这条长期偏好，后续对话会优先参考。'
          : '我已识别为长期偏好，但当前环境还没有启用长期记忆存储。',
      );
    } catch (error: unknown) {
      const normalized: Error = this.toError(error);
      await this.store.appendAudit({
        tenantId: integration.tenantId,
        traceId: message.messageId,
        eventType: 'memory.approved_failed.v1',
        actorOpenId: message.senderOpenId,
        outcome: 'failed',
        details: { errorCode: this.errorCode(error) },
      });
      this.logger.warn(
        `Long-term memory write failed: ${redactErrorMessage(normalized)}`,
      );
      await sendResult('这条偏好暂时没有保存成功，但不影响当前对话。稍后可以再试。');
    }
  }

  private async auditIntentClarificationResolved(
    integration: TenantIntegration,
    message: IncomingMessage,
    session: AgentSession,
    resolution: 'record' | 'analyze' | 'topic_switched',
  ): Promise<void> {
    await this.store.appendAudit({
      tenantId: integration.tenantId,
      traceId: message.messageId,
      eventType: 'message.intent_clarification_resolved.v1',
      actorOpenId: message.senderOpenId,
      outcome: 'accepted',
      details: {
        resolution,
        sourceMessageId: session.sourceMessageId,
      },
    });
  }

  private async auditExplicitFollowupRoute(
    integration: TenantIntegration,
    message: IncomingMessage,
  ): Promise<void> {
    await this.store.appendAudit({
      tenantId: integration.tenantId,
      traceId: message.messageId,
      eventType: 'message.intent_routed.v1',
      actorOpenId: message.senderOpenId,
      outcome: 'succeeded',
      details: {
        intent: 'followup_capture',
        confidence: 1,
        schemaVersion: 'deterministic-command-v1',
      },
    });
  }

  private explicitFollowupSource(text: string): string | null {
    const normalized: string = text.trim();
    const patterns: RegExp[] = [
      /^(?:请)?(?:帮我)?(?:写|记录|录入|记)(?:一条|一下|本次)?跟进(?:[呀啊呢])?(?=$|[\s：:，,。！!])\s*[：:，,]?\s*/u,
      /^把(?:以下|这段|这条|刚才)?(?:内容|信息)?记(?:录)?(?:为|成)?跟进(?=$|[\s：:，,。！!])\s*[：:，,]?\s*/u,
    ];
    const pattern: RegExp | undefined = patterns.find(
      (candidate: RegExp): boolean => candidate.test(normalized),
    );
    if (!pattern) return null;
    const source: string = normalized.replace(pattern, '').trim();
    return /^[。！!]*$/u.test(source) ? '' : source;
  }

  private isFollowupCancelCommand(text: string): boolean {
    const normalized: string = text.trim().replace(/[。！!]+$/gu, '');
    return normalized === '取消跟进' || normalized === '不记录了' ||
      normalized === '取消本次跟进';
  }

  private readInputForm(values: JsonObject): FollowupCardFormInput {
    return {
      customerName: this.optionalFormText(values, 'customerName'),
      contactName: this.optionalFormText(values, 'contactName'),
      communicationMethod: this.optionalFormText(
        values,
        'communicationMethod',
      ),
      communicationAt: this.optionalFormText(values, 'communicationAt'),
      topic: this.optionalFormText(values, 'topic'),
      nextAction: this.optionalFormText(values, 'nextAction'),
      dueAt: this.optionalFormText(values, 'dueAt'),
      nextActionChannel: this.optionalFormText(
        values,
        'nextActionChannel',
      ),
      nextActionParticipants: this.readParticipants(
        values,
        'nextActionParticipants',
      ),
    };
  }

  private createInputFormSource(
    communicationContent: string,
    form: FollowupCardFormInput,
  ): string {
    const facts: Array<[string, string | undefined]> = [
      ['客户', form.customerName],
      ['联系人', form.contactName],
      ['沟通方式', form.communicationMethod],
      ['沟通时间', form.communicationAt],
      ['沟通主题', form.topic],
      ['下一步', form.nextAction],
      ['下一步时间', form.dueAt],
      ['下一步地点或方式', form.nextActionChannel],
      ['下一步参与人', form.nextActionParticipants?.join('、')],
    ];
    const lines: string[] = facts
      .filter((fact: [string, string | undefined]): boolean =>
        Boolean(fact[1]),
      )
      .map((fact: [string, string | undefined]): string =>
        `${fact[0]}：${fact[1] ?? ''}`,
      );
    lines.push(`沟通原文：${communicationContent}`);
    return lines.join('\n');
  }

  private optionalFormText(
    values: JsonObject,
    key: string,
  ): string | undefined {
    const value: string = this.readFormText(values, key);
    return value.length > 0 ? value : undefined;
  }

  private readFormText(values: JsonObject, key: string): string {
    const value: JsonValue | undefined = values[key];
    return typeof value === 'string' ? value.trim() : '';
  }

  private readParticipants(values: JsonObject, key: string): string[] {
    const value: string = this.readFormText(values, key);
    if (value.length === 0) return [];
    return value.split(/[,，、;；\n]+/u)
      .map((participant: string): string => participant.trim())
      .filter((participant: string): boolean => participant.length > 0);
  }

  private createAccessDeniedCard(message: string): JsonObject {
    return {
      schema: '2.0',
      config: {
        update_multi: true,
        width_mode: 'default',
      },
      header: {
        title: {
          tag: 'plain_text',
          content: '无法执行',
        },
        template: 'red',
        icon: {
          tag: 'standard_icon',
          token: 'warning_colorful',
        },
      },
      body: {
        direction: 'vertical',
        padding: '12px 12px 20px 12px',
        elements: [
          {
            tag: 'column_set',
            flex_mode: 'none',
            columns: [
              {
                tag: 'column',
                width: 'weighted',
                weight: 1,
                background_style: 'red-50',
                padding: '12px',
                elements: [
                  {
                    tag: 'markdown',
                    content: message,
                  },
                ],
              },
            ],
          },
        ],
      },
    };
  }

  private toError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }
    return new Error(String(error));
  }

  private errorCode(error: unknown): string {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error
    ) {
      return String(error.code);
    }
    return 'UNKNOWN';
  }
}
