import type {
  AgentExecutionResult,
  FollowupDraft,
  FollowupMissingField,
  JsonObject,
  PendingActionStatus,
} from '@shared/api.interface';
import type {
  AgentSession,
  AuditEventInput,
  ConversationDecision,
  ConversationInput,
  CreatePendingActionInput,
  FollowupExtractionInput,
  PendingAction,
  SalesRecordResult,
  SaveCollectingSessionInput,
  SaveIntentClarificationSessionInput,
  SalesContextBaseResult,
  SalesContextHints,
  SalesContextTaskResult,
  StaleOpportunityFollowupPage,
  StaleOpportunityPage,
  TaskCreationResult,
  TenantIntegration,
} from './agent.types';
import type { SalesContext } from '@shared/api.interface';
import type { FollowupProjectRiskInsight } from '@server/modules/insight/followup-project-risk.service';

export const CONTROL_STORE = Symbol('CONTROL_STORE');
export const FOLLOWUP_EXTRACTOR = Symbol('FOLLOWUP_EXTRACTOR');
export const CONVERSATION_ASSISTANT = Symbol('CONVERSATION_ASSISTANT');
export const FEISHU_MESSENGER = Symbol('FEISHU_MESSENGER');
export const SALES_RECORDS_GATEWAY = Symbol('SALES_RECORDS_GATEWAY');
export const TASK_GATEWAY = Symbol('TASK_GATEWAY');
export const SALES_CONTEXT_READER = Symbol('SALES_CONTEXT_READER');

export interface ControlStore {
  resolveTenant(feishuTenantKey: string): Promise<TenantIntegration | null>;
  resolveTenantById(tenantId: string): Promise<TenantIntegration | null>;
  claimMessage(tenantId: string, messageId: string): Promise<boolean>;
  getOpenSession(
    tenantId: string,
    actorOpenId: string,
  ): Promise<AgentSession | null>;
  saveCollectingSession(
    input: SaveCollectingSessionInput,
  ): Promise<AgentSession>;
  saveIntentClarificationSession(
    input: SaveIntentClarificationSessionInput,
  ): Promise<AgentSession>;
  closeSession(tenantId: string, actorOpenId: string): Promise<void>;
  createPendingAction(
    input: CreatePendingActionInput,
  ): Promise<PendingAction>;
  setPendingCardMessage(
    tenantId: string,
    actionId: string,
    messageId: string,
  ): Promise<void>;
  movePendingCardMessage?(
    tenantId: string,
    fromActionId: string,
    toActionId: string,
    actorOpenId: string,
  ): Promise<void>;
  getPendingAction(
    tenantId: string,
    actionId: string,
  ): Promise<PendingAction | null>;
  getPendingActionByCardMessage(
    tenantId: string,
    cardMessageId: string,
  ): Promise<PendingAction | null>;
  replacePendingActionPayload(
    tenantId: string,
    actionId: string,
    actorOpenId: string,
    expectedDraftVersion: number,
    expectedInteractionStage: 'input' | 'generating' | 'draft',
    payload: PendingAction['payload'],
    now: Date,
  ): Promise<PendingAction | null>;
  acquirePendingAction(
    tenantId: string,
    actionId: string,
    actorOpenId: string,
    allowedStatuses: PendingActionStatus[],
    now: Date,
    payload?: PendingAction['payload'],
    expectedDraftVersion?: number,
  ): Promise<PendingAction | null>;
  cancelPendingAction(
    tenantId: string,
    actionId: string,
    actorOpenId: string,
    now: Date,
  ): Promise<PendingAction | null>;
  saveExecutionResult(
    tenantId: string,
    actionId: string,
    status: PendingActionStatus,
    result: AgentExecutionResult,
  ): Promise<PendingAction>;
  recoverStaleExecutingActions?(
    now: Date,
    timeoutMs: number,
  ): Promise<PendingAction[]>;
  appendAudit(event: AuditEventInput): Promise<void>;
}

export interface FollowupExtractor {
  extract(input: FollowupExtractionInput): Promise<FollowupDraft>;
  getMissingFields(draft: FollowupDraft): FollowupMissingField[];
}

export interface ConversationAssistant {
  respond(input: ConversationInput): Promise<ConversationDecision>;
}

export interface FeishuMessenger {
  sendText(
    integration: TenantIntegration,
    chatId: string,
    text: string,
    idempotencyKey: string,
  ): Promise<string>;
  updateText(
    integration: TenantIntegration,
    messageId: string,
    text: string,
  ): Promise<void>;
  sendConfirmationCard(
    integration: TenantIntegration,
    chatId: string,
    action: PendingAction,
  ): Promise<string>;
  updateCard(
    integration: TenantIntegration,
    cardMessageId: string,
    card: JsonObject,
  ): Promise<void>;
  sendResultCard(
    integration: TenantIntegration,
    chatId: string,
    action: PendingAction,
    result: AgentExecutionResult,
  ): Promise<string>;
  sendProjectRiskCard(
    integration: TenantIntegration,
    chatId: string,
    action: PendingAction,
    insight: FollowupProjectRiskInsight,
  ): Promise<string>;
}

export interface SalesRecordsGateway {
  readSalesContext?(
    integration: TenantIntegration,
    actorOpenId: string,
    hints: SalesContextHints,
  ): Promise<SalesContextBaseResult>;
  readStaleOpportunityFollowupPage?(
    integration: TenantIntegration,
    actorOpenId: string,
    pageToken?: string,
  ): Promise<StaleOpportunityFollowupPage>;
  readStaleOpportunityPage?(
    integration: TenantIntegration,
    actorOpenId: string,
    pageToken?: string,
  ): Promise<StaleOpportunityPage>;
  upsertCustomer(
    integration: TenantIntegration,
    action: PendingAction,
  ): Promise<SalesRecordResult>;
  upsertOpportunity(
    integration: TenantIntegration,
    action: PendingAction,
    customerRecordId: string,
  ): Promise<SalesRecordResult>;
  createFollowup(
    integration: TenantIntegration,
    action: PendingAction,
    customerRecordId: string,
    opportunityRecordId: string,
  ): Promise<SalesRecordResult>;
  updateFollowup?(
    integration: TenantIntegration,
    action: PendingAction,
    customerRecordId: string,
    opportunityRecordId: string,
    followupRecordId: string,
  ): Promise<SalesRecordResult>;
}

export interface TaskGateway {
  searchOwnedTasks?(
    integration: TenantIntegration,
    actorOpenId: string,
    customerName: string,
  ): Promise<SalesContextTaskResult>;
  createTask(
    integration: TenantIntegration,
    action: PendingAction,
    followupRecordId: string,
  ): Promise<TaskCreationResult>;
  updateTask?(
    integration: TenantIntegration,
    action: PendingAction,
    followupRecordId: string,
    taskGuid: string,
  ): Promise<TaskCreationResult>;
}

export interface SalesContextReader {
  read(
    integration: TenantIntegration,
    actorOpenId: string,
    hints: SalesContextHints,
    now?: Date,
  ): Promise<SalesContext>;
}
