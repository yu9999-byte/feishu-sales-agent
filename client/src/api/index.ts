import axios from 'axios';
import { axiosForBackend } from
  '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

import type {
  AgentExecutionResult,
  ConfirmPreparationDeliveryRequest,
  ConfirmPreparationDeliveryResponse,
  ConfirmFollowupDraftRequest,
  CreateFollowupDraftRequest,
  CustomerCommunicationPreparationResponse,
  CustomerPreparationDeliveryStatus,
  CustomerPreparationResultSnapshot,
  SaveCustomerPreparationDraftRequest,
  CustomerVisitBriefingResponse,
  DailySalesReportResponse,
  FollowupDraftResponse,
  OpportunityDecisionResponse,
  PlaybookOptimizationCandidateListResponse,
  PlaybookOptimizationReviewRequest,
  PlaybookOptimizationReviewResponse,
  PlaybookDraftResponse,
  PlaybookDraftVersion,
  SavePlaybookDraftRequest,
  ProactiveNotificationReconciliationListResponse,
  ProactiveNotificationReconciliationRequest,
  ProactiveNotificationReconciliationResponse,
  UpdateFollowupDraftRequest,
  PlatformSectionKey,
  PlatformSectionResponse,
  PlatformSessionResponse,
  StaleOpportunityGovernanceRequest,
  StaleOpportunityGovernanceResponse,
  StaleOpportunityReadinessResponse,
  TaskFulfillmentResponse,
  TodayActionResponse,
  TodayActionDraftRequest,
  TodayActionDraftResponse,
  TodayActionTaskDraftRequest,
  TodayActionTaskDraftResponse,
  TodayActionTaskConfirmResponse,
  TodayActionTaskStatusResponse,
  TodayActionOperationRequest,
  TodayActionState,
  TeamOpportunityDecisionResponse,
  TeamReviewResponse,
  WorkspaceResponse,
} from '@shared/api.interface';

interface ProductApiError {
  status: number;
  message: string;
  retryable: boolean;
  code?: string;
  traceId?: string;
}

const normalizeError = (error: unknown): ProductApiError => {
  if (axios.isAxiosError(error)) {
    const status: number = error.response?.status ?? 0;
    const body: unknown = error.response?.data;
    const apiBody: {
      code?: unknown;
      message?: unknown;
      traceId?: unknown;
    } = typeof body === 'object' && body !== null
      ? body as {
        code?: unknown;
        message?: unknown;
        traceId?: unknown;
      }
      : {};
    const bodyMessage: string | undefined =
      typeof apiBody.message === 'string' ? apiBody.message : undefined;
    const bodyCode: string | undefined =
      typeof apiBody.code === 'string' ? apiBody.code : undefined;
    const bodyTraceId: string | undefined =
      typeof apiBody.traceId === 'string' ? apiBody.traceId : undefined;
    if (status === 401) {
      return { status, message: '请先通过飞书登录', retryable: false };
    }
    if (status === 403) {
      return {
        status,
        message: bodyMessage ?? '无权访问当前工作区',
        retryable: false,
        code: bodyCode,
        traceId: bodyTraceId,
      };
    }
    if (status === 409) {
      return {
        status,
        message: bodyMessage ?? '版本已变化，请刷新后再试',
        retryable: false,
        code: bodyCode,
        traceId: bodyTraceId,
      };
    }
    if (status === 422) {
      return {
        status,
        message: bodyMessage ?? '请补全确认信息后再提交',
        retryable: false,
        code: bodyCode,
        traceId: bodyTraceId,
      };
    }
    if (status === 503) {
      return {
        status,
        message: bodyMessage ?? '数据源暂时不可用，请稍后重试',
        retryable: true,
        code: bodyCode,
        traceId: bodyTraceId,
      };
    }
    return {
      status,
      message: bodyMessage ?? '暂时无法加载数据，请稍后重试',
      retryable: true,
      code: bodyCode,
      traceId: bodyTraceId,
    };
  }
  return {
    status: 0,
    message: '暂时无法加载数据，请稍后重试',
    retryable: true,
  };
};

const getPlatformSession = async (): Promise<PlatformSessionResponse> => {
  try {
    const response = await axiosForBackend<PlatformSessionResponse>({
      url: '/api/platform/session',
      method: 'GET',
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const getWorkspace = async (): Promise<WorkspaceResponse> => {
  try {
    const response = await axiosForBackend<WorkspaceResponse>({
      url: '/api/platform/workspace',
      method: 'GET',
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const getDailySalesReport = async (
  reportDate?: string,
): Promise<DailySalesReportResponse> => {
  try {
    const query: string = reportDate
      ? `?date=${encodeURIComponent(reportDate)}`
      : '';
    const response = await axiosForBackend<DailySalesReportResponse>({
      url: `/api/platform/daily-report${query}`,
      method: 'GET',
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const getTeamReview = async (
  reviewDate?: string,
): Promise<TeamReviewResponse> => {
  try {
    const query: string = reviewDate
      ? `?date=${encodeURIComponent(reviewDate)}`
      : '';
    const response = await axiosForBackend<TeamReviewResponse>({
      url: `/api/platform/team-review${query}`,
      method: 'GET',
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const getTeamOpportunityDecisions = async (
  referenceDate?: string,
): Promise<TeamOpportunityDecisionResponse> => {
  try {
    const query: string = referenceDate
      ? `?date=${encodeURIComponent(referenceDate)}`
      : '';
    const response = await axiosForBackend<TeamOpportunityDecisionResponse>({
      url: `/api/platform/team-opportunity-decisions${query}`,
      method: 'GET',
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const createTodayFollowupDraft = async (input: TodayActionDraftRequest): Promise<TodayActionDraftResponse> => {
  try {
    const response = await axiosForBackend<TodayActionDraftResponse>({
      url: '/api/platform/today-actions/followup-drafts',
      method: 'POST',
      data: input,
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) { throw normalizeError(error); }
};

const createTodayTaskDraft = async (input: TodayActionTaskDraftRequest): Promise<TodayActionTaskDraftResponse> => {
  try {
    const response = await axiosForBackend<TodayActionTaskDraftResponse>({
      url: '/api/platform/today-actions/task-drafts',
      method: 'POST',
      data: input,
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) { throw normalizeError(error); }
};

const confirmTodayTaskDraft = async (actionId: string): Promise<TodayActionTaskConfirmResponse> => {
  try {
    const response = await axiosForBackend<TodayActionTaskConfirmResponse>({
      url: `/api/platform/today-actions/task-drafts/${encodeURIComponent(actionId)}/confirm`,
      method: 'POST',
      data: { expectedVersion: 1 },
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) { throw normalizeError(error); }
};

const getTodayTaskStatus = async (actionId: string): Promise<TodayActionTaskStatusResponse> => {
  try {
    const response = await axiosForBackend<TodayActionTaskStatusResponse>({
      url: `/api/platform/today-actions/task-drafts/${encodeURIComponent(actionId)}`,
      method: 'GET',
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) { throw normalizeError(error); }
};

const operateTodayAction = async (input: TodayActionOperationRequest): Promise<TodayActionState> => {
  try {
    const response = await axiosForBackend<TodayActionState>({
      url: '/api/platform/today-actions/operations',
      method: 'POST',
      data: input,
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const getTodayActions = async (): Promise<TodayActionResponse> => {
  try {
    const response = await axiosForBackend<TodayActionResponse>({
      url: '/api/platform/today-actions',
      method: 'GET',
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const getTaskFulfillment = async (
  referenceDate?: string,
): Promise<TaskFulfillmentResponse> => {
  try {
    const query: string = referenceDate
      ? `?date=${encodeURIComponent(referenceDate)}`
      : '';
    const response = await axiosForBackend<TaskFulfillmentResponse>({
      url: `/api/platform/task-fulfillment${query}`,
      method: 'GET',
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const getOpportunityDecisions = async (
  referenceDate?: string,
): Promise<OpportunityDecisionResponse> => {
  try {
    const query: string = referenceDate
      ? `?date=${encodeURIComponent(referenceDate)}`
      : '';
    const response = await axiosForBackend<OpportunityDecisionResponse>({
      url: `/api/platform/opportunity-decisions${query}`,
      method: 'GET',
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const getCustomerVisitBriefing = async (
  customerRecordId: string,
  referenceDate?: string,
): Promise<CustomerVisitBriefingResponse> => {
  try {
    const query: string = referenceDate
      ? `?date=${encodeURIComponent(referenceDate)}`
      : '';
    const response = await axiosForBackend<CustomerVisitBriefingResponse>({
      url: `/api/platform/customer-briefings/${encodeURIComponent(customerRecordId)}${query}`,
      method: 'GET',
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const getCustomerCommunicationPreparation = async (
  customerRecordId: string,
  referenceDate?: string,
): Promise<CustomerCommunicationPreparationResponse> => {
  try {
    const query: string = referenceDate
      ? `?date=${encodeURIComponent(referenceDate)}`
      : '';
    const response = await axiosForBackend<CustomerCommunicationPreparationResponse>({
      url: `/api/platform/customer-communications/${encodeURIComponent(customerRecordId)}${query}`,
      method: 'GET',
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const getCustomerPreparationResult = async (id: string): Promise<CustomerPreparationResultSnapshot> => {
  try {
    const response = await axiosForBackend<CustomerPreparationResultSnapshot>({
      url: `/api/platform/customer-communications/results/${encodeURIComponent(id)}`,
      method: 'GET', withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const getCustomerPreparationDelivery = async (
  id: string,
): Promise<CustomerPreparationDeliveryStatus> => {
  try {
    const response = await axiosForBackend<CustomerPreparationDeliveryStatus>({
      url: `/api/platform/customer-communications/results/${encodeURIComponent(id)}/delivery`,
      method: 'GET',
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const confirmCustomerPreparationDelivery = async (
  id: string,
  input: ConfirmPreparationDeliveryRequest,
): Promise<ConfirmPreparationDeliveryResponse> => {
  try {
    const response = await axiosForBackend<ConfirmPreparationDeliveryResponse>({
      url: `/api/platform/customer-communications/results/${encodeURIComponent(id)}/delivery/confirm`,
      method: 'POST',
      data: input,
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const saveCustomerPreparationDraft = async (
  id: string,
  input: SaveCustomerPreparationDraftRequest,
): Promise<CustomerPreparationResultSnapshot> => {
  try {
    const response = await axiosForBackend<CustomerPreparationResultSnapshot>({
      url: `/api/platform/customer-communications/results/${encodeURIComponent(id)}/draft`,
      method: 'PATCH', data: input, withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const getStaleOpportunityReadiness = async (): Promise<StaleOpportunityReadinessResponse> => {
  try {
    const response = await axiosForBackend<StaleOpportunityReadinessResponse>({
      url: '/api/platform/stale-opportunity-readiness',
      method: 'GET',
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const submitStaleOpportunityGovernance = async (
  input: Omit<StaleOpportunityGovernanceRequest, 'idempotencyKey'> & {
    idempotencyKey?: string;
  },
): Promise<StaleOpportunityGovernanceResponse> => {
  try {
    const payload: StaleOpportunityGovernanceRequest = {
      ...input,
      idempotencyKey: input.idempotencyKey ?? crypto.randomUUID(),
    };
    const response = await axiosForBackend<StaleOpportunityGovernanceResponse>({
      url: '/api/platform/stale-opportunity-readiness/govern',
      method: 'POST',
      data: payload,
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const getPlatformSection = async (
  key: PlatformSectionKey,
): Promise<PlatformSectionResponse> => {
  try {
    const response = await axiosForBackend<PlatformSectionResponse>({
      url: `/api/platform/section/${key}`,
      method: 'GET',
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const getPlaybookDraft = async (
  candidateId: string, beforeVersion?: number,
): Promise<PlaybookDraftResponse> => {
  try {
    const response = await axiosForBackend<PlaybookDraftResponse>({
      url: `/api/platform/playbook-candidates/${encodeURIComponent(candidateId)}/draft`,
      method: 'GET', params: beforeVersion === undefined ? undefined : { beforeVersion },
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) { throw normalizeError(error); }
};

const getPlaybookDraftVersion = async (
  candidateId: string, version: number,
): Promise<PlaybookDraftVersion> => {
  try {
    const response = await axiosForBackend<PlaybookDraftVersion>({
      url: `/api/platform/playbook-candidates/${encodeURIComponent(candidateId)}/draft/versions/${version}`,
      method: 'GET', withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) { throw normalizeError(error); }
};

const savePlaybookDraft = async (
  candidateId: string, input: SavePlaybookDraftRequest,
): Promise<PlaybookDraftVersion> => {
  try {
    const response = await axiosForBackend<PlaybookDraftVersion>({
      url: `/api/platform/playbook-candidates/${encodeURIComponent(candidateId)}/draft/versions`,
      method: 'POST', data: input, withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) { throw normalizeError(error); }
};

const getPlaybookCandidates = async (): Promise<PlaybookOptimizationCandidateListResponse> => {
  try {
    const response = await axiosForBackend<PlaybookOptimizationCandidateListResponse>({
      url: '/api/platform/playbook-candidates',
      method: 'GET',
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const reviewPlaybookCandidate = async (
  candidateId: string,
  input: PlaybookOptimizationReviewRequest,
): Promise<PlaybookOptimizationReviewResponse> => {
  try {
    const response = await axiosForBackend<PlaybookOptimizationReviewResponse>({
      url: `/api/platform/playbook-candidates/${encodeURIComponent(candidateId)}/review`,
      method: 'POST',
      data: input,
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const getProactiveNotificationReconciliations = async (
  limit: number = 50,
): Promise<ProactiveNotificationReconciliationListResponse> => {
  try {
    const response = await axiosForBackend<
      ProactiveNotificationReconciliationListResponse
    >({
      url: '/api/platform/proactive-sales-notifications/reconciliation',
      method: 'GET',
      params: { limit },
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const reconcileProactiveNotification = async (
  notificationId: string,
  input: ProactiveNotificationReconciliationRequest,
): Promise<ProactiveNotificationReconciliationResponse> => {
  try {
    const response = await axiosForBackend<
      ProactiveNotificationReconciliationResponse
    >({
      url: '/api/platform/proactive-sales-notifications/reconciliation/' +
        encodeURIComponent(notificationId),
      method: 'POST',
      data: input,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const createFollowupDraft = async (
  input: CreateFollowupDraftRequest,
): Promise<FollowupDraftResponse> => {
  try {
    const response = await axiosForBackend<FollowupDraftResponse>({
      url: '/api/platform/followup-inputs',
      method: 'POST',
      data: input,
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const getFollowupDraft = async (
  id: string,
): Promise<FollowupDraftResponse> => {
  try {
    const response = await axiosForBackend<FollowupDraftResponse>({
      url: `/api/platform/followup-drafts/${encodeURIComponent(id)}`,
      method: 'GET',
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const updateFollowupDraft = async (
  id: string,
  input: UpdateFollowupDraftRequest,
): Promise<FollowupDraftResponse> => {
  try {
    const response = await axiosForBackend<FollowupDraftResponse>({
      url: `/api/platform/followup-drafts/${encodeURIComponent(id)}`,
      method: 'PATCH',
      data: input,
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const confirmFollowupDraft = async (
  id: string,
  input: ConfirmFollowupDraftRequest,
): Promise<AgentExecutionResult> => {
  try {
    const response = await axiosForBackend<AgentExecutionResult>({
      url: `/api/platform/followup-drafts/${encodeURIComponent(id)}/confirm`,
      method: 'POST',
      data: input,
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const getFollowupExecution = async (
  id: string,
): Promise<AgentExecutionResult | null> => {
  try {
    const response = await axiosForBackend<AgentExecutionResult | null>({
      url: `/api/platform/followup-drafts/${encodeURIComponent(id)}/execution`,
      method: 'GET',
      withCredentials: true,
    });
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

export {
  confirmCustomerPreparationDelivery,
  confirmFollowupDraft,
  createFollowupDraft,
  getCustomerCommunicationPreparation,
  getCustomerPreparationDelivery,
  getCustomerPreparationResult,
  saveCustomerPreparationDraft,
  getCustomerVisitBriefing,
  getFollowupDraft,
  getFollowupExecution,
  getDailySalesReport,
  getOpportunityDecisions,
  getPlaybookCandidates,
  getPlaybookDraft,
  getPlaybookDraftVersion,
  savePlaybookDraft,
  getProactiveNotificationReconciliations,
  getTaskFulfillment,
  getTodayActions,
  operateTodayAction,
  createTodayFollowupDraft,
    createTodayTaskDraft,
    confirmTodayTaskDraft,
    getTodayTaskStatus,
  getTeamOpportunityDecisions,
  getTeamReview,
  getStaleOpportunityReadiness,
  submitStaleOpportunityGovernance,
  getPlatformSection,
  getPlatformSession,
  getWorkspace,
  reviewPlaybookCandidate,
  reconcileProactiveNotification,
  updateFollowupDraft,
};
export type { ProductApiError };



