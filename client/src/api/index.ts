import axios from 'axios';

import type {
  AgentExecutionResult,
  ConfirmFollowupDraftRequest,
  CreateFollowupDraftRequest,
  DailySalesReportResponse,
  FollowupDraftResponse,
  UpdateFollowupDraftRequest,
  PlatformSectionKey,
  PlatformSectionResponse,
  PlatformSessionResponse,
  StaleOpportunityGovernanceRequest,
  StaleOpportunityGovernanceResponse,
  StaleOpportunityReadinessResponse,
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
    const response = await axios.get<PlatformSessionResponse>(
      '/api/platform/session',
      { withCredentials: true },
    );
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const getWorkspace = async (): Promise<WorkspaceResponse> => {
  try {
    const response = await axios.get<WorkspaceResponse>(
      '/api/platform/workspace',
      { withCredentials: true },
    );
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
    const response = await axios.get<DailySalesReportResponse>(
      `/api/platform/daily-report${query}`,
      { withCredentials: true },
    );
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const getStaleOpportunityReadiness = async (): Promise<StaleOpportunityReadinessResponse> => {
  try {
    const response = await axios.get<StaleOpportunityReadinessResponse>(
      '/api/platform/stale-opportunity-readiness',
      { withCredentials: true },
    );
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
    const response = await axios.post<StaleOpportunityGovernanceResponse>(
      '/api/platform/stale-opportunity-readiness/govern',
      payload,
      { withCredentials: true },
    );
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const getPlatformSection = async (
  key: PlatformSectionKey,
): Promise<PlatformSectionResponse> => {
  try {
    const response = await axios.get<PlatformSectionResponse>(
      `/api/platform/section/${key}`,
      { withCredentials: true },
    );
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const createFollowupDraft = async (
  input: CreateFollowupDraftRequest,
): Promise<FollowupDraftResponse> => {
  try {
    const response = await axios.post<FollowupDraftResponse>(
      '/api/platform/followup-inputs',
      input,
      { withCredentials: true },
    );
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const getFollowupDraft = async (
  id: string,
): Promise<FollowupDraftResponse> => {
  try {
    const response = await axios.get<FollowupDraftResponse>(
      `/api/platform/followup-drafts/${encodeURIComponent(id)}`,
      { withCredentials: true },
    );
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
    const response = await axios.patch<FollowupDraftResponse>(
      `/api/platform/followup-drafts/${encodeURIComponent(id)}`,
      input,
      { withCredentials: true },
    );
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
    const response = await axios.post<AgentExecutionResult>(
      `/api/platform/followup-drafts/${encodeURIComponent(id)}/confirm`,
      input,
      { withCredentials: true },
    );
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

const getFollowupExecution = async (
  id: string,
): Promise<AgentExecutionResult | null> => {
  try {
    const response = await axios.get<AgentExecutionResult | null>(
      `/api/platform/followup-drafts/${encodeURIComponent(id)}/execution`,
      { withCredentials: true },
    );
    return response.data;
  } catch (error: unknown) {
    throw normalizeError(error);
  }
};

export {
  confirmFollowupDraft,
  createFollowupDraft,
  getFollowupDraft,
  getFollowupExecution,
  getDailySalesReport,
  getStaleOpportunityReadiness,
  submitStaleOpportunityGovernance,
  getPlatformSection,
  getPlatformSession,
  getWorkspace,
  updateFollowupDraft,
};
export type { ProductApiError };
