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

export type OpportunityDecisionStatus =
  | 'ready'
  | 'partial'
  | 'empty'
  | 'unavailable';

export type OpportunityDecisionHealth =
  | 'critical'
  | 'at_risk'
  | 'needs_attention'
  | 'on_track';

export type OpportunityDecisionRiskCode =
  | 'next_action_overdue'
  | 'followup_stale'
  | 'followup_time_missing'
  | 'no_followup_evidence'
  | 'lifecycle_unknown'
  | 'confirmed_task_overdue'
  | 'confirmed_task_changed';

export type OpportunityDecisionGapCode =
  | 'customer_missing'
  | 'progress_missing'
  | 'amount_missing'
  | 'next_action_missing'
  | 'due_at_missing';

export type OpportunityDecisionEvidenceKind =
  | 'customer'
  | 'opportunity'
  | 'followup'
  | 'task_promise';

export interface OpportunityDecisionEvidence {
  id: string;
  kind: OpportunityDecisionEvidenceKind;
  label: string;
  value: string;
  occurredAt: string | null;
  source: DailySalesReportSource | null;
}

export interface OpportunityDecisionRisk {
  code: OpportunityDecisionRiskCode;
  severity: 'high' | 'medium';
  title: string;
  detail: string;
  evidenceIds: string[];
}

export interface OpportunityDecisionGap {
  code: OpportunityDecisionGapCode;
  title: string;
  detail: string;
  evidenceIds: string[];
}

export interface OpportunityDecisionRecommendation {
  action: string;
  reason: string;
  dueAt: string | null;
  evidenceIds: string[];
  requiresConfirmation: true;
}

export interface OpportunityDecisionTaskPromise {
  pendingActionId: string;
  taskGuid: string | null;
  title: string;
  status: TaskPromiseStatus;
  dueAt: string | null;
  suggestedAction: string;
}

export interface OpportunityDecisionItem {
  rank: number;
  recordId: string;
  recordUrl: string | null;
  name: string;
  customerRecordId: string | null;
  customerName: string | null;
  lifecycleStatus: OpportunityStatusActionLifecycleStatus;
  expectedAmount: number | null;
  progress: string | null;
  lastFollowupAt: string | null;
  lastFollowupSummary: string | null;
  nextAction: string | null;
  dueAt: string | null;
  health: OpportunityDecisionHealth;
  priorityScore: number;
  risks: OpportunityDecisionRisk[];
  gaps: OpportunityDecisionGap[];
  recommendation: OpportunityDecisionRecommendation | null;
  taskPromises: OpportunityDecisionTaskPromise[];
  evidence: OpportunityDecisionEvidence[];
}

export interface OpportunityDecisionCustomer {
  recordId: string;
  recordUrl: string | null;
  name: string;
  contactName: string | null;
  latestSummary: string | null;
  lastFollowupAt: string | null;
  activeOpportunityCount: number;
  criticalOpportunityCount: number;
  atRiskOpportunityCount: number;
  totalExpectedAmount: number | null;
  topPriorityRank: number | null;
  topRecommendation: string | null;
}

export interface OpportunityDecisionGlobalTaskAlert {
  code: 'overdue_tasks' | 'unlinked_promises' | 'task_source_incomplete';
  severity: 'high' | 'medium';
  title: string;
  detail: string;
  count: number;
}

export interface OpportunityDecisionSummary {
  totalOpportunityCount: number;
  activeOpportunityCount: number;
  excludedClosedOpportunityCount: number;
  criticalCount: number;
  atRiskCount: number;
  needsAttentionCount: number;
  onTrackCount: number;
}

export interface OpportunityDecisionCoverage {
  scope: 'self';
  customers: 'complete' | 'partial' | 'unavailable';
  opportunities: 'complete' | 'partial' | 'unavailable';
  followups: 'complete' | 'partial' | 'unavailable';
  taskPromises: 'agent_confirmed_only' | 'unavailable';
  taskAssociation: 'explicit_agent_confirmation_only';
}

export interface OpportunityDecisionResponse {
  referenceDate: string;
  timezone: string;
  status: OpportunityDecisionStatus;
  generatedAt: string;
  summary: OpportunityDecisionSummary;
  customers: OpportunityDecisionCustomer[];
  priorities: OpportunityDecisionItem[];
  globalTaskAlerts: OpportunityDecisionGlobalTaskAlert[];
  coverage: OpportunityDecisionCoverage;
  warnings: string[];
}

export type CustomerVisitBriefingStatus =
  | 'ready'
  | 'partial'
  | 'empty'
  | 'unavailable';

export interface CustomerVisitBriefingSource {
  recordId: string;
  recordUrl: string | null;
  sourceVersion: string | null;
}

export interface CustomerVisitBriefingCustomer {
  recordId: string;
  name: string;
  contactName: string | null;
  latestSummary: string | null;
  lastFollowupAt: string | null;
  source: CustomerVisitBriefingSource;
}

export interface CustomerVisitBriefingOpportunity {
  recordId: string;
  name: string;
  lifecycleStatus: OpportunityStatusActionLifecycleStatus;
  expectedAmount: number | null;
  progress: string | null;
  nextAction: string | null;
  dueAt: string | null;
  health: OpportunityDecisionHealth | null;
  risks: OpportunityDecisionRisk[];
  gaps: OpportunityDecisionGap[];
  recommendation: OpportunityDecisionRecommendation | null;
  source: CustomerVisitBriefingSource;
}

export interface CustomerVisitBriefingFollowup {
  recordId: string;
  opportunityRecordId: string | null;
  opportunityName: string | null;
  summary: string;
  communicationAt: string | null;
  nextAction: string | null;
  dueAt: string | null;
  source: CustomerVisitBriefingSource;
}

export type CustomerVisitBriefingQuestionCode =
  | 'contact_missing'
  | 'customer_summary_missing'
  | 'progress_missing'
  | 'amount_missing'
  | 'next_action_missing'
  | 'due_at_missing'
  | 'next_action_overdue'
  | 'followup_stale'
  | 'followup_time_missing'
  | 'no_followup_evidence'
  | 'lifecycle_unknown'
  | 'confirmed_task_overdue'
  | 'confirmed_task_changed';

export interface CustomerVisitBriefingQuestion {
  code: CustomerVisitBriefingQuestionCode;
  question: string;
  reason: string;
  opportunityRecordId: string | null;
}

export interface CustomerVisitBriefingAgendaItem {
  sequence: number;
  title: string;
  purpose: string;
}

export interface CustomerVisitBriefingMetrics {
  relatedOpportunityCount: number;
  activeOpportunityCount: number;
  riskOpportunityCount: number;
  totalFollowupCount: number;
  knownActiveExpectedAmount: number | null;
}

export interface CustomerVisitBriefingCoverage {
  scope: 'self';
  customers: 'complete' | 'partial' | 'unavailable';
  opportunities: 'complete' | 'partial' | 'unavailable';
  followups: 'complete' | 'partial' | 'unavailable';
  taskPromises: 'agent_confirmed_only' | 'unavailable';
  associations: 'explicit_record_links_only';
}

export interface CustomerVisitBriefingResponse {
  referenceDate: string;
  timezone: string;
  status: CustomerVisitBriefingStatus;
  generatedAt: string;
  customer: CustomerVisitBriefingCustomer | null;
  metrics: CustomerVisitBriefingMetrics;
  opportunities: CustomerVisitBriefingOpportunity[];
  recentFollowups: CustomerVisitBriefingFollowup[];
  questions: CustomerVisitBriefingQuestion[];
  agenda: CustomerVisitBriefingAgendaItem[];
  coverage: CustomerVisitBriefingCoverage;
  warnings: string[];
}

export type CustomerCommunicationPreparationStatus =
  | 'ready'
  | 'partial'
  | 'empty'
  | 'unavailable';

export type CustomerCommunicationEvidenceKind =
  | 'customer'
  | 'opportunity'
  | 'followup';

export interface CustomerCommunicationEvidence {
  key: string;
  kind: CustomerCommunicationEvidenceKind;
  label: string;
  value: string;
  occurredAt: string | null;
  source: CustomerVisitBriefingSource;
}

export interface CustomerCommunicationObjective {
  id: string;
  title: string;
  detail: string;
  sourceKeys: string[];
}

export interface CustomerCommunicationAngle {
  id: string;
  title: string;
  guidance: string;
  sourceKeys: string[];
}

export interface CustomerCommunicationQuestion {
  code: CustomerVisitBriefingQuestionCode;
  question: string;
  reason: string;
  opportunityRecordId: string | null;
  sourceKeys: string[];
}

export type CustomerCommunicationMaterialCategory =
  | 'customer_context'
  | 'needs_checklist'
  | 'solution_overview'
  | 'case_reference'
  | 'commercial_boundary'
  | 'meeting_agenda';

export interface CustomerCommunicationPendingMaterial {
  id: string;
  category: CustomerCommunicationMaterialCategory;
  title: string;
  purpose: string;
  reason: string;
  status: 'material_pending';
  sourceKeys: string[];
}

export type SalesMaterialSourceType = 'docx' | 'wiki';

export interface CustomerCommunicationRecommendedMaterial {
  id: string;
  category: CustomerCommunicationMaterialCategory;
  title: string;
  purpose: string;
  reason: string;
  status: 'recommended';
  sourceKeys: string[];
  sourceType: SalesMaterialSourceType;
  url: string;
  matchReason: string;
  excerpt: string;
  citation: string;
  sourceVersion: string;
  applicability: string;
  accessVerified: true;
}

export type CustomerCommunicationMaterial =
  | CustomerCommunicationPendingMaterial
  | CustomerCommunicationRecommendedMaterial;

export type CustomerCommunicationMaterialSearchStatus =
  | 'ready'
  | 'not_configured'
  | 'no_trusted_match'
  | 'partial'
  | 'unavailable';

export interface CustomerCommunicationMaterialSearch {
  status: CustomerCommunicationMaterialSearchStatus;
  configuredSourceCount: number;
  checkedSourceCount: number;
  trustedResultCount: number;
  warnings: string[];
}

export type SalesKnowledgeQaStatus =
  | 'answered'
  | 'partial'
  | 'not_configured'
  | 'no_trusted_match'
  | 'unavailable';

export interface SalesKnowledgeCitation {
  sourceId: string;
  sourceType: SalesMaterialSourceType;
  title: string;
  url: string;
  matchedTerms: string[];
  excerpt: string;
  citation: string;
  sourceVersion: string;
  applicability: string;
  accessVerified: true;
}

export interface SalesKnowledgeQaResponse {
  status: SalesKnowledgeQaStatus;
  answer: string;
  configuredSourceCount: number;
  checkedSourceCount: number;
  trustedResultCount: number;
  citations: SalesKnowledgeCitation[];
  warnings: string[];
}

export type PlaybookOptimizationCandidateStatus =
  | 'observing'
  | 'pending_review'
  | 'accepted_for_authoring'
  | 'dismissed';

export type PlaybookOptimizationReason =
  | 'no_trusted_answer'
  | 'frequent_question'
  | 'source_unavailable'
  | 'source_revision_changed';

export interface PlaybookOptimizationSourceRef {
  sourceId: string;
  sourceVersion: string | null;
}

export interface PlaybookOptimizationCandidate {
  id: string;
  topicPreview: string;
  lastQaStatus: SalesKnowledgeQaStatus;
  occurrenceCount: number;
  reasons: PlaybookOptimizationReason[];
  sources: PlaybookOptimizationSourceRef[];
  status: PlaybookOptimizationCandidateStatus;
  firstObservedAt: string;
  lastObservedAt: string;
  updatedAt: string;
}

export interface PlaybookOptimizationCandidateListResponse {
  status: 'ready';
  items: PlaybookOptimizationCandidate[];
  summary: {
    pendingReview: number;
    observing: number;
    acceptedForAuthoring: number;
    dismissed: number;
  };
}

export type PlaybookOptimizationReviewDecision =
  | 'accept_for_authoring'
  | 'dismiss';

export interface PlaybookOptimizationReviewRequest {
  decision: PlaybookOptimizationReviewDecision;
  expectedUpdatedAt: string;
  note: string;
}

export interface PlaybookOptimizationReviewResponse {
  candidate: PlaybookOptimizationCandidate;
  reviewId: string;
}

export type CustomerCommunicationDraftChannel = 'feishu' | 'email';

export interface CustomerCommunicationDraft {
  channel: CustomerCommunicationDraftChannel;
  title: string;
  subject: string | null;
  body: string;
  editable: true;
  execution: 'preview_only';
  sourceKeys: string[];
}

export interface CustomerCommunicationPreparationResponse {
  referenceDate: string;
  timezone: string;
  status: CustomerCommunicationPreparationStatus;
  generatedAt: string;
  customer: CustomerVisitBriefingCustomer | null;
  objective: CustomerCommunicationObjective | null;
  angles: CustomerCommunicationAngle[];
  questions: CustomerCommunicationQuestion[];
  materials: CustomerCommunicationMaterial[];
  materialSearch: CustomerCommunicationMaterialSearch;
  drafts: CustomerCommunicationDraft[];
  evidence: CustomerCommunicationEvidence[];
  coverage: CustomerVisitBriefingCoverage;
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

export type TeamOpportunityDecisionStatus =
  | 'ready'
  | 'partial'
  | 'empty'
  | 'unavailable';

export interface TeamOpportunityDecisionMetrics {
  memberCount: number;
  readableMemberCount: number;
  activeOpportunityCount: number;
  criticalCount: number;
  atRiskCount: number;
  needsAttentionCount: number;
  onTrackCount: number;
  knownExpectedAmount: number | null;
}

export interface TeamOpportunityDecisionItem {
  teamRank: number;
  memberRank: number;
  ownerMemberId: string;
  ownerDisplayName: string;
  opportunity: OpportunityDecisionItem;
}

export interface TeamOpportunityDecisionMember {
  memberId: string;
  displayName: string;
  status: OpportunityDecisionStatus;
  activeOpportunityCount: number;
  criticalCount: number;
  atRiskCount: number;
  needsAttentionCount: number;
  onTrackCount: number;
  knownExpectedAmount: number | null;
  topTeamRank: number | null;
  topOpportunityName: string | null;
  topRecommendation: string | null;
  warnings: string[];
}

export interface TeamOpportunityDecisionManagerAction {
  ownerMemberId: string;
  ownerDisplayName: string;
  opportunityRecordId: string;
  opportunityName: string;
  action: string;
  reason: string;
  requiresConfirmation: true;
}

export interface TeamOpportunityDecisionTaskAlert
  extends OpportunityDecisionGlobalTaskAlert {
  ownerMemberId: string;
  ownerDisplayName: string;
}

export interface TeamOpportunityDecisionResponse {
  referenceDate: string;
  timezone: string;
  status: TeamOpportunityDecisionStatus;
  generatedAt: string;
  scope: 'team' | 'tenant';
  metrics: TeamOpportunityDecisionMetrics;
  priorities: TeamOpportunityDecisionItem[];
  members: TeamOpportunityDecisionMember[];
  managerActions: TeamOpportunityDecisionManagerAction[];
  taskAlerts: TeamOpportunityDecisionTaskAlert[];
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

export interface StaleOpportunityReminderExecutionRequest {
  opportunityRecordId: string;
  followupVersion: string;
}

export type StaleOpportunityReminderExecutionStatus =
  | 'disabled'
  | 'blocked'
  | 'incomplete'
  | 'candidate_not_found'
  | 'candidate_ambiguous'
  | 'candidate_not_allowed'
  | 'completed'
  | 'halted';

export type StaleOpportunityReminderExecutionReason =
  | 'delivered'
  | 'cooling_down'
  | 'in_flight'
  | 'retry_scheduled'
  | 'delivery_unknown'
  | 'disabled'
  | 'owner_mismatch'
  | 'invalid_evidence'
  | 'delivery_failed'
  | 'finalization_conflict'
  | 'source_unverified'
  | 'tenant_unavailable'
  | 'authorization_denied'
  | 'permission_missing'
  | 'candidate_changed'
  | 'execution_unavailable';

export interface StaleOpportunityReminderExecutionOutcome {
  status: 'sent' | 'skipped' | 'failed';
  reason: StaleOpportunityReminderExecutionReason;
  messageId?: string;
  retryAt?: string;
}

export interface StaleOpportunityReminderExecutionResponse {
  mode: 'controlled-delivery';
  status: StaleOpportunityReminderExecutionStatus;
  generatedAt: string;
  planTraceId: string | null;
  candidate: StaleOpportunityTriggerCandidate | null;
  outcome: StaleOpportunityReminderExecutionOutcome | null;
  warnings: string[];
}

export type StaleOpportunityReminderExecutionReadinessBlocker =
  | 'execution_enabled'
  | 'reminder_enabled'
  | 'execution_token_missing'
  | 'execution_token_reused'
  | 'scan_disabled'
  | 'scan_token_missing'
  | 'execution_allowlist_incomplete'
  | 'target_tenant_unavailable'
  | 'target_tenant_inactive'
  | 'target_member_unavailable'
  | 'target_member_inactive'
  | 'recipient_open_id_mismatch'
  | 'permission_missing'
  | 'data_source_unconfigured'
  | 'history_governance_incomplete'
  | 'sender_unconfigured'
  | 'sender_evidence_incomplete'
  | 'uncertain_delivery_present'
  | 'reconciliation_unavailable'
  | 'candidate_probe_incomplete'
  | 'candidate_not_found'
  | 'candidate_ambiguous'
  | 'candidate_not_allowed';

export interface StaleOpportunityReminderExecutionReadinessConfiguration {
  executionEnabled: boolean;
  reminderEnabled: boolean;
  scanEnabled: boolean;
  executionTokenConfigured: boolean;
  scanTokenConfigured: boolean;
  executionTokenDistinctFromScan: boolean;
  allowlistConfigured: boolean;
  historyGovernanceReady: boolean;
  senderConfigured: boolean;
}

export interface StaleOpportunityReminderExecutionReadinessTarget {
  tenantId: string | null;
  tenantName: string | null;
  tenantStatus: 'active' | 'inactive' | 'unavailable' | 'not_configured';
  memberId: string | null;
  memberDisplayName: string | null;
  memberStatus: 'active' | 'inactive' | 'unavailable' | 'not_configured';
  recipientOpenId: string | null;
  recipientOpenIdMatches: boolean | null;
  permissionGranted: boolean | null;
  dataSourceConfigured: boolean | null;
}

export interface StaleOpportunityReminderExecutionReadinessLedger {
  status: 'clear' | 'uncertain' | 'unavailable' | 'not_checked';
  uncertainDeliveryFound: boolean;
}

export interface StaleOpportunityReminderHistoryGovernanceEvidence {
  status: 'complete' | 'incomplete' | 'unavailable' | 'not_checked';
  checkedAt: string;
  summary: StaleOpportunityReadinessSummary;
  pendingItems: StaleOpportunityReadinessItem[];
  warnings: string[];
}

export type StaleOpportunityReminderSenderScope =
  | 'im:message'
  | 'im:message:send_as_bot'
  | 'im:message:send';

export interface StaleOpportunityReminderSenderEvidence {
  status: 'complete' | 'incomplete' | 'unavailable' | 'not_checked';
  checkedAt: string;
  credentialsStatus: 'valid' | 'unavailable' | 'not_checked';
  botStatus: 'enabled' | 'disabled' | 'unavailable' | 'not_checked';
  botOpenIdPresent: boolean;
  sendPermissionStatus: 'granted' | 'missing' | 'unavailable' | 'not_checked';
  grantedSendScope: StaleOpportunityReminderSenderScope | null;
  recipientVisibility: {
    status: 'visible' | 'not_visible' | 'unavailable' | 'not_checked';
    inspectionPermissionGranted: boolean;
  };
  warnings: string[];
}

export interface StaleOpportunityReminderExecutionReadinessCandidateProbe {
  status: 'complete' | 'incomplete' | 'disabled' | 'not_checked';
  traceId: string | null;
  candidateCount: number;
  matchingCandidateCount: number;
  items: StaleOpportunityTriggerCandidate[];
  warnings: string[];
}

export interface StaleOpportunityReminderExecutionReadinessResponse {
  mode: 'read-only';
  status: 'blocked' | 'ready_for_manual_activation';
  checkedAt: string;
  configuration: StaleOpportunityReminderExecutionReadinessConfiguration;
  target: StaleOpportunityReminderExecutionReadinessTarget;
  historyGovernance: StaleOpportunityReminderHistoryGovernanceEvidence;
  senderEvidence: StaleOpportunityReminderSenderEvidence;
  ledger: StaleOpportunityReminderExecutionReadinessLedger;
  candidateProbe: StaleOpportunityReminderExecutionReadinessCandidateProbe;
  blockers: StaleOpportunityReminderExecutionReadinessBlocker[];
  warnings: string[];
}

export type StaleOpportunityReminderScheduleObservationStatus =
  | 'blocked'
  | 'ready'
  | 'unavailable'
  | 'incomplete';

export interface StaleOpportunityReminderScheduleObservationSummary {
  executionReadinessStatus:
    | StaleOpportunityReminderExecutionReadinessResponse['status']
    | 'unavailable';
  blockerCount: number;
  warningCount: number;
  historyGovernanceStatus:
    | StaleOpportunityReminderHistoryGovernanceEvidence['status']
    | 'not_checked';
  senderEvidenceStatus:
    | StaleOpportunityReminderSenderEvidence['status']
    | 'not_checked';
  ledgerStatus:
    | StaleOpportunityReminderExecutionReadinessLedger['status']
    | 'not_checked';
  candidateProbeStatus:
    StaleOpportunityReminderExecutionReadinessCandidateProbe['status'];
  candidateCount: number;
  matchingCandidateCount: number;
}

export interface StaleOpportunityReminderScheduleObservationResponse {
  mode: 'read-only-observation';
  traceId: string;
  status: StaleOpportunityReminderScheduleObservationStatus;
  observedAt: string;
  blockers: StaleOpportunityReminderExecutionReadinessBlocker[];
  summary: StaleOpportunityReminderScheduleObservationSummary;
  auditRecorded: boolean;
  warnings: string[];
}

export type StaleOpportunityReminderKind = 'stale_followup';

export type StaleOpportunityReminderReconciliationDecision =
  | 'confirm_sent'
  | 'authorize_retry'
  | 'keep_frozen';

export interface StaleOpportunityReminderReconciliationItem {
  tenantId: string;
  opportunityRecordId: string;
  followupVersion: string;
  reminderKind: StaleOpportunityReminderKind;
  opportunityName: string;
  ownerOpenId: string;
  attemptCount: number;
  dispatchStartedAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  updatedAt: string;
}

export interface StaleOpportunityReminderReconciliationListResponse {
  status: 'ready' | 'unavailable';
  items: StaleOpportunityReminderReconciliationItem[];
  warnings: string[];
}

export interface StaleOpportunityReminderReconciliationRequest {
  opportunityRecordId: string;
  followupVersion: string;
  reminderKind: StaleOpportunityReminderKind;
  expectedUpdatedAt: string;
  decision: StaleOpportunityReminderReconciliationDecision;
  note: string;
  messageId?: string;
  sentAt?: string;
}

export interface StaleOpportunityReminderReconciliationResponse {
  reconciliationId: string;
  opportunityRecordId: string;
  followupVersion: string;
  reminderKind: StaleOpportunityReminderKind;
  decision: StaleOpportunityReminderReconciliationDecision;
  previousStatus: 'uncertain';
  currentStatus: 'sent' | 'failed' | 'uncertain';
  updatedAt: string;
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
