import { Injectable } from '@nestjs/common';

import type { TaskGateway } from '@server/modules/agent-core/agent.ports';
import type {
  PendingAction,
  SalesContextTaskResult,
  TaskCreationResult,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import type { FollowupTaskCandidate } from '@shared/api.interface';
import { FeishuClientFactory } from '@server/modules/feishu/feishu-client.factory';
import {
  assertFeishuSuccess,
  requireFeishuId,
} from '@server/modules/feishu/feishu-api.error';

interface ResolvedTaskInput {
  title: string;
  dueAt: string;
  channel: string | null;
  participants: string[];
}

interface TaskSearchItem {
  id: string;
  meta_data?: {
    app_link?: string;
    description?: string;
  };
}

const TASK_SEARCH_PAGE_SIZE = 30;
const TASK_SEARCH_MAX_PAGES = 100;

const resolveTaskInput = (action: PendingAction): ResolvedTaskInput => {
  const selectedIds: string[] | undefined =
    action.payload.selectedTaskCandidateIds;
  if (selectedIds !== undefined) {
    const selectedId: string | undefined = selectedIds[0];
    const candidate: FollowupTaskCandidate | undefined =
      action.payload.taskCandidates?.find(
        (item: FollowupTaskCandidate): boolean => item.id === selectedId,
      );
    if (
      selectedIds.length !== 1 || candidate === undefined ||
      candidate.status !== 'ready' || candidate.dueAt === null
    ) {
      throw new Error('Selected task preview is invalid');
    }
    return {
      title: candidate.title,
      dueAt: candidate.dueAt,
      channel: candidate.channel,
      participants: candidate.participants,
    };
  }
  const title: string | null = action.payload.draft.nextAction;
  const dueAt: string | null = action.payload.draft.dueAt;
  if (!title || !dueAt) {
    throw new Error('Task action and due date are required');
  }
  return {
    title,
    dueAt,
    channel: action.payload.draft.nextActionChannel ?? null,
    participants: action.payload.draft.nextActionParticipants ?? [],
  };
};

@Injectable()
class FeishuTaskGateway implements TaskGateway {
  constructor(private readonly clients: FeishuClientFactory) {}

  async searchOwnedTasks(
    integration: TenantIntegration,
    actorOpenId: string,
    customerName: string,
  ): Promise<SalesContextTaskResult> {
    const client = this.clients.getClient(integration);
    const items: TaskSearchItem[] = [];
    const itemIds: Set<string> = new Set();
    const seenPageTokens: Set<string> = new Set();
    let pageToken: string | undefined;
    let warning: string | undefined;

    for (let page: number = 0; page < TASK_SEARCH_MAX_PAGES; page += 1) {
      const params: {
        page_size: number;
        user_id_type: 'open_id';
        page_token?: string;
      } = {
        page_size: TASK_SEARCH_PAGE_SIZE,
        user_id_type: 'open_id',
      };
      if (pageToken) params.page_token = pageToken;
      const response = await client.task.v2.task.search(
        {
          data: {
            query: customerName,
            filter: {
              assignee_ids: [actorOpenId],
              is_completed: false,
            },
          },
          params,
        },
        this.clients.getRequestOptions(integration),
      );
      assertFeishuSuccess(response.code, response.msg, 'read Feishu tasks');
      const pageItems: TaskSearchItem[] = response.data?.items ?? [];
      pageItems.forEach((item: TaskSearchItem): void => {
        if (!itemIds.has(item.id)) {
          itemIds.add(item.id);
          items.push(item);
        }
      });

      if (response.data?.notice) {
        warning = 'task_query_scope_limited';
        break;
      }
      if (response.data?.has_more !== true) break;

      const nextPageToken: string =
        response.data.page_token?.trim() ?? '';
      if (!nextPageToken || seenPageTokens.has(nextPageToken)) {
        warning = 'task_query_pagination_incomplete';
        break;
      }
      seenPageTokens.add(nextPageToken);
      pageToken = nextPageToken;
      if (page === TASK_SEARCH_MAX_PAGES - 1) {
        warning = 'task_query_pagination_limited';
      }
    }

    const tasks = await Promise.all(items.map(async (item: TaskSearchItem) => {
      const detail = await client.task.v2.task.get(
        {
          path: { task_guid: item.id },
          params: { user_id_type: 'open_id' },
        },
        this.clients.getRequestOptions(integration),
      );
      assertFeishuSuccess(detail.code, detail.msg, 'read Feishu task');
      const task = detail.data?.task;
      if (!task?.guid) return null;
      const dueTimestamp: number = Number(task.due?.timestamp);
      return {
        guid: task.guid,
        title: task.summary ?? item.meta_data?.description ?? '未命名任务',
        status: task.completed_at ? 'completed' : task.status ?? 'todo',
        dueAt: Number.isFinite(dueTimestamp) && dueTimestamp > 0
          ? new Date(dueTimestamp).toISOString()
          : null,
        url: task.url ?? item.meta_data?.app_link ?? null,
      };
    }));
    return {
      items: tasks.filter((task) => task !== null),
      ...(warning ? { warning } : {}),
    };
  }

  async createTask(
    integration: TenantIntegration,
    action: PendingAction,
    followupRecordId: string,
  ): Promise<TaskCreationResult> {
    const task: ResolvedTaskInput = resolveTaskInput(action);
    const dueTimestamp: number = Date.parse(task.dueAt);
    if (Number.isNaN(dueTimestamp)) {
      throw new Error('Task due date is invalid');
    }

    const client = this.clients.getClient(integration);
    const response = await client.task.v2.task.create(
      {
        params: {
          user_id_type: 'open_id',
        },
        data: {
          summary: task.title.slice(0, 3000),
          description: this.createDescription(
            action,
            followupRecordId,
            task,
          ),
          due: {
            timestamp: String(dueTimestamp),
            is_all_day: false,
          },
          members: [
            {
              id: action.actorOpenId,
              type: 'user',
              role: 'assignee',
            },
          ],
          client_token: action.id,
        },
      },
      this.clients.getRequestOptions(integration),
    );
    assertFeishuSuccess(response.code, response.msg, 'create Feishu task');
    const guid: string = requireFeishuId(
      response.data?.task?.guid,
      'create Feishu task',
    );
    const url: string = requireFeishuId(
      response.data?.task?.url,
      'create Feishu task URL',
    );
    return { guid, url };
  }

  async updateTask(
    integration: TenantIntegration,
    action: PendingAction,
    followupRecordId: string,
    taskGuid: string,
  ): Promise<TaskCreationResult> {
    const task: ResolvedTaskInput = resolveTaskInput(action);
    const dueTimestamp: number = Date.parse(task.dueAt);
    if (Number.isNaN(dueTimestamp)) {
      throw new Error('Task due date is invalid');
    }
    const client = this.clients.getClient(integration);
    const response = await client.task.v2.task.patch(
      {
        path: {
          task_guid: taskGuid,
        },
        params: {
          user_id_type: 'open_id',
        },
        data: {
          task: {
            summary: task.title.slice(0, 3000),
            description: this.createDescription(
              action,
              followupRecordId,
              task,
            ),
            due: {
              timestamp: String(dueTimestamp),
              is_all_day: false,
            },
          },
          update_fields: ['summary', 'description', 'due'],
        },
      },
      this.clients.getRequestOptions(integration),
    );
    assertFeishuSuccess(response.code, response.msg, 'update Feishu task');
    const guid: string = requireFeishuId(
      response.data?.task?.guid ?? taskGuid,
      'update Feishu task',
    );
    return {
      guid,
      url: response.data?.task?.url ?? this.fallbackTaskUrl(guid),
    };
  }

  private createDescription(
    action: PendingAction,
    followupRecordId: string,
    task: ResolvedTaskInput,
  ): string {
    const customerName: string =
      action.payload.draft.customerName ?? '未识别客户';
    return [
      `客户：${customerName}`,
      `跟进摘要：${action.payload.draft.summary}`,
      `执行方式：${task.channel ?? '未提供'}`,
      `参与人：${task.participants.length > 0
        ? task.participants.join('、')
        : '未提供'}`,
      `Base 跟进记录：${followupRecordId}`,
      `来源消息：${action.payload.sourceMessageId}`,
    ].join('\n');
  }

  private fallbackTaskUrl(guid: string): string {
    return `https://applink.feishu.cn/client/todo/task?guid=${encodeURIComponent(guid)}`;
  }
}

export { FeishuTaskGateway, resolveTaskInput };
export type { ResolvedTaskInput };
