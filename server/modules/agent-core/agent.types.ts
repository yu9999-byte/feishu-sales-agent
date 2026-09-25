import type {
  AgentExecutionResult,
  AgentSessionState,
  FollowupDraft,
  JsonObject,
  PendingActionPayload,
  PendingActionStatus,
  SalesContext,
} from '@shared/api.interface';

export type FeishuAppType = 'selfBuild' | 'isv';

export interface CustomerFieldMapping {
  customerName: string;
  contactName?: string;
  ownerOpenId?: string;
  latestSummary?: string;
  lastFollowupAt?: string;
}

export interface OpportunityFieldMapping {
  opportunityName: string;
  customerLink: string;
  expectedAmount?: string;
  progress?: string;
  nextAction?: string;
  dueAt?: string;
  ownerOpenId?: string;
}

export interface FollowupFieldMapping {
  sourceMessageId: string;
  customerLink: string;
  opportunityLink: string;
  rawText: string;
  summary: string;
  customerNeeds?: string;
  objections?: string;
  risks?: string;
  nextAction?: string;
  dueAt?: string;
  ownerOpenId?: string;
}

export interface BaseTableMapping<TFields> {
  tableId: string;
  primaryField: string;
  fields: TFields;
}

export interface TenantBaseMapping {
  appToken: string;
  customers: BaseTableMapping<CustomerFieldMapping>;
  opportunities: BaseTableMapping<OpportunityFieldMapping>;
  followups: BaseTableMapping<FollowupFieldMapping>;
}

export interface TenantIntegration {
  tenantId: string;
  feishuTenantKey: string;
  name: string;
  status: 'active' | 'disabled';
  appId: string;
  appSecretEnv: string;
  appType: FeishuAppType;
  base: TenantBaseMapping;
}

export interface IncomingMessage {
  feishuTenantKey: string;
  messageId: string;
  chatId: string;
  chatType: 'p2p' | 'group';
  messageType: string;
  senderOpenId: string;
  senderType: string;
  text: string;
  receivedAt: Date;
}

export interface IncomingCardAction {
  feishuTenantKey: string;
  eventId: string;
  operatorOpenId: string;
  callbackToken: string;
  cardMessageId: string | null;
  chatId: string | null;
  actionName: string | null;
  value: JsonObject;
  formValue: JsonObject;
  receivedAt: Date;
}

export interface AgentSession {
  id: string;
  tenantId: string;
  actorOpenId: string;
  chatId: string;
  state: AgentSessionState;
  sourceMessageId: string;
  rawText: string;
  draft: FollowupDraft | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type ActiveConversationWorkflow =
  | 'record_or_analyze'
  | 'followup_collecting';

export interface ConversationContext {
  tenantId?: string;
  actorOpenId?: string;
  chatId?: string;
  sourceMessageId?: string;
  activeWorkflow?: ActiveConversationWorkflow;
  activeSourceText?: string;
}

export interface PendingAction {
  id: string;
  tenantId: string;
  actorOpenId: string;
  chatId: string;
  cardMessageId: string | null;
  status: PendingActionStatus;
  payload: PendingActionPayload;
  result: AgentExecutionResult;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SaveCollectingSessionInput {
  tenantId: string;
  actorOpenId: string;
  chatId: string;
  sourceMessageId: string;
  rawText: string;
  draft: FollowupDraft;
  expiresAt: Date;
}

export interface SaveIntentClarificationSessionInput {
  tenantId: string;
  actorOpenId: string;
  chatId: string;
  sourceMessageId: string;
  rawText: string;
  expiresAt: Date;
}

export interface CreatePendingActionInput {
  id: string;
  tenantId: string;
  actorOpenId: string;
  chatId: string;
  payload: PendingActionPayload;
  expiresAt: Date;
}

export interface AuditEventInput {
  tenantId: string;
  traceId: string;
  eventType: string;
  actorOpenId?: string;
  entityId?: string;
  outcome: 'accepted' | 'ignored' | 'succeeded' | 'failed';
  details: JsonObject;
}

export interface FollowupExtractionInput {
  currentText: string;
  combinedText: string;
  previousDraft: FollowupDraft | null;
  timezone: string;
  now: Date;
  salesContext?: SalesContext;
}

export interface SalesContextHints {
  customerName?: string;
  opportunityName?: string;
  contactName?: string;
}

export interface SalesContextBaseResult {
  customers: Array<{
    recordId: string;
    name: string;
    contactName: string | null;
    latestSummary: string | null;
    lastFollowupAt: string | null;
    sourceVersion: string | null;
    recordUrl: string | null;
  }>;
  opportunities: Array<{
    recordId: string;
    customerRecordId: string;
    name: string;
    progress: string | null;
    expectedAmount: number | null;
    nextAction: string | null;
    dueAt: string | null;
    sourceVersion: string | null;
    recordUrl: string | null;
  }>;
  followups: Array<{
    recordId: string;
    summary: string;
    opportunityRecordId: string | null;
    nextAction: string | null;
    dueAt: string | null;
    sourceVersion: string | null;
    recordUrl: string | null;
  }>;
  warnings: string[];
}

export interface SalesContextTaskResult {
  items: Array<{
    guid: string;
    title: string;
    status: string;
    dueAt: string | null;
    url: string | null;
  }>;
  warning?: string;
}

export type ConversationIntent =
  | 'general_chat'
  | 'sales_qa'
  | 'content_generate'
  | 'business_query'
  | 'followup_capture'
  | 'followup_analyze'
  | 'task_operation'
  | 'opportunity_operation'
  | 'project_diagnosis'
  | 'memory_save'
  | 'ambiguous';

export interface ConversationInput {
  text: string;
  timezone: string;
  now: Date;
  context?: ConversationContext;
  clarificationContext?: {
    previousText: string;
    resolution: 'analyze';
  };
}

export interface ConversationDecision {
  schemaVersion: 'conversation-intent-v1';
  intent: ConversationIntent;
  confidence: number;
  reply: string;
}

export interface SalesRecordResult {
  recordId: string;
  recordUrl?: string;
}

export interface TaskCreationResult {
  guid: string;
  url: string;
}

export interface ExecutionContext {
  integration: TenantIntegration;
  action: PendingAction;
}
