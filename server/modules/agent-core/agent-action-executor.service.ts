import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

import type {
  AgentExecutionResult,
  PendingActionStatus,
} from '@shared/api.interface';
import {
  CONTROL_STORE,
  FEISHU_MESSENGER,
  SALES_RECORDS_GATEWAY,
  TASK_GATEWAY,
} from './agent.ports';
import {
  AGENT_CONFIG,
  type AgentRuntimeConfig,
} from '@server/config/agent.config';
import type {
  ControlStore,
  FeishuMessenger,
  SalesRecordsGateway,
  TaskGateway,
} from './agent.ports';
import {
  redactErrorMessage,
  redactErrorStack,
} from './agent.redaction';
import type {
  PendingAction,
  SalesRecordResult,
  TaskCreationResult,
  TenantIntegration,
} from './agent.types';
import {
  FollowupProjectRiskService,
} from '@server/modules/insight/followup-project-risk.service';
import type {
  FollowupProjectRiskInsight,
} from '@server/modules/insight/followup-project-risk.service';
import {
  createAlreadyHandledCard,
  createProcessingCard,
} from './agent.cards';

@Injectable()
export class AgentActionExecutorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger = new Logger(
    AgentActionExecutorService.name,
  );

  private readonly executionTimeoutMs: number;

  private recoveryTimer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(CONTROL_STORE)
    private readonly store: ControlStore,
    @Inject(FEISHU_MESSENGER)
    private readonly messenger: FeishuMessenger,
    @Inject(SALES_RECORDS_GATEWAY)
    private readonly records: SalesRecordsGateway,
    @Inject(TASK_GATEWAY)
    private readonly tasks: TaskGateway,
    private readonly projectRisks: FollowupProjectRiskService,
    @Optional()
    @Inject(AGENT_CONFIG)
    config?: AgentRuntimeConfig,
  ) {
    this.executionTimeoutMs = config?.executionTimeoutMs ?? 5 * 60 * 1000;
  }

  onModuleInit(): void {
    const intervalMs: number = Math.max(
      30_000,
      Math.min(this.executionTimeoutMs, 60_000),
    );
    this.recoveryTimer = setInterval((): void => {
      void this.recoverStaleActions();
    }, intervalMs);
    this.recoveryTimer.unref();
    void this.recoverStaleActions();
  }

  onModuleDestroy(): void {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
  }

  schedule(
    integration: TenantIntegration,
    action: PendingAction,
    callbackToken: string | null,
    traceId: string,
  ): void {
    setImmediate((): void => {
      void this.executeAction(
        integration,
        action,
        callbackToken,
        traceId,
      ).catch((error: unknown): void => {
        const normalized: Error = this.toError(error);
        this.logger.error(
          `Unrecoverable action execution failure: ${redactErrorMessage(
            normalized,
          )}`,
          redactErrorStack(normalized),
        );
      });
    });
  }

  async executeImmediately(
    integration: TenantIntegration,
    action: PendingAction,
    traceId: string,
  ): Promise<AgentExecutionResult> {
    return this.executeAction(integration, action, null, traceId);
  }

  private async executeAction(
    integration: TenantIntegration,
    action: PendingAction,
    callbackToken: string | null,
    traceId: string,
  ): Promise<AgentExecutionResult> {
    let result: AgentExecutionResult = {
      ...action.result,
      ...(action.payload.executionTarget ?? {}),
      pendingActionId: action.id,
      status: 'executing',
      errorCode: undefined,
      errorMessage: undefined,
    };

    await this.updateProcessingCard(integration, action, traceId);

    try {
      result = await this.withTimeout(
        this.executeRemainingSteps(integration, action, result),
      );
      result = {
        ...result,
        status: 'succeeded',
      };
      const saved: PendingAction = await this.store.saveExecutionResult(
        integration.tenantId,
        action.id,
        'succeeded',
        result,
      );
      if (saved.status !== 'succeeded') return saved.result;
      await this.store.appendAudit({
        tenantId: integration.tenantId,
        traceId,
        eventType: 'action.succeeded',
        actorOpenId: action.actorOpenId,
        entityId: action.id,
        outcome: 'succeeded',
        details: {
          customerRecordId: result.customerRecordId ?? '',
          opportunityRecordId: result.opportunityRecordId ?? '',
          followupRecordId: result.followupRecordId ?? '',
          taskGuid: result.taskGuid ?? '',
        },
      });
    } catch (error: unknown) {
      if (error instanceof ExecutionLeaseLostError) return error.result;
      result = await this.saveFailure(
        integration,
        action,
        traceId,
        result,
        error,
      );
    }

    const sourceCardFinalized: boolean = await this.updateSourceCard(
      integration,
      action,
      traceId,
      result,
    );
    const fallbackResultCardSent: boolean =
      !sourceCardFinalized && callbackToken !== null
      ? await this.sendResultCard(
        integration,
        action,
        traceId,
        result,
      )
      : false;
    const resultPresented: boolean =
      sourceCardFinalized || fallbackResultCardSent;
    if (callbackToken !== null) {
      if (resultPresented && result.status === 'succeeded') {
        await this.sendConditionalProjectRiskCard(
          integration,
          action,
          traceId,
        );
      }
    }
    return result;
  }

  private async updateProcessingCard(
    integration: TenantIntegration,
    action: PendingAction,
    traceId: string,
  ): Promise<void> {
    if (action.cardMessageId === null) return;
    try {
      await this.messenger.updateCard(
        integration,
        action.cardMessageId,
        createProcessingCard(),
      );
      await this.store.appendAudit({
        tenantId: integration.tenantId,
        traceId,
        eventType: 'card.processing_sent',
        actorOpenId: action.actorOpenId,
        entityId: action.id,
        outcome: 'succeeded',
        details: {
          cardMessageId: action.cardMessageId,
        },
      });
    } catch (error: unknown) {
      const normalized: Error = this.toError(error);
      const safeMessage: string = redactErrorMessage(normalized);
      this.logger.warn(
        `Processing card update failed for action ${action.id}: ${safeMessage}`,
        redactErrorStack(normalized),
      );
      await this.store.appendAudit({
        tenantId: integration.tenantId,
        traceId,
        eventType: 'card.processing_failed',
        actorOpenId: action.actorOpenId,
        entityId: action.id,
        outcome: 'failed',
        details: {
          cardMessageId: action.cardMessageId,
          message: safeMessage,
        },
      });
    }
  }

  private async executeRemainingSteps(
    integration: TenantIntegration,
    action: PendingAction,
    initialResult: AgentExecutionResult,
  ): Promise<AgentExecutionResult> {
    const result: AgentExecutionResult = initialResult;
    if (action.payload.actionKind === 'opportunity_status') {
      return this.executeOpportunityStatusUpdate(integration, action, result);
    }
    if (result.customerRecordId && !result.customerRecordUrl) {
      result.customerRecordUrl = this.fallbackRecordUrl(
        integration,
        integration.base.customers.tableId,
        result.customerRecordId,
      );
    }
    if (result.opportunityRecordId && !result.opportunityRecordUrl) {
      result.opportunityRecordUrl = this.fallbackRecordUrl(
        integration,
        integration.base.opportunities.tableId,
        result.opportunityRecordId,
      );
    }
    if (result.followupRecordId && !result.followupRecordUrl) {
      result.followupRecordUrl = this.fallbackRecordUrl(
        integration,
        integration.base.followups.tableId,
        result.followupRecordId,
      );
    }
    if (!result.customerRecordId) {
      const customer: SalesRecordResult =
        await this.records.upsertCustomer(integration, action);
      result.customerRecordId = customer.recordId;
      result.customerRecordUrl = this.recordUrl(
        integration,
        integration.base.customers.tableId,
        customer,
      );
      await this.persistProgress(integration, action, result);
    }

    if (!result.opportunityRecordId) {
      const opportunity: SalesRecordResult =
        await this.records.upsertOpportunity(
          integration,
          action,
          result.customerRecordId,
        );
      result.opportunityRecordId = opportunity.recordId;
      result.opportunityRecordUrl = this.recordUrl(
        integration,
        integration.base.opportunities.tableId,
        opportunity,
      );
      await this.persistProgress(integration, action, result);
    }

    if (!result.followupRecordId) {
      const followup: SalesRecordResult =
        await this.records.createFollowup(
          integration,
          action,
          result.customerRecordId,
          result.opportunityRecordId,
        );
      result.followupRecordId = followup.recordId;
      result.followupRecordUrl = this.recordUrl(
        integration,
        integration.base.followups.tableId,
        followup,
      );
      await this.persistProgress(integration, action, result);
    } else if (
      action.payload.operationKind === 'update' &&
      this.records.updateFollowup
    ) {
      const followup: SalesRecordResult = await this.records.updateFollowup(
        integration,
        action,
        result.customerRecordId,
        result.opportunityRecordId,
        result.followupRecordId,
      );
      result.followupRecordUrl = this.recordUrl(
        integration,
        integration.base.followups.tableId,
        followup,
      );
      await this.persistProgress(integration, action, result);
    }

    const shouldCreateTask: boolean =
      action.payload.selectedTaskCandidateIds === undefined ||
      action.payload.selectedTaskCandidateIds.length > 0;
    if (shouldCreateTask && result.taskGuid &&
      action.payload.operationKind === 'update' && this.tasks.updateTask) {
      const task: TaskCreationResult = await this.tasks.updateTask(
        integration,
        action,
        result.followupRecordId,
        result.taskGuid,
      );
      result.taskGuid = task.guid;
      result.taskUrl = task.url;
      result.taskAction = 'updated';
      await this.persistProgress(integration, action, result);
    } else if (shouldCreateTask && !result.taskGuid) {
      const task: TaskCreationResult = await this.tasks.createTask(
        integration,
        action,
        result.followupRecordId,
      );
      result.taskGuid = task.guid;
      result.taskUrl = task.url;
      result.taskAction = 'created';
      await this.persistProgress(integration, action, result);
    } else if (result.taskGuid) {
      result.taskAction = 'unchanged';
    } else {
      result.taskAction = 'skipped';
    }
    return result;
  }

  private async executeOpportunityStatusUpdate(
    integration: TenantIntegration,
    action: PendingAction,
    result: AgentExecutionResult,
  ): Promise<AgentExecutionResult> {
    const snapshot = action.payload.opportunityStatusUpdate;
    const updateStatus = this.records.updateOpportunityStatus;
    if (!snapshot || !updateStatus) {
      throw new Error('Opportunity status action is not executable');
    }
    const updated = await updateStatus.call(
      this.records,
      integration,
      action.actorOpenId,
      {
        recordId: snapshot.recordId,
        status: snapshot.targetStatus,
        expectedStatus: snapshot.expectedStatus,
      },
      `${action.id}:opportunity-status`,
    );
    result.opportunityRecordId = updated.recordId;
    result.opportunityRecordUrl = this.recordUrl(
      integration,
      integration.base.opportunities.tableId,
      updated,
    );
    result.opportunityStatus = {
      opportunityName: snapshot.opportunityName,
      previousStatus: updated.previousStatus,
      status: updated.status,
    };
    await this.persistProgress(integration, action, result);
    return result;
  }

  private async saveFailure(
    integration: TenantIntegration,
    action: PendingAction,
    traceId: string,
    result: AgentExecutionResult,
    error: unknown,
  ): Promise<AgentExecutionResult> {
    const normalized: Error = this.toError(error);
    const safeMessage: string = redactErrorMessage(normalized);
    const partial: boolean = Boolean(
      result.customerRecordId ||
        result.opportunityRecordId ||
        result.followupRecordId ||
        result.taskGuid,
    );
    const status: PendingActionStatus =
      partial ? 'partialFailure' : 'failed';
    const failedResult: AgentExecutionResult = {
      ...result,
      status,
      errorCode: this.errorCode(error),
      errorMessage: safeMessage,
    };
    const saved: PendingAction = await this.store.saveExecutionResult(
      integration.tenantId,
      action.id,
      status,
      failedResult,
    );
    if (saved.status !== status) return saved.result;
    await this.store.appendAudit({
      tenantId: integration.tenantId,
      traceId,
      eventType: 'action.failed',
      actorOpenId: action.actorOpenId,
      entityId: action.id,
      outcome: 'failed',
      details: {
        status,
        errorCode: failedResult.errorCode ?? 'UNKNOWN',
        message: safeMessage,
      },
    });
    this.logger.error(
      `Action ${action.id} failed: ${safeMessage}`,
      redactErrorStack(normalized),
    );
    return failedResult;
  }

  private async sendResultCard(
    integration: TenantIntegration,
    action: PendingAction,
    traceId: string,
    result: AgentExecutionResult,
  ): Promise<boolean> {
    try {
      const messageId: string = await this.messenger.sendResultCard(
        integration,
        action.chatId,
        action,
        result,
      );
      await this.store.appendAudit({
        tenantId: integration.tenantId,
        traceId,
        eventType: 'card.result_sent',
        actorOpenId: action.actorOpenId,
        entityId: action.id,
        outcome: 'succeeded',
        details: {
          messageId,
          status: result.status,
          hasFollowupRecordUrl: Boolean(result.followupRecordUrl),
          hasTaskUrl: Boolean(result.taskUrl),
        },
      });
      return true;
    } catch (error: unknown) {
      const normalized: Error = this.toError(error);
      const safeMessage: string = redactErrorMessage(normalized);
      this.logger.error(
        `Result card send failed for action ${action.id}: ${safeMessage}`,
        redactErrorStack(normalized),
      );
      await this.store.appendAudit({
        tenantId: integration.tenantId,
        traceId,
        eventType: 'card.result_send_failed',
        actorOpenId: action.actorOpenId,
        entityId: action.id,
        outcome: 'failed',
        details: {
          message: safeMessage,
        },
      });
      return false;
    }
  }

  private async sendConditionalProjectRiskCard(
    integration: TenantIntegration,
    action: PendingAction,
    traceId: string,
  ): Promise<void> {
    if (action.payload.actionKind === 'opportunity_status') return;
    const insight: FollowupProjectRiskInsight | null =
      this.projectRisks.analyze(action, new Date());
    if (insight === null) return;

    try {
      const messageId: string = await this.messenger.sendProjectRiskCard(
        integration,
        action.chatId,
        action,
        insight,
      );
      await this.store.appendAudit({
        tenantId: integration.tenantId,
        traceId,
        eventType: 'card.project_risk_sent',
        actorOpenId: action.actorOpenId,
        entityId: action.id,
        outcome: 'succeeded',
        details: {
          messageId,
          sampleStatus: insight.sampleStatus,
          riskTypes: insight.risks.map((risk): string => risk.type),
        },
      });
    } catch (error: unknown) {
      const normalized: Error = this.toError(error);
      const safeMessage: string = redactErrorMessage(normalized);
      this.logger.error(
        `Project risk card send failed for action ${action.id}: ` +
          safeMessage,
        redactErrorStack(normalized),
      );
      await this.store.appendAudit({
        tenantId: integration.tenantId,
        traceId,
        eventType: 'card.project_risk_send_failed',
        actorOpenId: action.actorOpenId,
        entityId: action.id,
        outcome: 'failed',
        details: {
          message: safeMessage,
          riskTypes: insight.risks.map((risk): string => risk.type),
        },
      });
    }
  }

  private async updateSourceCard(
    integration: TenantIntegration,
    action: PendingAction,
    traceId: string,
    result: AgentExecutionResult,
  ): Promise<boolean> {
    if (action.cardMessageId === null) return false;

    try {
      await this.messenger.updateCard(
        integration,
        action.cardMessageId,
        createAlreadyHandledCard(result),
      );
      await this.store.appendAudit({
        tenantId: integration.tenantId,
        traceId,
        eventType: 'card.source_finalized',
        actorOpenId: action.actorOpenId,
        entityId: action.id,
        outcome: 'succeeded',
        details: {
          status: result.status,
          cardMessageId: action.cardMessageId,
        },
      });
      return true;
    } catch (error: unknown) {
      const normalized: Error = this.toError(error);
      const safeMessage: string = redactErrorMessage(normalized);
      this.logger.error(
        `Source card finalization failed for action ${action.id}: ` +
          safeMessage,
        redactErrorStack(normalized),
      );
      await this.store.appendAudit({
        tenantId: integration.tenantId,
        traceId,
        eventType: 'card.source_finalize_failed',
        actorOpenId: action.actorOpenId,
        entityId: action.id,
        outcome: 'failed',
        details: {
          status: result.status,
          message: safeMessage,
        },
      });
      return false;
    }
  }

  private async persistProgress(
    integration: TenantIntegration,
    action: PendingAction,
    result: AgentExecutionResult,
  ): Promise<void> {
    const saved: PendingAction = await this.store.saveExecutionResult(
      integration.tenantId,
      action.id,
      'executing',
      result,
    );
    if (saved.status !== 'executing') {
      throw new ExecutionLeaseLostError(saved.result);
    }
  }

  private async withTimeout(
    operation: Promise<AgentExecutionResult>,
  ): Promise<AgentExecutionResult> {
    let timer: NodeJS.Timeout | undefined;
    const timeout: Promise<never> = new Promise((
      _resolve: (value: never) => void,
      reject: (reason?: unknown) => void,
    ): void => {
      timer = setTimeout((): void => {
        reject(new ActionExecutionTimeoutError());
      }, this.executionTimeoutMs);
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async recoverStaleActions(): Promise<void> {
    if (!this.store.recoverStaleExecutingActions) return;
    try {
      const recovered: PendingAction[] =
        await this.store.recoverStaleExecutingActions(
          new Date(),
          this.executionTimeoutMs,
        );
      for (const action of recovered) {
        const integration: TenantIntegration | null =
          await this.store.resolveTenantById(action.tenantId);
        if (!integration) continue;
        await this.store.appendAudit({
          tenantId: action.tenantId,
          traceId: `recovery:${action.id}`,
          eventType: 'action.execution_timeout_recovered',
          actorOpenId: action.actorOpenId,
          entityId: action.id,
          outcome: 'failed',
          details: { errorCode: 'EXECUTION_TIMEOUT' },
        });
        await this.updateSourceCard(
          integration,
          action,
          `recovery:${action.id}`,
          action.result,
        );
      }
    } catch (error: unknown) {
      const normalized: Error = this.toError(error);
      this.logger.error(
        `Stale action recovery failed: ${redactErrorMessage(normalized)}`,
        redactErrorStack(normalized),
      );
    }
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
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

  private recordUrl(
    integration: TenantIntegration,
    tableId: string,
    record: SalesRecordResult,
  ): string {
    if (record.recordUrl) return record.recordUrl;
    return this.fallbackRecordUrl(integration, tableId, record.recordId);
  }

  private fallbackRecordUrl(
    integration: TenantIntegration,
    tableId: string,
    recordIdValue: string,
  ): string {
    const appToken: string = encodeURIComponent(integration.base.appToken);
    const table: string = encodeURIComponent(tableId);
    const recordId: string = encodeURIComponent(recordIdValue);
    return `https://feishu.cn/base/${appToken}?table=${table}&record=${recordId}`;
  }
}

class ActionExecutionTimeoutError extends Error {
  readonly code: string = 'EXECUTION_TIMEOUT';

  constructor() {
    super('执行超过时间上限，已停止并可安全重试。');
    this.name = 'ActionExecutionTimeoutError';
  }
}

class ExecutionLeaseLostError extends Error {
  constructor(readonly result: AgentExecutionResult) {
    super('Action execution lease was recovered by another worker');
    this.name = 'ExecutionLeaseLostError';
  }
}
