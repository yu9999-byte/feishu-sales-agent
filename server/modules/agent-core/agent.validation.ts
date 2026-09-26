import { z } from 'zod';

import type {
  AgentExecutionResult,
  ConfirmationCardAction,
  FollowupDraft,
  FollowupMissingField,
  FollowupProgressSnapshot,
  FollowupTaskCandidate,
  JsonObject,
  PendingActionPayload,
  SalesContext,
} from '@shared/api.interface';
import type { TenantBaseMapping } from './agent.types';
import type {
  OpportunityLifecycleStatus,
  OpportunityStatusUpdateInput,
} from './agent.types';

const nullableTrimmedStringSchema = z
  .string()
  .trim()
  .min(1)
  .nullable();

const stringListSchema = z.array(z.string().trim().min(1)).max(20);

const followupDraftSchema = z.object({
  customerName: nullableTrimmedStringSchema,
  contactName: nullableTrimmedStringSchema,
  opportunityName: nullableTrimmedStringSchema,
  communicationMethod: nullableTrimmedStringSchema.optional(),
  communicationAt: nullableTrimmedStringSchema.optional(),
  topic: nullableTrimmedStringSchema.optional(),
  summary: z.string().trim().min(1).max(4000),
  customerNeeds: stringListSchema,
  objections: stringListSchema,
  risks: stringListSchema,
  progress: nullableTrimmedStringSchema,
  expectedAmount: z.number().nonnegative().finite().nullable(),
  nextAction: nullableTrimmedStringSchema,
  dueAt: nullableTrimmedStringSchema,
  nextActionChannel: nullableTrimmedStringSchema.optional(),
  nextActionParticipants: stringListSchema.optional(),
  agreements: stringListSchema.optional(),
  decisionChain: stringListSchema.optional(),
  competitors: stringListSchema.optional(),
  evidenceQuotes: stringListSchema,
});

const followupTaskCandidateSchema = z.object({
  id: z.string().trim().min(1),
  draftId: z.string().trim().min(1),
  draftVersion: z.number().int().positive(),
  ownerMemberId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  dueAt: nullableTrimmedStringSchema,
  channel: nullableTrimmedStringSchema,
  participants: stringListSchema,
  customerName: nullableTrimmedStringSchema,
  opportunityName: nullableTrimmedStringSchema,
  status: z.enum(['ready', 'needs_input']),
  missingFields: z.array(
    z.enum(['dueAt', 'pastDueAt', 'channel', 'participants']),
  ).max(3),
});

const progressAssessmentSchema = z.object({
  state: z.enum([
    'advanced', 'steady', 'needs_attention', 'at_risk', 'insufficient',
  ]),
  headline: z.string().trim().min(1),
  facts: z.array(z.object({
    id: z.string().trim().min(1),
    kind: z.enum(['message', 'customer', 'opportunity', 'followup', 'task']),
    label: z.string().trim().min(1),
    content: z.string().trim().min(1),
    quote: z.string().nullable(),
    source: z.object({
      recordId: z.string(),
      recordUrl: z.string().url().nullable(),
      sourceVersion: z.string().nullable(),
    }).nullable(),
  })).max(40),
  findings: z.array(z.object({
    id: z.string().trim().min(1),
    kind: z.enum(['change', 'gap', 'risk']),
    code: z.string().trim().min(1),
    title: z.string().trim().min(1),
    detail: z.string().trim().min(1),
    evidenceIds: z.array(z.string().trim().min(1)).max(20),
  })).max(40),
  recommendation: z.object({
    action: z.string().trim().min(1),
    dueAt: z.string().nullable(),
    reason: z.string().trim().min(1),
    evidenceIds: z.array(z.string().trim().min(1)).max(20),
    requiresConfirmation: z.literal(true),
    editableFields: z.array(z.enum(['nextAction', 'dueAt'])).max(2),
  }).nullable(),
  warnings: z.array(z.string()).max(20),
  assessedAt: z.string().datetime(),
});

const confirmationCardActionSchema = z.object({
  action: z.enum(['confirm', 'cancel', 'retry', 'edit']),
  pendingActionId: z.string().uuid(),
});

const pendingActionStatusSchema = z.enum([
  'pendingConfirmation',
  'executing',
  'succeeded',
  'partialFailure',
  'failed',
  'cancelled',
  'expired',
]);

const salesContextSchema = z.object({
  status: z.enum([
    'ready', 'partial', 'needs_clarification', 'unavailable',
  ]),
  customer: z.object({
    name: z.string(),
    contactName: z.string().nullable(),
    latestSummary: z.string().nullable(),
    lastFollowupAt: z.string().nullable(),
    source: z.object({
      recordId: z.string(),
      recordUrl: z.string().url().nullable(),
      sourceVersion: z.string().nullable(),
    }),
  }).nullable(),
  customerCandidates: z.array(z.object({
    name: z.string(),
    contactName: z.string().nullable(),
    latestSummary: z.string().nullable(),
    lastFollowupAt: z.string().nullable(),
    source: z.object({
      recordId: z.string(),
      recordUrl: z.string().url().nullable(),
      sourceVersion: z.string().nullable(),
    }),
  })).max(10),
  opportunities: z.array(z.object({
    name: z.string(),
    progress: z.string().nullable(),
    expectedAmount: z.number().nonnegative().nullable(),
    nextAction: z.string().nullable(),
    dueAt: z.string().nullable(),
    source: z.object({
      recordId: z.string(),
      recordUrl: z.string().url().nullable(),
      sourceVersion: z.string().nullable(),
    }),
  })).max(20),
  recentFollowups: z.array(z.object({
    summary: z.string(),
    opportunityRecordId: z.string().nullable().default(null),
    nextAction: z.string().nullable(),
    dueAt: z.string().nullable(),
    communicationAt: z.string().nullable().optional(),
    source: z.object({
      recordId: z.string(),
      recordUrl: z.string().url().nullable(),
      sourceVersion: z.string().nullable(),
    }),
  })).max(20),
  conflicts: z.array(z.object({
    field: z.enum(['nextAction', 'dueAt']),
    opportunityValue: z.string(),
    followupValue: z.string(),
    opportunitySource: z.object({
      recordId: z.string(),
      recordUrl: z.string().url().nullable(),
      sourceVersion: z.string().nullable(),
    }),
    followupSource: z.object({
      recordId: z.string(),
      recordUrl: z.string().url().nullable(),
      sourceVersion: z.string().nullable(),
    }),
    newerSource: z.enum(['opportunity', 'followup', 'same', 'unknown']),
  })).max(20).default([]),
  tasks: z.array(z.object({
    guid: z.string(),
    title: z.string(),
    status: z.string(),
    dueAt: z.string().nullable(),
    url: z.string().url().nullable(),
  })).max(20),
  warnings: z.array(z.string()).max(20),
  readAt: z.string().datetime(),
});

const parseSalesContext = (value: unknown): SalesContext =>
  salesContextSchema.parse(value) as unknown as SalesContext;

const parseProgressAssessment = (
  value: unknown,
): FollowupProgressSnapshot =>
  progressAssessmentSchema.parse(value) as unknown as FollowupProgressSnapshot;

const pendingActionPayloadSchema = z.object({
  version: z.literal(1),
  interactionStage: z.enum(['input', 'generating', 'draft']).optional(),
  sourceMessageId: z.string().trim().min(1),
  rawText: z.string(),
  draft: followupDraftSchema,
  draftVersion: z.number().int().nonnegative().optional(),
  ownerMemberId: z.string().trim().min(1).optional(),
  generatedBody: z.string().trim().min(1).max(10_000).optional(),
  quality: z.object({
    score: z.number().int().min(0).max(100),
    grade: z.enum(['A', 'B', 'C', 'D']),
    confirmable: z.boolean(),
    scoreVersion: z.string().trim().min(1),
    dimensions: z.object({
      basics: z.number().int().nonnegative(),
      dealFacts: z.number().int().nonnegative(),
      nextStep: z.number().int().nonnegative(),
      evidence: z.number().int().nonnegative(),
      writing: z.number().int().nonnegative(),
    }),
    missingItems: z.array(z.string()),
    invalidEvidence: z.array(z.object({
      field: z.string(),
      quote: z.string(),
    })),
    risks: z.array(z.string()),
    suggestions: z.array(z.string()),
  }).optional(),
  progressAssessment: progressAssessmentSchema.optional(),
  taskCandidates: z.array(followupTaskCandidateSchema).max(20).optional(),
  selectedTaskCandidateIds: z.array(
    z.string().trim().min(1),
  ).max(20).optional(),
  inputForm: z.object({
    communicationContent: z.string().trim().min(1).optional(),
    customerName: z.string().trim().min(1).optional(),
    contactName: z.string().trim().min(1).optional(),
    communicationMethod: z.string().trim().min(1).optional(),
    communicationAt: z.string().trim().min(1).optional(),
    topic: z.string().trim().min(1).optional(),
    nextAction: z.string().trim().min(1).optional(),
    dueAt: z.string().trim().min(1).optional(),
    nextActionChannel: z.string().trim().min(1).optional(),
    nextActionParticipants: stringListSchema.optional(),
    participants: stringListSchema.optional(),
  }).optional(),
  inputError: z.string().trim().min(1).optional(),
  salesContext: salesContextSchema.optional(),
  operationKind: z.enum(['create', 'update']).optional(),
  revisionOfActionId: z.string().uuid().optional(),
  executionTarget: z.object({
    customerRecordId: z.string().optional(),
    customerRecordUrl: z.string().url().optional(),
    opportunityRecordId: z.string().optional(),
    opportunityRecordUrl: z.string().url().optional(),
    followupRecordId: z.string().optional(),
    followupRecordUrl: z.string().url().optional(),
    taskGuid: z.string().optional(),
    taskUrl: z.string().url().optional(),
  }).optional(),
});

const agentExecutionResultSchema = z.object({
  pendingActionId: z.string().uuid(),
  status: pendingActionStatusSchema,
  customerRecordId: z.string().optional(),
  customerRecordUrl: z.string().url().optional(),
  opportunityRecordId: z.string().optional(),
  opportunityRecordUrl: z.string().url().optional(),
  followupRecordId: z.string().optional(),
  followupRecordUrl: z.string().url().optional(),
  taskGuid: z.string().optional(),
  taskUrl: z.string().url().optional(),
  taskAction: z.enum(['created', 'updated', 'unchanged', 'skipped']).optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
});

const optionalFieldNameSchema = z.string().trim().min(1).optional();
const opportunityStatusValuesSchema = z
  .array(z.string().trim().min(1))
  .min(1)
  .max(50);

const opportunityStatusSchema = z.enum([
  'active',
  'won',
  'lost',
  'closed',
]);

const opportunityStatusUpdateSchema = z.object({
  recordId: z.string().trim().min(1),
  status: opportunityStatusSchema,
  expectedStatus: z.enum([
    'active',
    'won',
    'lost',
    'closed',
    'unknown',
  ]),
});

const tenantBaseMappingSchema = z.object({
  appToken: z.string().trim().min(1),
  customers: z.object({
    tableId: z.string().trim().min(1),
    primaryField: z.string().trim().min(1),
    fields: z.object({
      customerName: z.string().trim().min(1),
      contactName: optionalFieldNameSchema,
      ownerOpenId: optionalFieldNameSchema,
      latestSummary: optionalFieldNameSchema,
      lastFollowupAt: optionalFieldNameSchema,
    }),
  }),
  opportunities: z.object({
    tableId: z.string().trim().min(1),
    primaryField: z.string().trim().min(1),
    fields: z.object({
      opportunityName: z.string().trim().min(1),
      customerLink: z.string().trim().min(1),
      status: optionalFieldNameSchema,
      expectedAmount: optionalFieldNameSchema,
      progress: optionalFieldNameSchema,
      nextAction: optionalFieldNameSchema,
      dueAt: optionalFieldNameSchema,
      ownerOpenId: optionalFieldNameSchema,
    }),
    statusValues: z.object({
      active: opportunityStatusValuesSchema,
      won: opportunityStatusValuesSchema.optional(),
      lost: opportunityStatusValuesSchema.optional(),
      closed: opportunityStatusValuesSchema.optional(),
    }).optional(),
  }),
  followups: z.object({
    tableId: z.string().trim().min(1),
    primaryField: z.string().trim().min(1),
    fields: z.object({
      sourceMessageId: z.string().trim().min(1),
      customerLink: z.string().trim().min(1),
      opportunityLink: z.string().trim().min(1),
      rawText: z.string().trim().min(1),
      summary: z.string().trim().min(1),
      customerNeeds: optionalFieldNameSchema,
      objections: optionalFieldNameSchema,
      risks: optionalFieldNameSchema,
      nextAction: optionalFieldNameSchema,
      dueAt: optionalFieldNameSchema,
      communicationAt: optionalFieldNameSchema,
      ownerOpenId: optionalFieldNameSchema,
    }),
  }),
});

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

const parseFollowupDraft = (value: unknown): FollowupDraft => {
  const parsed = followupDraftSchema.parse(value);
  const draft: FollowupDraft = {
    customerName: parsed.customerName ?? null,
    contactName: parsed.contactName ?? null,
    opportunityName: parsed.opportunityName ?? null,
    summary: parsed.summary,
    customerNeeds: parsed.customerNeeds,
    objections: parsed.objections,
    risks: parsed.risks,
    progress: parsed.progress ?? null,
    expectedAmount: parsed.expectedAmount ?? null,
    nextAction: parsed.nextAction ?? null,
    dueAt: parsed.dueAt ?? null,
    evidenceQuotes: parsed.evidenceQuotes,
  };
  if (parsed.nextActionChannel !== undefined) {
    draft.nextActionChannel = parsed.nextActionChannel;
  }
  if (parsed.nextActionParticipants !== undefined) {
    draft.nextActionParticipants = parsed.nextActionParticipants;
  }
  if (parsed.agreements !== undefined) {
    draft.agreements = parsed.agreements;
  }
  if (parsed.decisionChain !== undefined) {
    draft.decisionChain = parsed.decisionChain;
  }
  if (parsed.competitors !== undefined) {
    draft.competitors = parsed.competitors;
  }
  if (parsed.communicationMethod !== undefined) {
    draft.communicationMethod = parsed.communicationMethod;
  }
  if (parsed.communicationAt !== undefined) {
    draft.communicationAt = parsed.communicationAt;
  }
  if (parsed.topic !== undefined) {
    draft.topic = parsed.topic;
  }
  return draft;
};

const parseConfirmationCardAction = (
  value: unknown,
): ConfirmationCardAction => confirmationCardActionSchema.parse(value);

const parseTenantBaseMapping = (value: unknown): TenantBaseMapping =>
  tenantBaseMappingSchema.parse(value);

const parseOpportunityStatusUpdate = (
  value: unknown,
): OpportunityStatusUpdateInput => {
  const parsed = opportunityStatusUpdateSchema.parse(value);
  const expectedStatus: OpportunityLifecycleStatus = parsed.expectedStatus;
  return {
    recordId: parsed.recordId,
    status: parsed.status,
    expectedStatus,
  };
};

const parseJsonObject = (value: unknown): JsonObject =>
  jsonObjectSchema.parse(value) as JsonObject;

const parsePendingActionPayload = (
  value: unknown,
): PendingActionPayload => {
  const parsed = pendingActionPayloadSchema.parse(value);
  const taskCandidates: FollowupTaskCandidate[] | undefined =
    parsed.taskCandidates?.map((candidate): FollowupTaskCandidate => ({
      id: candidate.id,
      draftId: candidate.draftId,
      draftVersion: candidate.draftVersion,
      ownerMemberId: candidate.ownerMemberId,
      title: candidate.title,
      dueAt: candidate.dueAt ?? null,
      channel: candidate.channel ?? null,
      participants: candidate.participants,
      customerName: candidate.customerName ?? null,
      opportunityName: candidate.opportunityName ?? null,
      status: candidate.status,
      missingFields: candidate.missingFields,
    }));
  return {
    version: 1,
    interactionStage: parsed.interactionStage,
    sourceMessageId: parsed.sourceMessageId,
    rawText: parsed.rawText,
    draft: parseFollowupDraft(parsed.draft),
    draftVersion: parsed.draftVersion,
    ownerMemberId: parsed.ownerMemberId,
    generatedBody: parsed.generatedBody,
    quality: parsed.quality,
    progressAssessment: parsed.progressAssessment === undefined
      ? undefined
      : parseProgressAssessment(parsed.progressAssessment),
    taskCandidates,
    selectedTaskCandidateIds: parsed.selectedTaskCandidateIds,
    inputForm: parsed.inputForm,
    inputError: parsed.inputError,
    salesContext: parsed.salesContext === undefined
      ? undefined
      : parseSalesContext(parsed.salesContext),
    operationKind: parsed.operationKind,
    revisionOfActionId: parsed.revisionOfActionId,
    executionTarget: parsed.executionTarget,
  };
};

const parseAgentExecutionResult = (
  value: unknown,
): AgentExecutionResult => agentExecutionResultSchema.parse(value);

const getMissingFields = (
  draft: FollowupDraft,
): FollowupMissingField[] => {
  const fields: FollowupMissingField[] = [];

  if (!draft.customerName) {
    fields.push('customerName');
  }
  if (!draft.nextAction) {
    fields.push('nextAction');
  }
  if (!draft.dueAt || Number.isNaN(Date.parse(draft.dueAt))) {
    fields.push('dueAt');
  }

  return fields;
};

export {
  agentExecutionResultSchema,
  confirmationCardActionSchema,
  followupDraftSchema,
  getMissingFields,
  jsonObjectSchema,
  parseConfirmationCardAction,
  parseAgentExecutionResult,
  parseFollowupDraft,
  parseJsonObject,
  parsePendingActionPayload,
  parseProgressAssessment,
  parseSalesContext,
  salesContextSchema,
  parseTenantBaseMapping,
  opportunityStatusUpdateSchema,
  parseOpportunityStatusUpdate,
  pendingActionPayloadSchema,
  tenantBaseMappingSchema,
};
