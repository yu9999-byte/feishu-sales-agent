import { parsePreparationContext } from '@server/modules/insight/customer-preparation-context';
import { parsePreparationDraftEdit } from '@server/modules/insight/preparation-draft-edit';
import { randomUUID } from 'node:crypto';
import type {
  AgentExecutionResult,
  CustomerPreparationResultSnapshot,
  CustomerPreparationDeliveryStatus,
  PendingActionStatus,
  TaskFulfillmentChange,
} from '@shared/api.interface';
import type {
  AgentSession,
  CompletePreparationSessionInput,
  SavePreparationDraftInput,
  AuditEventInput,
  CreatePendingActionInput,
  PendingAction,
  SaveCollectingSessionInput,
  SaveIntentClarificationSessionInput,
  SavePreparationClarificationSessionInput,
  TenantIntegration,
  TaskStatusEvent,
  TaskStatusEventResult,
  TaskStatusSnapshot,
  TaskEventReceiptInput,
} from './agent.types';
import type { ControlStore } from './agent.ports';
import type { ConfirmPreparationDeliveryInput, PreparationDeliveryClaim, PreparationDeliveryLease, PreparationDeliveryFinish } from './preparation-delivery.types';

interface StoredAuditEvent extends AuditEventInput {
  createdAt: Date;
}

const clone = <T>(value: T): T => structuredClone(value);

export class MemoryControlStore implements ControlStore {
  private readonly preparationDeliveries = new Map<string, {
    chatId: string; text: string | null; token: string | null;
    status: 'pending' | 'dispatching' | 'sent' | 'unknown'; startedAt: number; updatedAt: number; messageId: string | null; reconciliationVersion: number;
  }>();

  async claimPreparationDelivery(input: PreparationDeliveryClaim): Promise<PreparationDeliveryLease | null> {
    const key: string = JSON.stringify([input.tenantId, input.actorOpenId, input.resultId]);
    const delivery = this.preparationDeliveries.get(key);
    if (!delivery) return null;
    if (delivery.status === 'dispatching' && delivery.startedAt <= input.now.getTime() - 300000) {
      delivery.status = 'unknown';
    }
    if (delivery.status !== 'pending') return null;
    delivery.status = 'dispatching';
    delivery.text ??= input.text;
    delivery.token = randomUUID();
    delivery.startedAt = input.now.getTime();
    return { token: delivery.token, chatId: delivery.chatId, text: delivery.text };
  }

  async getPreparationDelivery(input: { tenantId: string; actorOpenId: string; resultId: string }): Promise<CustomerPreparationDeliveryStatus | null> {
    const delivery = this.preparationDeliveries.get(JSON.stringify([input.tenantId, input.actorOpenId, input.resultId]));
    return delivery ? { status: delivery.status, updatedAt: new Date(delivery.updatedAt).toISOString(), reconciliationVersion: delivery.reconciliationVersion } : null;
  }

  async confirmPreparationDelivery(input: ConfirmPreparationDeliveryInput): Promise<boolean> {
    const delivery = this.preparationDeliveries.get(JSON.stringify([input.tenantId, input.actorOpenId, input.resultId]));
    if (!delivery || delivery.status !== 'unknown' || delivery.reconciliationVersion !== input.expectedVersion) return false;
    delivery.status = 'sent';
    delivery.messageId = input.messageId;
    delivery.reconciliationVersion += 1;
    delivery.updatedAt = input.now.getTime();
    this.auditEvents.push({ tenantId: input.tenantId, actorOpenId: input.operatorOpenId,
      traceId: input.resultId, eventType: 'preparation.delivery_reconciled', entityId: input.resultId,
      outcome: 'succeeded', details: { decision: 'confirm_sent', messageId: input.messageId, sentAt: input.sentAt.toISOString(), note: input.note }, createdAt: input.now });
    return true;
  }

  async finishPreparationDelivery(input: PreparationDeliveryFinish): Promise<boolean> {
    const delivery = this.preparationDeliveries.get(JSON.stringify([input.tenantId, input.actorOpenId, input.resultId]));
    if (!delivery || delivery.status !== 'dispatching' || delivery.token !== input.token) return false;
    delivery.status = input.messageId ? 'sent' : 'unknown';
    delivery.updatedAt = Date.now();
    this.auditEvents.push({ tenantId: input.tenantId, actorOpenId: input.actorOpenId,
      traceId: input.token, eventType: 'preparation.delivery_finished', entityId: input.resultId,
      outcome: input.messageId ? 'succeeded' : 'failed', details: { status: delivery.status }, createdAt: new Date() });
    return true;
  }
  private readonly preparationResults = new Map<string, CustomerPreparationResultSnapshot>();
  private readonly preparationResultSources = new Set<string>();

  async completePreparationSession(input: CompletePreparationSessionInput): Promise<CustomerPreparationResultSnapshot | null> {
    const key: string = JSON.stringify([input.tenantId, input.actorOpenId, input.chatId]);
    const session: AgentSession | undefined = this.preparationSessions.get(key);
    if (!session || session.revision !== input.expectedRevision ||
      session.state !== 'preparation_clarifying' || session.expiresAt.getTime() <= Date.now()) return null;
    const sourceKey: string = JSON.stringify([
      input.tenantId, input.actorOpenId, session.sourceMessageId,
    ]);
    if (this.preparationResultSources.has(sourceKey)) {
      throw new Error('Duplicate preparation result source');
    }
    const createdAt: string = new Date().toISOString();
    const result: CustomerPreparationResultSnapshot = {
      id: randomUUID(), request: clone(input.request), report: clone(input.report),
      revision: 1, createdAt, updatedAt: createdAt, draftEdits: [],
    };
    this.preparationResults.set(JSON.stringify([input.tenantId, input.actorOpenId, result.id]), result);
    this.preparationDeliveries.set(JSON.stringify([input.tenantId, input.actorOpenId, result.id]), {
      chatId: input.chatId, text: null, token: null, status: 'pending', startedAt: 0,
      updatedAt: Date.now(), messageId: null, reconciliationVersion: 1,
    });
    this.preparationResultSources.add(sourceKey);
    session.state = 'closed';
    session.revision = input.expectedRevision + 1;
    return clone(result);
  }

  async getPreparationResult(tenantId: string, actorOpenId: string, id: string): Promise<CustomerPreparationResultSnapshot | null> {
    const result = this.preparationResults.get(JSON.stringify([tenantId, actorOpenId, id]));
    return result ? clone(result) : null;
  }

  async savePreparationDraft(input: SavePreparationDraftInput): Promise<CustomerPreparationResultSnapshot | null> {
    const edit = parsePreparationDraftEdit(input.edit);
    const key: string = JSON.stringify([input.tenantId, input.actorOpenId, input.id]);
    const result = this.preparationResults.get(key);
    if (!result || result.revision !== edit.expectedRevision ||
      !result.report.drafts.some((draft) => draft.channel === edit.channel)) return null;
    const updated: CustomerPreparationResultSnapshot = {
      ...result, revision: result.revision + 1, updatedAt: new Date().toISOString(),
      draftEdits: [
        ...(result.draftEdits ?? []).filter((draft) => draft.channel !== edit.channel),
        { channel: edit.channel, subject: edit.subject, body: edit.body },
      ],
    };
    this.auditEvents.push({
      tenantId: input.tenantId, actorOpenId: input.actorOpenId,
      traceId: randomUUID(), eventType: 'preparation.draft_saved', entityId: input.id,
      outcome: 'succeeded', details: { channel: edit.channel, revision: updated.revision },
      createdAt: new Date(),
    });
    this.preparationResults.set(key, updated);
    return clone(updated);
  }
  private readonly preparationSessions: Map<string, AgentSession> = new Map();
  private readonly tenantsByKey: Map<string, TenantIntegration>;
  private readonly processedMessages: Set<string> = new Set<string>();
  private readonly sessions: Map<string, AgentSession> =
    new Map<string, AgentSession>();
  private readonly pendingActions: Map<string, PendingAction> =
    new Map<string, PendingAction>();
  private readonly auditEvents: StoredAuditEvent[] = [];
  private readonly taskSnapshots: Map<string, TaskStatusSnapshot> =
    new Map<string, TaskStatusSnapshot>();
  private readonly taskStatusEvents: Map<string, TaskStatusEvent[]> =
    new Map<string, TaskStatusEvent[]>();
  private readonly taskEventReceipts: Map<string, TaskEventReceiptInput> =
    new Map<string, TaskEventReceiptInput>();

  constructor(integrations: TenantIntegration[]) {
    this.tenantsByKey = new Map<string, TenantIntegration>(
      integrations.map(
        (
          integration: TenantIntegration,
        ): [string, TenantIntegration] => [
          integration.feishuTenantKey,
          clone(integration),
        ],
      ),
    );
  }

  async resolveTenant(
    feishuTenantKey: string,
  ): Promise<TenantIntegration | null> {
    const integration: TenantIntegration | undefined =
      this.tenantsByKey.get(feishuTenantKey);
    return integration ? clone(integration) : null;
  }

  async resolveTenantById(
    tenantId: string,
  ): Promise<TenantIntegration | null> {
    const integration: TenantIntegration | undefined =
      Array.from(this.tenantsByKey.values()).find(
        (candidate: TenantIntegration): boolean =>
          candidate.tenantId === tenantId,
      );
    return integration ? structuredClone(integration) : null;
  }

  async listActiveIntegrations(): Promise<TenantIntegration[]> {
    return Array.from(this.tenantsByKey.values())
      .filter(
        (integration: TenantIntegration): boolean =>
          integration.status === 'active',
      )
      .sort(
        (left: TenantIntegration, right: TenantIntegration): number =>
          left.tenantId.localeCompare(right.tenantId),
      )
      .map(
        (integration: TenantIntegration): TenantIntegration =>
          clone(integration),
      );
  }

  async claimMessage(
    tenantId: string,
    messageId: string,
  ): Promise<boolean> {
    const key: string = this.messageKey(tenantId, messageId);
    if (this.processedMessages.has(key)) {
      return false;
    }
    this.processedMessages.add(key);
    return true;
  }

  async getOpenSession(
    tenantId: string,
    actorOpenId: string,
  ): Promise<AgentSession | null> {
    const key: string = this.sessionKey(tenantId, actorOpenId);
    const session: AgentSession | undefined = this.sessions.get(key);
    if (!session || session.state !== 'collecting') {
      return null;
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      session.state = 'closed';
      session.updatedAt = new Date();
      return null;
    }
    return clone(session);
  }

  async saveCollectingSession(
    input: SaveCollectingSessionInput,
  ): Promise<AgentSession> {
    const key: string = this.sessionKey(
      input.tenantId,
      input.actorOpenId,
    );
    const existing: AgentSession | undefined = this.sessions.get(key);
    const now: Date = new Date();
    const session: AgentSession = {
      id: existing?.id ?? crypto.randomUUID(),
      tenantId: input.tenantId,
      actorOpenId: input.actorOpenId,
      chatId: input.chatId,
      state: 'collecting',
      sourceMessageId: input.sourceMessageId,
      rawText: input.rawText,
      draft: clone(input.draft),
      expiresAt: new Date(input.expiresAt),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.sessions.set(key, session);
    return clone(session);
  }

  async saveIntentClarificationSession(
    input: SaveIntentClarificationSessionInput,
  ): Promise<AgentSession> {
    const key: string = this.sessionKey(
      input.tenantId,
      input.actorOpenId,
    );
    const existing: AgentSession | undefined = this.sessions.get(key);
    const now: Date = new Date();
    const session: AgentSession = {
      id: existing?.id ?? crypto.randomUUID(),
      tenantId: input.tenantId,
      actorOpenId: input.actorOpenId,
      chatId: input.chatId,
      state: 'collecting',
      sourceMessageId: input.sourceMessageId,
      rawText: input.rawText,
      draft: null,
      expiresAt: new Date(input.expiresAt),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.sessions.set(key, session);
    return clone(session);
  }

  async getOpenPreparationSession(
    tenantId: string,
    actorOpenId: string,
    chatId: string,
    includeInactive: boolean = false,
  ): Promise<AgentSession | null> {
    const key: string = JSON.stringify([tenantId, actorOpenId, chatId]);
    const session: AgentSession | undefined = this.preparationSessions.get(key);
    if (includeInactive) return session ? clone(session) : null;
    if (!session || session.state !== 'preparation_clarifying') return null;
    if (session.expiresAt.getTime() <= Date.now()) {
      session.state = 'closed';
      session.updatedAt = new Date();
      return null;
    }
    return clone(session);
  }

  async savePreparationClarificationSession(
    input: SavePreparationClarificationSessionInput,
  ): Promise<AgentSession> {
    const preparationContext = parsePreparationContext(input.preparationContext, input.rawText);
    const key: string = JSON.stringify([input.tenantId, input.actorOpenId, input.chatId]);
    const existing: AgentSession | undefined = this.preparationSessions.get(key);
    if (input.expectedRevision !== undefined && input.expectedRevision !== (existing?.revision ?? 0)) {
      throw new Error('Preparation revision conflict');
    }
    const now: Date = new Date();
    const session: AgentSession = {
      id: existing?.id ?? crypto.randomUUID(),
      tenantId: input.tenantId,
      actorOpenId: input.actorOpenId,
      chatId: input.chatId,
      state: 'preparation_clarifying',
      revision: (existing?.revision ?? 0) + 1,
      preparationContext,
      sourceMessageId: input.sourceMessageId,
      rawText: input.rawText,
      draft: null,
      expiresAt: new Date(input.expiresAt),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.preparationSessions.set(key, session);
    return clone(session);
  }

  async closePreparationSession(tenantId: string, actorOpenId: string, chatId: string, expectedRevision?: number): Promise<boolean> {
    const session: AgentSession | undefined = this.preparationSessions.get(
      JSON.stringify([tenantId, actorOpenId, chatId]),
    );
    if (!session || (expectedRevision !== undefined &&
      (session.revision !== expectedRevision || session.state !== 'preparation_clarifying' ||
       session.expiresAt.getTime() <= Date.now()))) return false;
    if (session) {
      session.revision = (session.revision ?? 0) + 1;
      session.state = 'closed';
      session.updatedAt = new Date();
    }
    return true;
  }

  async closeSession(
    tenantId: string,
    actorOpenId: string,
  ): Promise<void> {
    const key: string = this.sessionKey(tenantId, actorOpenId);
    const session: AgentSession | undefined = this.sessions.get(key);
    if (!session) {
      return;
    }
    session.state = 'closed';
    session.updatedAt = new Date();
  }

  async createPendingAction(
    input: CreatePendingActionInput,
  ): Promise<PendingAction> {
    const key: string = this.actionKey(input.tenantId, input.id);
    const existing: PendingAction | undefined =
      this.pendingActions.get(key);
    if (existing) {
      return clone(existing);
    }

    const now: Date = new Date();
    const action: PendingAction = {
      id: input.id,
      tenantId: input.tenantId,
      actorOpenId: input.actorOpenId,
      chatId: input.chatId,
      cardMessageId: null,
      status: 'pendingConfirmation',
      payload: clone(input.payload),
      result: {
        pendingActionId: input.id,
        status: 'pendingConfirmation',
      },
      expiresAt: new Date(input.expiresAt),
      createdAt: now,
      updatedAt: now,
    };
    this.pendingActions.set(key, action);
    return clone(action);
  }

  async setPendingCardMessage(
    tenantId: string,
    actionId: string,
    messageId: string,
  ): Promise<void> {
    const action: PendingAction = this.requireAction(
      tenantId,
      actionId,
    );
    action.cardMessageId = messageId;
    action.updatedAt = new Date();
  }

  async movePendingCardMessage(
    tenantId: string,
    fromActionId: string,
    toActionId: string,
    actorOpenId: string,
  ): Promise<void> {
    const from: PendingAction = this.requireAction(tenantId, fromActionId);
    const to: PendingAction = this.requireAction(tenantId, toActionId);
    if (
      from.actorOpenId !== actorOpenId ||
      to.actorOpenId !== actorOpenId ||
      from.cardMessageId === null ||
      to.cardMessageId !== null
    ) {
      throw new Error('Pending action card message cannot be moved');
    }
    to.cardMessageId = from.cardMessageId;
    from.cardMessageId = null;
    const now: Date = new Date();
    from.updatedAt = now;
    to.updatedAt = now;
  }

  async rollbackPendingCardRevision(
    tenantId: string,
    revisionActionId: string,
    originalActionId: string,
    actorOpenId: string,
  ): Promise<void> {
    const revision: PendingAction = this.requireAction(
      tenantId,
      revisionActionId,
    );
    const original: PendingAction = this.requireAction(
      tenantId,
      originalActionId,
    );
    const terminalStatuses: PendingActionStatus[] = [
      'succeeded',
      'failed',
      'partialFailure',
    ];
    if (
      revision.actorOpenId !== actorOpenId ||
      original.actorOpenId !== actorOpenId ||
      revision.status !== 'pendingConfirmation' ||
      revision.cardMessageId === null ||
      original.cardMessageId !== null ||
      !terminalStatuses.includes(original.status)
    ) {
      throw new Error('Pending action card revision cannot be rolled back');
    }
    original.cardMessageId = revision.cardMessageId;
    revision.cardMessageId = null;
    revision.status = 'cancelled';
    revision.result.status = 'cancelled';
    const now: Date = new Date();
    revision.updatedAt = now;
    original.updatedAt = now;
  }

  async getPendingAction(
    tenantId: string,
    actionId: string,
  ): Promise<PendingAction | null> {
    const action: PendingAction | undefined = this.pendingActions.get(
      this.actionKey(tenantId, actionId),
    );
    return action ? clone(action) : null;
  }

  async getPendingActionByCardMessage(
    tenantId: string,
    cardMessageId: string,
  ): Promise<PendingAction | null> {
    const action: PendingAction | undefined = Array.from(
      this.pendingActions.values(),
    ).find((candidate: PendingAction): boolean =>
      candidate.tenantId === tenantId &&
      candidate.cardMessageId === cardMessageId,
    );
    return action ? clone(action) : null;
  }

  async replacePendingActionPayload(
    tenantId: string,
    actionId: string,
    actorOpenId: string,
    expectedDraftVersion: number,
    expectedInteractionStage: 'input' | 'generating' | 'draft',
    payload: PendingAction['payload'],
    now: Date,
  ): Promise<PendingAction | null> {
    const action: PendingAction | undefined = this.pendingActions.get(
      this.actionKey(tenantId, actionId),
    );
    if (
      !action || action.actorOpenId !== actorOpenId ||
      action.status !== 'pendingConfirmation' ||
      (action.payload.draftVersion ?? 1) !== expectedDraftVersion ||
      (action.payload.interactionStage ?? 'draft') !==
        expectedInteractionStage ||
      action.expiresAt.getTime() <= now.getTime()
    ) {
      return null;
    }
    action.payload = clone(payload);
    action.updatedAt = now;
    return clone(action);
  }

  async acquirePendingAction(
    tenantId: string,
    actionId: string,
    actorOpenId: string,
    allowedStatuses: PendingActionStatus[],
    now: Date,
    payload?: PendingAction['payload'],
    expectedDraftVersion?: number,
  ): Promise<PendingAction | null> {
    const action: PendingAction | undefined = this.pendingActions.get(
      this.actionKey(tenantId, actionId),
    );
    if (!action || action.actorOpenId !== actorOpenId) {
      return null;
    }
    if (action.expiresAt.getTime() <= now.getTime() &&
      ['pendingConfirmation', 'failed', 'partialFailure'].includes(action.status)) {
      action.status = 'expired';
      action.result.status = 'expired';
      action.updatedAt = now;
      return null;
    }
    if (!allowedStatuses.includes(action.status)) {
      return null;
    }
    if (action.expiresAt.getTime() <= now.getTime()) return null;
    if (
      expectedDraftVersion !== undefined &&
      (action.payload.draftVersion ?? 1) !== expectedDraftVersion
    ) {
      return null;
    }

    if (payload !== undefined) {
      action.payload = clone(payload);
    }
    action.status = 'executing';
    action.result.status = 'executing';
    action.updatedAt = now;
    return clone(action);
  }

  async cancelPendingAction(
    tenantId: string,
    actionId: string,
    actorOpenId: string,
    now: Date,
  ): Promise<PendingAction | null> {
    const action: PendingAction | undefined = this.pendingActions.get(
      this.actionKey(tenantId, actionId),
    );
    if (
      !action ||
      action.actorOpenId !== actorOpenId ||
      action.status !== 'pendingConfirmation'
    ) {
      return null;
    }
    if (action.expiresAt.getTime() <= now.getTime()) {
      action.status = 'expired';
      action.result.status = 'expired';
      action.updatedAt = now;
      return null;
    }

    action.status = 'cancelled';
    action.result.status = 'cancelled';
    action.updatedAt = now;
    return clone(action);
  }

  async saveExecutionResult(
    tenantId: string,
    actionId: string,
    status: PendingActionStatus,
    result: AgentExecutionResult,
  ): Promise<PendingAction> {
    const action: PendingAction = this.requireAction(
      tenantId,
      actionId,
    );
    if (action.status !== 'executing' && action.status !== 'pendingConfirmation') {
      return clone(action);
    }
    action.status = status;
    action.result = clone(result);
    action.updatedAt = new Date();
    return clone(action);
  }

  async listSucceededActions(
    tenantId: string,
    actorOpenId: string,
    since: Date,
    limit: number,
  ): Promise<PendingAction[]> {
    return Array.from(this.pendingActions.values())
      .filter((action: PendingAction): boolean =>
        action.tenantId === tenantId &&
        action.actorOpenId === actorOpenId &&
        action.status === 'succeeded' &&
        action.updatedAt.getTime() >= since.getTime(),
      )
      .sort((left: PendingAction, right: PendingAction): number =>
        right.updatedAt.getTime() - left.updatedAt.getTime(),
      )
      .slice(0, Math.max(0, limit))
      .map((action: PendingAction): PendingAction => clone(action));
  }

  async recordTaskEventReceipt(
    input: TaskEventReceiptInput,
  ): Promise<boolean> {
    const key: string = this.taskEventReceiptKey(
      input.tenantId,
      input.eventId,
    );
    if (this.taskEventReceipts.has(key)) {
      return false;
    }
    this.taskEventReceipts.set(key, clone(input));
    return true;
  }

  async recordTaskSnapshots(
    tenantId: string,
    actorOpenId: string,
    observedAt: Date,
    snapshots: TaskStatusSnapshot[],
  ): Promise<TaskFulfillmentChange[]> {
    const changes: TaskFulfillmentChange[] = [];
    snapshots.forEach((snapshot: TaskStatusSnapshot): void => {
      const key: string = this.taskSnapshotKey(
        tenantId,
        actorOpenId,
        snapshot.guid,
      );
      const previous: TaskStatusSnapshot | undefined =
        this.taskSnapshots.get(key);
      if (!previous) {
        this.appendTaskStatusEvent(
          key,
          this.toTaskStatusEvent(snapshot, observedAt, 'observed', null),
        );
      } else if (this.taskSnapshotChanged(previous, snapshot)) {
        const kind: TaskFulfillmentChange['kind'] =
          previous.completedAt === null && snapshot.completedAt !== null
            ? 'completed'
            : previous.completedAt !== null && snapshot.completedAt === null
              ? 'reopened'
              : 'changed';
        this.appendTaskStatusEvent(
          key,
          this.toTaskStatusEvent(snapshot, observedAt, kind, previous),
        );
        changes.push({
          guid: snapshot.guid,
          title: snapshot.title,
          kind,
          previousTitle: previous.title,
          currentTitle: snapshot.title,
          previousStatus: previous.status,
          currentStatus: snapshot.status,
          previousCompletedAt: previous.completedAt,
          currentCompletedAt: snapshot.completedAt,
          previousDueAt: previous.dueAt,
          currentDueAt: snapshot.dueAt,
          observedAt: observedAt.toISOString(),
        });
      }
      this.taskSnapshots.set(key, clone(snapshot));
    });
    return changes;
  }

  async listTaskStatusEvents(
    tenantId: string,
    actorOpenId: string,
    taskGuids: string[],
    since: Date,
    limit: number,
  ): Promise<TaskStatusEventResult> {
    if (taskGuids.length === 0 || limit <= 0) {
      return { items: [] };
    }
    const requestedGuids: Set<string> = new Set(taskGuids);
    const events: TaskStatusEvent[] = [];
    requestedGuids.forEach((taskGuid: string): void => {
      const key: string = this.taskSnapshotKey(
        tenantId,
        actorOpenId,
        taskGuid,
      );
      const stored: TaskStatusEvent[] = this.taskStatusEvents.get(key) ?? [];
      stored.forEach((event: TaskStatusEvent): void => {
        if (Date.parse(event.occurredAt) >= since.getTime()) {
          events.push(clone(event));
        }
      });
    });
    events.sort(
      (left: TaskStatusEvent, right: TaskStatusEvent): number =>
        Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
    );
    return { items: events.slice(0, Math.min(limit, 1000)) };
  }

  async recoverStaleExecutingActions(
    now: Date,
    timeoutMs: number,
  ): Promise<PendingAction[]> {
    const cutoff: number = now.getTime() - timeoutMs;
    const recovered: PendingAction[] = [];
    this.pendingActions.forEach((action: PendingAction): void => {
      if (action.status !== 'executing' ||
        action.updatedAt.getTime() > cutoff) {
        return;
      }
      const partial: boolean = Boolean(
        action.result.customerRecordId ||
        action.result.opportunityRecordId ||
        action.result.followupRecordId ||
        action.result.taskGuid,
      );
      action.status = partial ? 'partialFailure' : 'failed';
      action.result = {
        ...action.result,
        status: action.status,
        errorCode: 'EXECUTION_TIMEOUT',
        errorMessage: '执行超过时间上限，已停止并可安全重试。',
      };
      action.updatedAt = now;
      recovered.push(clone(action));
    });
    return recovered;
  }

  async appendAudit(event: AuditEventInput): Promise<void> {
    this.auditEvents.push({
      ...clone(event),
      createdAt: new Date(),
    });
  }

  getAudits(tenantId?: string): StoredAuditEvent[] {
    return this.auditEvents
      .filter(
        (event: StoredAuditEvent): boolean =>
          !tenantId || event.tenantId === tenantId,
      )
      .map((event: StoredAuditEvent): StoredAuditEvent => clone(event));
  }

  private requireAction(
    tenantId: string,
    actionId: string,
  ): PendingAction {
    const action: PendingAction | undefined = this.pendingActions.get(
      this.actionKey(tenantId, actionId),
    );
    if (!action) {
      throw new Error('Pending action not found');
    }
    return action;
  }

  private messageKey(tenantId: string, messageId: string): string {
    return `${tenantId}:${messageId}`;
  }

  private sessionKey(tenantId: string, actorOpenId: string): string {
    return `${tenantId}:${actorOpenId}`;
  }

  private actionKey(tenantId: string, actionId: string): string {
    return `${tenantId}:${actionId}`;
  }

  private taskSnapshotKey(
    tenantId: string,
    actorOpenId: string,
    taskGuid: string,
  ): string {
    return `${tenantId}:${actorOpenId}:${taskGuid}`;
  }

  private taskEventReceiptKey(tenantId: string, eventId: string): string {
    return `${tenantId}:${eventId}`;
  }

  private taskSnapshotChanged(
    previous: TaskStatusSnapshot,
    current: TaskStatusSnapshot,
  ): boolean {
    return previous.title !== current.title ||
      previous.status !== current.status ||
      previous.completedAt !== current.completedAt ||
      previous.dueAt !== current.dueAt ||
      previous.url !== current.url;
  }

  private toTaskStatusEvent(
    snapshot: TaskStatusSnapshot,
    occurredAt: Date,
    kind: TaskStatusEvent['kind'],
    previous: TaskStatusSnapshot | null,
  ): TaskStatusEvent {
    return {
      eventId: [
        snapshot.guid,
        occurredAt.toISOString(),
        kind,
      ].join(':'),
      guid: snapshot.guid,
      kind,
      title: snapshot.title,
      status: snapshot.status,
      completedAt: snapshot.completedAt,
      dueAt: snapshot.dueAt,
      url: snapshot.url,
      occurredAt: occurredAt.toISOString(),
      previousTitle: previous?.title ?? null,
      previousStatus: previous?.status ?? null,
      previousCompletedAt: previous?.completedAt ?? null,
      previousDueAt: previous?.dueAt ?? null,
      relatedTaskGuid: null,
      relation: null,
    };
  }

  private appendTaskStatusEvent(
    key: string,
    event: TaskStatusEvent,
  ): void {
    const events: TaskStatusEvent[] = this.taskStatusEvents.get(key) ?? [];
    if (!events.some(
      (candidate: TaskStatusEvent): boolean =>
        candidate.eventId === event.eventId,
    )) {
      events.push(clone(event));
      this.taskStatusEvents.set(key, events);
    }
  }
}
