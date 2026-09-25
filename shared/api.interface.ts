export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type FollowupMissingField =
  | 'customerName'
  | 'nextAction'
  | 'dueAt';

export interface FollowupDraft {
  customerName: string | null;
  contactName: string | null;
  opportunityName: string | null;
  communicationMethod?: string | null;
  communicationAt?: string | null;
  topic?: string | null;
  summary: string;
  customerNeeds: string[];
  objections: string[];
  risks: string[];
  progress: string | null;
  expectedAmount: number | null;
  nextAction: string | null;
  dueAt: string | null;
  evidenceQuotes: string[];
  nextActionChannel?: string | null;
  nextActionParticipants?: string[];
}

export type AgentSessionState =
  | 'collecting'
  | 'pendingConfirmation'
  | 'closed';

export type PendingActionStatus =
  | 'pendingConfirmation'
  | 'executing'
  | 'succeeded'
  | 'partialFailure'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type FollowupOperationKind = 'create' | 'update';

export interface ExecutionTarget {
  customerRecordId?: string;
  customerRecordUrl?: string;
  opportunityRecordId?: string;
  opportunityRecordUrl?: string;
  followupRecordId?: string;
  followupRecordUrl?: string;
  taskGuid?: string;
  taskUrl?: string;
}

export interface PendingActionPayload {
  version: 1;
  interactionStage?: 'input' | 'generating' | 'draft';
  sourceMessageId: string;
  rawText: string;
  draft: FollowupDraft;
  draftVersion?: number;
  ownerMemberId?: string;
  generatedBody?: string;
  quality?: FollowupQualitySnapshot;
  taskCandidates?: FollowupTaskCandidate[];
  selectedTaskCandidateIds?: string[];
  inputForm?: FollowupCardFormInput;
  inputError?: string;
  salesContext?: SalesContext;
  operationKind?: FollowupOperationKind;
  revisionOfActionId?: string;
  executionTarget?: ExecutionTarget;
}

export type SalesContextStatus =
  | 'ready'
  | 'partial'
  | 'needs_clarification'
  | 'unavailable';

export interface SalesContextSource {
  recordId: string;
  recordUrl: string | null;
  sourceVersion: string | null;
}

export interface SalesContextCustomer {
  name: string;
  contactName: string | null;
  latestSummary: string | null;
  lastFollowupAt: string | null;
  source: SalesContextSource;
}

export interface SalesContextOpportunity {
  name: string;
  progress: string | null;
  expectedAmount: number | null;
  nextAction: string | null;
  dueAt: string | null;
  source: SalesContextSource;
}

export interface SalesContextConflict {
  field: 'nextAction' | 'dueAt';
  opportunityValue: string;
  followupValue: string;
  opportunitySource: SalesContextSource;
  followupSource: SalesContextSource;
  newerSource: 'opportunity' | 'followup' | 'same' | 'unknown';
}

export interface SalesContextFollowup {
  summary: string;
  opportunityRecordId: string | null;
  nextAction: string | null;
  dueAt: string | null;
  source: SalesContextSource;
}

export interface SalesContextTask {
  guid: string;
  title: string;
  status: string;
  dueAt: string | null;
  url: string | null;
}

export interface SalesContext {
  status: SalesContextStatus;
  customer: SalesContextCustomer | null;
  customerCandidates: SalesContextCustomer[];
  opportunities: SalesContextOpportunity[];
  recentFollowups: SalesContextFollowup[];
  conflicts: SalesContextConflict[];
  tasks: SalesContextTask[];
  warnings: string[];
  readAt: string;
}

export interface ConfirmationCardAction {
  action: 'confirm' | 'cancel' | 'retry' | 'edit';
  pendingActionId: string;
}

export interface AgentExecutionResult {
  pendingActionId: string;
  status: PendingActionStatus;
  customerRecordId?: string;
  customerRecordUrl?: string;
  opportunityRecordId?: string;
  opportunityRecordUrl?: string;
  followupRecordId?: string;
  followupRecordUrl?: string;
  taskGuid?: string;
  taskUrl?: string;
  taskAction?: 'created' | 'updated' | 'unchanged' | 'skipped';
  errorCode?: string;
  errorMessage?: string;
}

export interface FeishuWebhookAcknowledgement {
  code: number;
  challenge?: string;
}

export type PlatformRole =
  | 'sales'
  | 'manager'
  | 'executive'
  | 'admin';

export type PlatformPermission =
  | 'workspace:view'
  | 'followup:create-own'
  | 'followup:confirm-own'
  | 'followup:read'
  | 'customer:read'
  | 'opportunity:read'
  | 'task:read'
  | 'task:assign'
  | 'review:read-personal'
  | 'review:read-team'
  | 'analytics:read'
  | 'playbook:read'
  | 'playbook:review'
  | 'playbook:publish'
  | 'admin:manage-members'
  | 'admin:manage-policies'
  | 'audit:read';

export type PlatformDataScope =
  | 'none'
  | 'self'
  | 'team'
  | 'tenant'
  | 'granted';

export type PlatformNavigationKey =
  | 'workspace'
  | 'customers'
  | 'opportunities'
  | 'followups'
  | 'tasks'
  | 'reviews'
  | 'analytics'
  | 'playbooks'
  | 'admin';

export interface PlatformNavigationItem {
  key: PlatformNavigationKey;
  label: string;
  path: string;
}

export interface PlatformTenantSummary {
  id: string;
  name: string;
  timezone: string;
}

export interface PlatformMemberSummary {
  id: string;
  feishuOpenId: string;
  displayName: string;
}

export interface PlatformSessionResponse {
  tenant: PlatformTenantSummary;
  member: PlatformMemberSummary;
  roles: PlatformRole[];
  permissions: PlatformPermission[];
  navigation: PlatformNavigationItem[];
  policyVersion: string;
}

export type WorkspaceDataStatus =
  | 'ready'
  | 'empty'
  | 'stale'
  | 'partial';

export interface WorkspaceCounters {
  pendingFollowups: number | null;
  dueTasks: number | null;
  openRisks: number | null;
}

export interface WorkspaceResponse {
  status: WorkspaceDataStatus;
  counters: WorkspaceCounters;
  updatedAt: string;
  unavailableSources: string[];
}

export type PlatformSectionKey =
  | 'customers'
  | 'opportunities'
  | 'followups'
  | 'tasks'
  | 'reviews-team'
  | 'analytics'
  | 'playbooks'
  | 'admin-members'
  | 'admin-audit';

export interface PlatformSectionResponse {
  key: PlatformSectionKey;
  title: string;
  status: 'planned';
  phase: 'B' | 'C' | 'E' | 'F' | 'G';
  message: string;
}

export type FollowupDraftSourceType = 'card_form' | 'text';

export interface FollowupCardFormInput {
  communicationContent?: string;
  customerName?: string;
  contactName?: string;
  communicationMethod?: string;
  communicationAt?: string;
  topic?: string;
  nextAction?: string;
  dueAt?: string;
  nextActionChannel?: string;
  nextActionParticipants?: string[];
  participants?: string[];
}

export interface CreateFollowupDraftRequest {
  sourceType: FollowupDraftSourceType;
  text: string;
  idempotencyKey: string;
  form?: FollowupCardFormInput;
}

export interface UpdateFollowupDraftRequest {
  expectedVersion: number;
  generatedBody: string;
  draft: FollowupDraft;
}

export interface ConfirmFollowupDraftRequest {
  expectedVersion: number;
  selectedTaskCandidateIds: string[];
}

export type FollowupTaskCandidateStatus = 'ready' | 'needs_input';

export type FollowupTaskMissingField =
  | 'dueAt'
  | 'pastDueAt'
  | 'channel'
  | 'participants';

export interface FollowupTaskCandidate {
  id: string;
  draftId: string;
  draftVersion: number;
  ownerMemberId: string;
  title: string;
  dueAt: string | null;
  channel: string | null;
  participants: string[];
  customerName: string | null;
  opportunityName: string | null;
  status: FollowupTaskCandidateStatus;
  missingFields: FollowupTaskMissingField[];
}

export interface FollowupQualitySnapshot {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  confirmable: boolean;
  scoreVersion: string;
  dimensions: {
    basics: number;
    dealFacts: number;
    nextStep: number;
    evidence: number;
    writing: number;
  };
  missingItems: string[];
  invalidEvidence: Array<{ field: string; quote: string }>;
  risks: string[];
  suggestions: string[];
}

export interface FollowupDraftResponse {
  id: string;
  status: 'pendingConfirmation' | 'confirmed' | 'cancelled';
  sourceType: string;
  currentVersion: number;
  version: {
    version: number;
    creationKind: string;
    generatedBody: string;
    draft: FollowupDraft;
    quality: FollowupQualitySnapshot;
    taskCandidates?: FollowupTaskCandidate[];
    createdAt: string;
  };
}

export type PlatformApiErrorCode =
  | 'ACCESS_DENIED'
  | 'UNAUTHENTICATED'
  | 'VALIDATION_FAILED'
  | 'CONFLICT'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface PlatformApiError {
  code: PlatformApiErrorCode;
  message: string;
  traceId: string;
  retryable: boolean;
}
