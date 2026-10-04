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
  agreements?: string[];
  decisionChain?: string[];
  competitors?: string[];
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

export type PendingActionKind = 'followup' | 'opportunity_status';

export type OpportunityStatusActionLifecycleStatus =
  | 'active'
  | 'won'
  | 'lost'
  | 'closed'
  | 'unknown';

export type OpportunityStatusActionTargetStatus = Exclude<
  OpportunityStatusActionLifecycleStatus,
  'unknown'
>;

export interface OpportunityStatusActionSnapshot {
  recordId: string;
  opportunityName: string;
  recordUrl?: string | null;
  expectedStatus: OpportunityStatusActionLifecycleStatus;
  targetStatus: OpportunityStatusActionTargetStatus;
}

export interface ExecutionTarget {
  customerRecordId?: string;
  customerRecordUrl?: string;
  opportunityRecordId?: string;
  opportunityRecordUrl?: string;
  followupRecordId?: string;
  followupRecordUrl?: string;
  taskGuid?: string;
  taskUrl?: string;
  relatedTaskGuid?: string;
  relation?: 'replaces';
}

export interface PendingActionPayload {
  version: 1;
  actionKind?: PendingActionKind;
  interactionStage?: 'input' | 'generating' | 'draft';
  sourceMessageId: string;
  rawText: string;
  draft: FollowupDraft;
  draftVersion?: number;
  ownerMemberId?: string;
  generatedBody?: string;
  quality?: FollowupQualitySnapshot;
  progressAssessment?: FollowupProgressSnapshot;
  taskCandidates?: FollowupTaskCandidate[];
  selectedTaskCandidateIds?: string[];
  inputForm?: FollowupCardFormInput;
  inputError?: string;
  salesContext?: SalesContext;
  opportunityStatusUpdate?: OpportunityStatusActionSnapshot;
  operationKind?: FollowupOperationKind;
  revisionOfActionId?: string;
  executionTarget?: ExecutionTarget;
}

export type FollowupProgressState =
  | 'advanced'
  | 'steady'
  | 'needs_attention'
  | 'at_risk'
  | 'insufficient';

export type FollowupProgressFactKind =
  | 'message'
  | 'customer'
  | 'opportunity'
  | 'followup'
  | 'task';

export type FollowupProgressFindingKind = 'change' | 'gap' | 'risk';

export interface FollowupProgressFact {
  id: string;
  kind: FollowupProgressFactKind;
  label: string;
  content: string;
  quote: string | null;
  source: SalesContextSource | null;
}

export interface FollowupProgressFinding {
  id: string;
  kind: FollowupProgressFindingKind;
  code: string;
  title: string;
  detail: string;
  evidenceIds: string[];
}

export interface FollowupProgressRecommendation {
  action: string;
  dueAt: string | null;
  reason: string;
  evidenceIds: string[];
  requiresConfirmation: true;
  editableFields: Array<'nextAction' | 'dueAt'>;
}

export interface FollowupProgressSnapshot {
  state: FollowupProgressState;
  headline: string;
  facts: FollowupProgressFact[];
  findings: FollowupProgressFinding[];
  recommendation: FollowupProgressRecommendation | null;
  warnings: string[];
  assessedAt: string;
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
  communicationAt?: string | null;
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
  opportunityStatus?: {
    opportunityName: string;
    previousStatus: OpportunityStatusActionLifecycleStatus;
    status: OpportunityStatusActionTargetStatus;
  };
  followupRecordId?: string;
  followupRecordUrl?: string;
  taskGuid?: string;
  taskUrl?: string;
  relatedTaskGuid?: string;
  relation?: 'replaces';
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
  | 'daily-report'
  | 'stale-opportunity-readiness'
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

export type DailySalesReportStatus =
  | 'ready'
  | 'partial'
  | 'empty'
  | 'unavailable';

export interface DailySalesReportSource {
  recordId: string;
  recordUrl: string | null;
  sourceVersion: string | null;
}

export interface DailySalesReportFollowup {
  recordId: string;
  customerName: string | null;
  opportunityName: string | null;
  summary: string;
  communicationAt: string;
  nextAction: string | null;
  dueAt: string | null;
  source: DailySalesReportSource;
}

export interface DailySalesReportOpportunity {
  recordId: string;
  name: string;
  progress: string | null;
  nextAction: string | null;
  dueAt: string | null;
  source: DailySalesReportSource;
}

export interface DailySalesReportTask {
  guid: string;
  title: string;
  status: string;
  dueAt: string | null;
  url: string | null;
  overdue: boolean;
}

export interface DailySalesReportMetrics {
  followupCount: number;
  opportunityCount: number;
  openTaskCount: number;
  overdueTaskCount: number;
}

export interface DailySalesReportResponse {
  reportDate: string;
  timezone: string;
  status: DailySalesReportStatus;
  generatedAt: string;
  metrics: DailySalesReportMetrics;
  followups: DailySalesReportFollowup[];
  opportunities: DailySalesReportOpportunity[];
  tasks: DailySalesReportTask[];
  highlights: string[];
  nextActions: string[];
  warnings: string[];
}

export type TaskFulfillmentStatus =
  | 'ready'
  | 'partial'
  | 'empty'
  | 'unavailable';

export type TaskFulfillmentCategory =
  | 'overdue'
  | 'due_today'
  | 'due_soon'
  | 'unscheduled'
  | 'scheduled';

export type TaskFulfillmentPriority =
  | 'critical'
  | 'high'
  | 'medium'
  | 'normal';

export type TaskPromiseStatus =
  | 'open_overdue'
  | 'open_due_today'
  | 'open_scheduled'
  | 'open_unscheduled'
  | 'open_changed'
  | 'completed'
  | 'not_task_tracked'
  | 'task_not_visible'
  | 'task_lookup_incomplete'
  | 'task_lookup_unavailable';

export type TaskPromiseCompletionState =
  | 'completed'
  | 'partially_completed'
  | 'still_open'
  | 'unknown';

export type TaskFulfillmentChangeKind =
  | 'completed'
  | 'changed'
  | 'reopened';

export interface TaskFulfillmentChange {
  guid: string;
  title: string;
  kind: TaskFulfillmentChangeKind;
  previousTitle: string | null;
  currentTitle: string;
  previousStatus: string | null;
  currentStatus: string;
  previousCompletedAt: string | null;
  currentCompletedAt: string | null;
  previousDueAt: string | null;
  currentDueAt: string | null;
  observedAt: string;
}

export interface TaskFulfillmentItem {
  guid: string;
  title: string;
  status: string;
  completedAt: string | null;
  dueAt: string | null;
  dueDate: string | null;
  daysUntilDue: number | null;
  url: string | null;
  category: TaskFulfillmentCategory;
  priority: TaskFulfillmentPriority;
  suggestedAction: string;
}

export interface TaskFulfillmentCompletedItem {
  guid: string;
  title: string;
  completedAt: string;
  dueAt: string | null;
  url: string | null;
}

export interface TaskFulfillmentMetrics {
  openTaskCount: number;
  completedTaskCount: number;
  overdueCount: number;
  dueTodayCount: number;
  dueSoonCount: number;
  unscheduledCount: number;
  scheduledCount: number;
  promiseCount: number;
  linkedOpenPromiseCount: number;
  completedPromiseCount: number;
  partiallyCompletedPromiseCount: number;
  stillOpenPromiseCount: number;
  changedPromiseCount: number;
  overduePromiseCount: number;
  untrackedPromiseCount: number;
  unverifiablePromiseCount: number;
}

export interface TaskPromiseFulfillmentItem {
  pendingActionId: string;
  customerName: string | null;
  opportunityName: string | null;
  nextAction: string;
  promisedDueAt: string | null;
  confirmedAt: string;
  taskGuid: string | null;
  taskUrl: string | null;
  taskTitle: string | null;
  taskStatus: string | null;
  taskCompletedAt: string | null;
  taskDueAt: string | null;
  replacementTaskGuid?: string;
  replacementTaskUrl?: string | null;
  replacementRelation?: 'replaces';
  status: TaskPromiseStatus;
  completionState: TaskPromiseCompletionState;
  suggestedAction: string;
  change?: TaskFulfillmentChange;
}

export interface TaskFulfillmentCoverage {
  openTasks: true;
  completedTasks: 'search_scope' | 'partial' | 'unavailable';
  promiseReconciliation: 'agent_confirmed_only';
  promiseHistoryDays: 180;
  taskSnapshots: 'latest_observation' | 'unavailable';
  taskHistory: 'agent_observations' | 'full' | 'unavailable';
}

export interface TaskFulfillmentResponse {
  referenceDate: string;
  timezone: string;
  status: TaskFulfillmentStatus;
  generatedAt: string;
  metrics: TaskFulfillmentMetrics;
  items: TaskFulfillmentItem[];
  completedItems: TaskFulfillmentCompletedItem[];
  promises: TaskPromiseFulfillmentItem[];
  changes: TaskFulfillmentChange[];
  recommendations: string[];
  coverage: TaskFulfillmentCoverage;
  warnings: string[];
}

export type TeamReviewStatus =
  | 'ready'
  | 'partial'
  | 'empty'
  | 'unavailable';

export type TeamReviewAttentionSeverity = 'high' | 'medium';

export interface TeamReviewMemberSummary {
  memberId: string;
  displayName: string;
  status: DailySalesReportStatus;
  metrics: DailySalesReportMetrics;
  highlights: string[];
  nextActions: string[];
  warnings: string[];
}

export interface TeamReviewAttention {
  memberId: string;
  displayName: string;
  severity: TeamReviewAttentionSeverity;
  reasons: string[];
}

export interface TeamReviewMetrics {
  memberCount: number;
  activeMemberCount: number;
  followupCount: number;
  opportunityCount: number;
  openTaskCount: number;
  overdueTaskCount: number;
  attentionMemberCount: number;
}

export interface TeamReviewResponse {
  reviewDate: string;
  timezone: string;
  status: TeamReviewStatus;
  generatedAt: string;
  metrics: TeamReviewMetrics;
  members: TeamReviewMemberSummary[];
  attentions: TeamReviewAttention[];
  highlights: string[];
  managerActions: string[];
  warnings: string[];
}

export type StaleOpportunityReadinessStatus =
  | 'ready'
  | 'incomplete'
  | 'unavailable';

export type StaleOpportunityReadinessBlocker =
  | 'status_unconfirmed'
  | 'followup_time_missing';

export interface StaleOpportunityReadinessItem {
  recordId: string;
  name: string;
  status: 'active' | 'won' | 'lost' | 'closed' | 'unknown';
  sourceVersion: string | null;
  lastEffectiveFollowupAt: string | null;
  followupRecordId: string | null;
  followupSourceVersion: string | null;
  blockers: StaleOpportunityReadinessBlocker[];
  recordUrl: string | null;
}

export interface StaleOpportunityReadinessSummary {
  opportunityCount: number;
  statusConfirmedCount: number;
  statusNeedsConfirmationCount: number;
  followupTimeConfirmedCount: number;
  followupTimeNeedsConfirmationCount: number;
  readyForScanCount: number;
}

export interface StaleOpportunityReadinessResponse {
  generatedAt: string;
  status: StaleOpportunityReadinessStatus;
  summary: StaleOpportunityReadinessSummary;
  items: StaleOpportunityReadinessItem[];
  warnings: string[];
}

export type StaleOpportunityGovernanceStatus = Exclude<
  StaleOpportunityReadinessItem['status'],
  'unknown'
>;

export interface StaleOpportunityGovernanceRequest {
  recordId: string;
  status: StaleOpportunityGovernanceStatus;
  expectedStatus: StaleOpportunityReadinessItem['status'];
  expectedSourceVersion: string | null;
  followupRecordId: string | null;
  expectedFollowupSourceVersion: string | null;
  communicationAt?: string | null;
  idempotencyKey: string;
}

export interface StaleOpportunityGovernanceResponse {
  traceId: string;
  recordId: string;
  previousStatus: StaleOpportunityReadinessItem['status'];
  status: StaleOpportunityGovernanceStatus;
  followupRecordId: string | null;
  communicationAt: string | null;
  sourceVersion: string | null;
  followupSourceVersion: string | null;
}

export type StaleOpportunityTriggerStatus =
  | 'disabled'
  | 'complete'
  | 'incomplete';

export type StaleOpportunityTriggerSkipReason =
  | 'disabled'
  | 'integration_disabled'
  | 'source_unverified'
  | 'unverified_opportunity'
  | 'inactive'
  | 'owner_mismatch'
  | 'unverified_followup'
  | 'not_stale'
  | 'task_unverified'
  | 'task_already_open'
  | 'invalid_timezone'
  | 'quiet_hours'
  | 'stale_followup'
  | 'tenant_unavailable'
  | 'member_inactive'
  | 'member_tenant_mismatch'
  | 'authorization_denied'
  | 'permission_missing';

export interface StaleOpportunityTriggerCandidate {
  tenantId: string;
  memberId: string;
  opportunityRecordId: string;
  opportunityName: string;
  ownerOpenId: string;
  followupRecordId: string;
  lastEffectiveFollowupAt: string;
  followupVersion: string;
}

export interface StaleOpportunityTriggerSkip {
  tenantId: string | null;
  memberId: string | null;
  opportunityRecordId: string | null;
  opportunityName: string | null;
  reason: StaleOpportunityTriggerSkipReason;
}

export interface StaleOpportunityTriggerAuditEvidence {
  scope: 'batch' | 'tenant' | 'member';
  tenantId: string | null;
  memberId: string | null;
  outcome: 'completed' | 'skipped' | 'failed' | 'suppressed';
  code: string;
  candidateCount: number;
  skipCount: number;
}

export interface StaleOpportunityTriggerSummary {
  tenantCount: number;
  memberCount: number;
  scannedMemberCount: number;
  skippedMemberCount: number;
  incompleteMemberCount: number;
  candidateCount: number;
  suppressedCandidateCount: number;
  skipCount: number;
}

export interface StaleOpportunityTriggerResponse {
  traceId: string;
  generatedAt: string;
  mode: 'dry-run';
  status: StaleOpportunityTriggerStatus;
  summary: StaleOpportunityTriggerSummary;
  candidates: StaleOpportunityTriggerCandidate[];
  skips: StaleOpportunityTriggerSkip[];
  audit: StaleOpportunityTriggerAuditEvidence[];
  warnings: string[];
}

export type StaleOpportunityReminderRuntimeBlockReason =
  | 'scan_disabled'
  | 'trigger_token_missing'
  | 'history_governance_incomplete'
  | 'sender_unconfigured'
  | 'uncertain_delivery_present'
  | 'reconciliation_unavailable';

export interface StaleOpportunityReminderPreflightResponse {
  status: 'disabled' | 'blocked' | 'ready';
  checkedAt: string;
  reasons: StaleOpportunityReminderRuntimeBlockReason[];
  uncertainDeliveryFound: boolean;
}

export interface StaleOpportunityReminderPlanResponse {
  mode: 'plan-only';
  status: 'disabled' | 'blocked' | 'incomplete' | 'ready';
  generatedAt: string;
  preflight: StaleOpportunityReminderPreflightResponse;
  scanTraceId: string | null;
  summary: {
    candidateCount: number;
    suppressedCandidateCount: number;
  };
  items: StaleOpportunityTriggerCandidate[];
  warnings: string[];
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
  status: 'available' | 'planned';
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
    salesContext?: SalesContext;
    progressAssessment?: FollowupProgressSnapshot;
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
