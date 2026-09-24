import axios from 'axios';

import type {
  AgentExecutionResult,
  ConfirmFollowupDraftRequest,
  CreateFollowupDraftRequest,
  FollowupDraftResponse,
  UpdateFollowupDraftRequest,
  PlatformSectionKey,
  PlatformSectionResponse,
  PlatformSessionResponse,
  WorkspaceResponse,
} from '@shared/api.interface';

interface ProductApiError {
  status: number;
  message: string;
  retryable: boolean;
}

const normalizeError = (error: unknown): ProductApiError => {
  if (axios.isAxiosError(error)) {
    const status: number = error.response?.status ?? 0;
    if (status === 401) {
      return { status, message: '请先通过飞书登录', retryable: false };
    }
    if (status === 403) {
      return { status, message: '无权访问当前工作区', retryable: false };
    }
    if (status === 409) {
      return { status, message: '版本已变化，请刷新后再试', retryable: false };
    }
    if (status === 422) {
      return { status, message: '请补全客户、下一步、截止时间并修复证据问题', retryable: false };
    }
    if (status === 503) {
      return {
        status,
        message: '模型当前繁忙，草案未生成；请稍后重试，业务数据尚未写入',
        retryable: true,
      };
    }
    return {
      status,
      message: '暂时无法加载数据，请稍后重试',
      retryable: true,
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
  getPlatformSection,
  getPlatformSession,
  getWorkspace,
  updateFollowupDraft,
};
export type { ProductApiError };
