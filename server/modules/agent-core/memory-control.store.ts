import type {
  AgentExecutionResult,
  PendingActionStatus,
  TaskFulfillmentChange,
} from '@shared/api.interface';
import type {
  AgentSession,
  AuditEventInput,
  CreatePendingActionInput,
  PendingAction,
  SaveCollectingSessionInput,
  SaveIntentClarificationSessionInput,
  TenantIntegration,
  TaskStatusSnapshot,
} from './agent.types';
import type { ControlStore } from './agent.ports';

interface StoredAuditEvent extends AuditEventInput {
  createdAt: Date;
}

const clone = <T>(value: T): T => structuredClone(value);

export class MemoryControlStore implements ControlStore {
  private readonly tenantsByKey: Map<string, TenantIntegration>;
  private readonly processedMessages: Set<string> = new Set<string>();
  private readonly sessions: Map<string, AgentSession> =
    new Map<string, AgentSession>();
  private readonly pendingActions: Map<string, PendingAction> =
    new Map<string, PendingAction>();
  private readonly auditEvents: StoredAuditEvent[] = [];
  private readonly taskSnapshots: Map<string, TaskStatusSnapshot> =
    new Map<string, TaskStatusSnapshot>();

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
    if (action.expiresAt.getTime() <= now.getTime()) {
      action.status = 'expired';
      action.result.status = 'expired';
      action.updatedAt = now;
      return null;
    }
    if (!allowedStatuses.includes(action.status)) {
      return null;
    }
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
      if (previous && this.taskSnapshotChanged(previous, snapshot)) {
        const kind: TaskFulfillmentChange['kind'] =
          previous.completedAt === null && snapshot.completedAt !== null
            ? 'completed'
            : previous.completedAt !== null && snapshot.completedAt === null
              ? 'reopened'
              : 'changed';
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
}
