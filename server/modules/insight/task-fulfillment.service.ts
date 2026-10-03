import { Inject, Injectable, Logger } from '@nestjs/common';

import type {
  FollowupTaskCandidate,
  TaskPromiseFulfillmentItem,
  TaskPromiseStatus,
  TaskFulfillmentCategory,
  TaskFulfillmentItem,
  TaskFulfillmentMetrics,
  TaskFulfillmentPriority,
  TaskFulfillmentResponse,
  TaskFulfillmentCompletedItem,
  TaskFulfillmentChange,
  TaskPromiseCompletionState,
} from '@shared/api.interface';
import {
  CONTROL_STORE,
  TASK_GATEWAY,
  type ControlStore,
} from '@server/modules/agent-core/agent.ports';
import type {
  DailyReportTaskRecord,
  DailyReportTaskResult,
  PendingAction,
  TaskStatusEvent,
  TaskStatusEventResult,
  TaskHistorySourceResult,
  TaskStatusSnapshot,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';

interface TaskFulfillmentInput {
  integration: TenantIntegration;
  actorOpenId: string;
  referenceDate: string;
  timezone: string;
  now?: Date;
}

interface TaskFulfillmentTasksReader {
  listOwnedTasks?(
    integration: TenantIntegration,
    actorOpenId: string,
  ): Promise<DailyReportTaskResult>;
  listCompletedTasks?(
    integration: TenantIntegration,
    actorOpenId: string,
  ): Promise<DailyReportTaskResult>;
  readTaskHistory?(
    integration: TenantIntegration,
    actorOpenId: string,
    taskGuids: string[],
    since: Date,
    limit: number,
  ): Promise<TaskHistorySourceResult>;
  getTaskByGuid?(
    integration: TenantIntegration,
    actorOpenId: string,
    taskGuid: string,
  ): Promise<DailyReportTaskRecord | null>;
}

interface Classification {
  category: TaskFulfillmentCategory;
  priority: TaskFulfillmentPriority;
  suggestedAction: string;
}

interface SnapshotResult {
  available: boolean;
  changes: TaskFulfillmentChange[];
}

interface PromiseReconciliationResult {
  promises: TaskPromiseFulfillmentItem[];
  changes: TaskFulfillmentChange[];
  taskHistory: TaskFulfillmentResponse['coverage']['taskHistory'];
}

interface TaskHistoryResult {
  changes: TaskFulfillmentChange[];
  unavailableGuids: Set<string>;
  coverage: TaskFulfillmentResponse['coverage']['taskHistory'];
}

interface TaskReplacement {
  taskGuid: string;
  taskUrl: string | null;
}

interface TaskReplacementResult {
  byOriginalGuid: Map<string, TaskReplacement>;
  ambiguousOriginalGuids: Set<string>;
}

interface CompletedTasksResult {
  items: TaskFulfillmentCompletedItem[];
  taskItems: TaskFulfillmentItem[];
  coverage: 'search_scope' | 'partial' | 'unavailable';
}

const DATE_PATTERN: RegExp = /^\d{4}-\d{2}-\d{2}$/u;
const PROMISE_HISTORY_DAYS = 180 as const;
const PROMISE_HISTORY_LIMIT: number = 500;
const TASK_EVENT_HISTORY_LIMIT: number = 1000;
const NO_NEXT_STEP_PATTERN: RegExp = /^(暂无|没有|无)下一步/u;
const PARTIAL_TASK_STATUSES: ReadonlySet<string> = new Set([
  'inprogress',
  'doing',
  'started',
  'processing',
  'partial',
  'partiallycompleted',
  '进行中',
  '处理中',
  '已开始',
  '部分完成',
]);
const CATEGORY_RANK: Record<TaskFulfillmentCategory, number> = {
  overdue: 0,
  due_today: 1,
  due_soon: 2,
  unscheduled: 3,
  scheduled: 4,
};

const isValidDate = (value: string): boolean => {
  if (!DATE_PATTERN.test(value)) return false;
  const [yearText, monthText, dayText]: string[] = value.split('-');
  const year: number = Number(yearText);
  const month: number = Number(monthText);
  const day: number = Number(dayText);
  const candidate: Date = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day;
};

const localDateKey = (value: Date, timezone: string): string | null => {
  if (!Number.isFinite(value.getTime())) return null;
  try {
    const parts: Intl.DateTimeFormatPart[] = new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      },
    ).formatToParts(value);
    const partValue = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find(
        (part: Intl.DateTimeFormatPart): boolean => part.type === type,
      )?.value ?? '';
    const result: string = [
      partValue('year'),
      partValue('month'),
      partValue('day'),
    ].join('-');
    return isValidDate(result) ? result : null;
  } catch (_error: unknown) {
    return null;
  }
};

const dateOrdinal = (value: string): number => {
  const [year, month, day]: number[] = value.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
};

const classify = (daysUntilDue: number | null): Classification => {
  if (daysUntilDue === null) {
    return {
      category: 'unscheduled',
      priority: 'medium',
      suggestedAction: '补充明确截止时间，避免任务无法进入履约检查。',
    };
  }
  if (daysUntilDue < 0) {
    return {
      category: 'overdue',
      priority: 'critical',
      suggestedAction: '立即确认任务是否仍需执行，并重新承诺可完成时间。',
    };
  }
  if (daysUntilDue === 0) {
    return {
      category: 'due_today',
      priority: 'high',
      suggestedAction: '今天完成或在截止前更新任务安排。',
    };
  }
  if (daysUntilDue <= 3) {
    return {
      category: 'due_soon',
      priority: 'medium',
      suggestedAction: '提前确认所需材料和协作人，避免临近截止受阻。',
    };
  }
  return {
    category: 'scheduled',
    priority: 'normal',
    suggestedAction: '按当前计划推进，并在状态变化时及时更新任务。',
  };
};

const sourceWarning = (warning: string): string => {
  const labels: Record<string, string> = {
    task_query_scope_limited: '飞书任务检索范围受限，结果可能不完整',
    task_query_pagination_incomplete: '飞书任务分页未完整返回，结果可能不完整',
    task_query_pagination_limited: '飞书任务数量超过本次读取上限',
  };
  return labels[warning] ?? warning;
};

const completedSourceWarning = (warning: string): string => {
  const labels: Record<string, string> = {
    task_query_scope_limited: '任务检索范围受限，结果可能不完整',
    task_query_pagination_incomplete: '任务分页未完整返回，结果可能不完整',
    task_query_pagination_limited: '任务数量超过本次读取上限',
  };
  return labels[warning] ?? warning;
};

@Injectable()
class TaskFulfillmentService {
  private readonly logger: Logger = new Logger(TaskFulfillmentService.name);

  constructor(
    @Inject(TASK_GATEWAY)
    private readonly tasks: TaskFulfillmentTasksReader,
    @Inject(CONTROL_STORE)
    private readonly controlStore: ControlStore,
  ) {}

  async analyze(
    input: TaskFulfillmentInput,
  ): Promise<TaskFulfillmentResponse> {
    const now: Date = input.now ?? new Date();
    const warnings: string[] = [];
    if (input.integration.status !== 'active') {
      return this.unavailable(input, now, ['任务数据连接未启用']);
    }
    if (!input.actorOpenId.trim()) {
      return this.unavailable(input, now, ['当前销售身份不可用']);
    }
    if (!isValidDate(input.referenceDate)) {
      return this.unavailable(input, now, ['检查日期格式无效']);
    }
    try {
      Intl.DateTimeFormat('en-US', { timeZone: input.timezone });
    } catch (_error: unknown) {
      return this.unavailable(input, now, ['销售时区无效']);
    }
    if (!this.tasks.listOwnedTasks) {
      return this.unavailable(input, now, ['任务数据源未配置']);
    }

    let taskResult: DailyReportTaskResult;
    try {
      taskResult = await this.tasks.listOwnedTasks(
        input.integration,
        input.actorOpenId,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Task fulfillment read failed: ${error instanceof Error
          ? error.message
          : String(error)}`,
      );
      return this.unavailable(input, now, ['任务数据源暂时不可用']);
    }
    if (taskResult.warning) {
      warnings.push(sourceWarning(taskResult.warning));
    }

    const items: TaskFulfillmentItem[] = taskResult.items
      .map((task: DailyReportTaskRecord): TaskFulfillmentItem => {
        const dueDate: string | null = task.dueAt
          ? localDateKey(new Date(task.dueAt), input.timezone)
          : null;
        const daysUntilDue: number | null = dueDate === null
          ? null
          : dateOrdinal(dueDate) - dateOrdinal(input.referenceDate);
        const classification: Classification = classify(daysUntilDue);
        return {
          guid: task.guid,
          title: task.title,
          status: task.status,
          completedAt: task.completedAt ?? null,
          dueAt: task.dueAt,
          dueDate,
          daysUntilDue,
          url: task.url,
          ...classification,
        };
      })
      .sort((left: TaskFulfillmentItem, right: TaskFulfillmentItem): number => {
        const categoryDifference: number =
          CATEGORY_RANK[left.category] - CATEGORY_RANK[right.category];
        if (categoryDifference !== 0) return categoryDifference;
        if (left.dueAt === null) return right.dueAt === null ? 0 : 1;
        if (right.dueAt === null) return -1;
        return Date.parse(left.dueAt) - Date.parse(right.dueAt);
      });
    const completedResult: CompletedTasksResult =
      await this.readCompletedTasks(input, warnings);
    const snapshotResult: SnapshotResult = await this.recordSnapshots(
      input,
      [...items, ...completedResult.taskItems],
      warnings,
      now,
    );
    const reconciliation: PromiseReconciliationResult =
      await this.reconcilePromises(
        input,
        items,
        completedResult.taskItems,
        Boolean(taskResult.warning),
        snapshotResult.changes,
        warnings,
        now,
      );
    const promises: TaskPromiseFulfillmentItem[] = reconciliation.promises;
    const changes: TaskFulfillmentChange[] = [
      ...snapshotResult.changes,
      ...reconciliation.changes,
    ];
    const metrics: TaskFulfillmentMetrics = {
      openTaskCount: items.length,
      completedTaskCount: completedResult.items.length,
      overdueCount: this.count(items, 'overdue'),
      dueTodayCount: this.count(items, 'due_today'),
      dueSoonCount: this.count(items, 'due_soon'),
      unscheduledCount: this.count(items, 'unscheduled'),
      scheduledCount: this.count(items, 'scheduled'),
      promiseCount: promises.length,
      linkedOpenPromiseCount: promises.filter(
        (promise: TaskPromiseFulfillmentItem): boolean =>
          promise.status.startsWith('open_'),
      ).length,
      completedPromiseCount: this.countPromises(promises, 'completed'),
      partiallyCompletedPromiseCount: this.countCompletionStates(
        promises,
        'partially_completed',
      ),
      stillOpenPromiseCount: this.countCompletionStates(
        promises,
        'still_open',
      ),
      changedPromiseCount: this.countPromises(promises, 'open_changed'),
      overduePromiseCount: this.countPromises(promises, 'open_overdue'),
      untrackedPromiseCount: this.countPromises(promises, 'not_task_tracked'),
      unverifiablePromiseCount: this.countPromises(
        promises,
        'task_not_visible',
      ) + this.countPromises(promises, 'task_lookup_incomplete') +
        this.countPromises(promises, 'task_lookup_unavailable'),
    };
    const recommendations: string[] = this.recommend(metrics);
    const status: TaskFulfillmentResponse['status'] = warnings.length > 0
      ? items.length > 0 || promises.length > 0 ||
          completedResult.items.length > 0 ||
          completedResult.coverage === 'partial' ? 'partial' : 'unavailable'
      : items.length > 0 || promises.length > 0 ||
          completedResult.items.length > 0 ? 'ready' : 'empty';

    return {
      referenceDate: input.referenceDate,
      timezone: input.timezone,
      status,
      generatedAt: now.toISOString(),
      metrics,
      items,
      completedItems: completedResult.items,
      promises,
      recommendations,
      coverage: {
        openTasks: true,
        completedTasks: completedResult.coverage,
        promiseReconciliation: 'agent_confirmed_only',
        promiseHistoryDays: PROMISE_HISTORY_DAYS,
        taskSnapshots: snapshotResult.available
          ? 'latest_observation'
          : 'unavailable',
        taskHistory: reconciliation.taskHistory,
      },
      warnings,
      changes,
    };
  }

  private async readCompletedTasks(
    input: TaskFulfillmentInput,
    warnings: string[],
  ): Promise<CompletedTasksResult> {
    if (!this.tasks.listCompletedTasks) {
      return { items: [], taskItems: [], coverage: 'unavailable' };
    }
    let result: DailyReportTaskResult;
    try {
      result = await this.tasks.listCompletedTasks(
        input.integration,
        input.actorOpenId,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Completed task read failed: ${error instanceof Error
          ? error.message
          : String(error)}`,
      );
      warnings.push('已完成任务历史暂时不可读取');
      return { items: [], taskItems: [], coverage: 'unavailable' };
    }
    const validRecords: DailyReportTaskRecord[] = result.items.filter(
      (task: DailyReportTaskRecord): boolean => {
        const completedAt: string | null = task.completedAt ?? null;
        return completedAt !== null && Number.isFinite(Date.parse(completedAt));
      },
    );
    if (validRecords.length !== result.items.length) {
      warnings.push('部分已完成任务缺少有效完成时间，未计入');
    }
    if (result.warning) {
      warnings.push(`已完成${completedSourceWarning(result.warning)}`);
    }
    const coverage: 'search_scope' | 'partial' | 'unavailable' =
      result.warning || validRecords.length !== result.items.length
        ? 'partial'
        : 'search_scope';
    const items: TaskFulfillmentCompletedItem[] = validRecords.map(
      (task: DailyReportTaskRecord): TaskFulfillmentCompletedItem => ({
        guid: task.guid,
        title: task.title,
        completedAt: task.completedAt ?? '',
        dueAt: task.dueAt,
        url: task.url,
      }),
    );
    return {
      items,
      taskItems: validRecords.map(
        (task: DailyReportTaskRecord): TaskFulfillmentItem =>
          this.toTaskItem(task, input.timezone, input.referenceDate),
      ),
      coverage,
    };
  }

  private async recordSnapshots(
    input: TaskFulfillmentInput,
    tasks: TaskFulfillmentItem[],
    warnings: string[],
    now: Date,
  ): Promise<SnapshotResult> {
    if (!this.controlStore.recordTaskSnapshots) {
      warnings.push('任务状态快照存储未配置，无法识别状态变化');
      return { available: false, changes: [] };
    }
    const snapshots: TaskStatusSnapshot[] = tasks.map(
      (task: TaskFulfillmentItem): TaskStatusSnapshot => ({
        guid: task.guid,
        title: task.title,
        status: task.status,
        completedAt: task.completedAt,
        dueAt: task.dueAt,
        url: task.url,
      }),
    );
    try {
      const changes: TaskFulfillmentChange[] =
        await this.controlStore.recordTaskSnapshots(
          input.integration.tenantId,
          input.actorOpenId,
          now,
          snapshots,
        );
      return { available: true, changes };
    } catch (error: unknown) {
      this.logger.warn(
        `Task snapshot write failed: ${error instanceof Error
          ? error.message
          : String(error)}`,
      );
      warnings.push('任务状态快照暂时无法保存，状态变化证据不可用');
      return { available: false, changes: [] };
    }
  }

  private async reconcilePromises(
    input: TaskFulfillmentInput,
    tasks: TaskFulfillmentItem[],
    completedTasks: TaskFulfillmentItem[],
    taskSourceIncomplete: boolean,
    existingChanges: TaskFulfillmentChange[],
    warnings: string[],
    now: Date,
  ): Promise<PromiseReconciliationResult> {
    if (!this.controlStore.listSucceededActions) {
      warnings.push('Agent 执行记录读取能力未配置，无法核对跟进承诺');
      return {
        promises: [], changes: [], taskHistory: 'unavailable',
      };
    }
    let actions: PendingAction[];
    try {
      const since: Date = new Date(
        now.getTime() - PROMISE_HISTORY_DAYS * 86_400_000,
      );
      actions = await this.controlStore.listSucceededActions(
        input.integration.tenantId,
        input.actorOpenId,
        since,
        PROMISE_HISTORY_LIMIT,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Task promise read failed: ${error instanceof Error
          ? error.message
          : String(error)}`,
      );
      warnings.push('Agent 跟进承诺暂时不可读取');
      return {
        promises: [], changes: [], taskHistory: 'unavailable',
      };
    }
    if (actions.length >= PROMISE_HISTORY_LIMIT) {
      warnings.push('跟进承诺历史达到本次读取上限，结果可能不完整');
    }
    const replacements: TaskReplacementResult =
      this.buildTaskReplacements(actions, warnings);
    const taskGuids: string[] = this.taskGuidsForActions(
      actions,
      replacements.byOriginalGuid,
    );
    const taskByGuid: Map<string, TaskFulfillmentItem> = new Map(
      [...tasks, ...completedTasks].map(
        (task: TaskFulfillmentItem): [string, TaskFulfillmentItem] =>
          [task.guid, task],
      ),
    );
    const taskLookupUnavailable: Set<string> = new Set<string>();
    const detailedTasks: DailyReportTaskRecord[] =
      await this.lookupMissingTasks(
        input,
        taskGuids,
        taskByGuid,
        taskSourceIncomplete,
        taskLookupUnavailable,
        warnings,
      );
    const detailSnapshotResult: SnapshotResult = await this.recordSnapshots(
      input,
      detailedTasks.map((task: DailyReportTaskRecord): TaskFulfillmentItem =>
        this.toTaskItem(task, input.timezone, input.referenceDate),
      ),
      warnings,
      now,
    );
    const historyResult: TaskHistoryResult =
      await this.readTaskStatusEvents(
        input,
        taskGuids,
        taskByGuid,
        warnings,
        now,
      );
    historyResult.unavailableGuids.forEach((guid: string): void => {
      taskLookupUnavailable.add(guid);
    });
    const changes: TaskFulfillmentChange[] = detailSnapshotResult.changes;
    const changeByGuid: Map<string, TaskFulfillmentChange> = new Map(
      [
        ...historyResult.changes,
        ...existingChanges,
        ...changes,
      ].map(
        (change: TaskFulfillmentChange): [string, TaskFulfillmentChange] =>
          [change.guid, change],
      ),
    );
    const promises: TaskPromiseFulfillmentItem[] = actions
      .map((action: PendingAction): TaskPromiseFulfillmentItem | null =>
        this.toPromise(
          action,
          taskByGuid,
          taskSourceIncomplete,
          taskLookupUnavailable,
          changeByGuid,
          replacements,
        ),
      )
      .filter(
        (promise: TaskPromiseFulfillmentItem | null):
          promise is TaskPromiseFulfillmentItem => promise !== null,
      );
    return {
      promises,
      changes: [...historyResult.changes, ...changes],
      taskHistory: historyResult.coverage,
    };
  }

  private buildTaskReplacements(
    actions: PendingAction[],
    warnings: string[],
  ): TaskReplacementResult {
    const byOriginalGuid: Map<string, TaskReplacement> = new Map();
    const ambiguousOriginalGuids: Set<string> = new Set();
    let warnedInvalidDeclaration: boolean = false;
    actions.forEach((action: PendingAction): void => {
      const result = action.result;
      const relatedTaskGuid: string = result.relatedTaskGuid?.trim() ?? '';
      const taskGuid: string = result.taskGuid?.trim() ?? '';
      const hasDeclaration: boolean = result.relatedTaskGuid !== undefined ||
        result.relation !== undefined;
      if (!hasDeclaration) return;
      if (
        action.status !== 'succeeded' ||
        result.status !== 'succeeded' ||
        result.relation !== 'replaces' ||
        !relatedTaskGuid ||
        !taskGuid ||
        relatedTaskGuid === taskGuid
      ) {
        if (!warnedInvalidDeclaration) {
          warnings.push('存在无效的跨任务替代声明，相关承诺保持待核实');
          warnedInvalidDeclaration = true;
        }
        return;
      }
      if (ambiguousOriginalGuids.has(relatedTaskGuid)) return;
      const replacement: TaskReplacement = {
        taskGuid,
        taskUrl: result.taskUrl?.trim() || null,
      };
      const previous: TaskReplacement | undefined =
        byOriginalGuid.get(relatedTaskGuid);
      if (previous && previous.taskGuid !== replacement.taskGuid) {
        byOriginalGuid.delete(relatedTaskGuid);
        ambiguousOriginalGuids.add(relatedTaskGuid);
        warnings.push('发现冲突的跨任务替代声明，相关承诺保持待核实');
        return;
      }
      byOriginalGuid.set(relatedTaskGuid, replacement);
    });
    return { byOriginalGuid, ambiguousOriginalGuids };
  }

  private taskGuidsForActions(
    actions: PendingAction[],
    replacements: Map<string, TaskReplacement>,
  ): string[] {
    const taskGuids: Set<string> = new Set<string>();
    actions.forEach((action: PendingAction): void => {
      const taskGuid: string = action.result.taskGuid?.trim() ?? '';
      if (taskGuid) taskGuids.add(taskGuid);
    });
    replacements.forEach(
      (replacement: TaskReplacement, originalGuid: string): void => {
        taskGuids.add(originalGuid);
        taskGuids.add(replacement.taskGuid);
      },
    );
    return Array.from(taskGuids);
  }

  private async readTaskStatusEvents(
    input: TaskFulfillmentInput,
    taskGuids: string[],
    taskByGuid: Map<string, TaskFulfillmentItem>,
    warnings: string[],
    now: Date,
  ): Promise<TaskHistoryResult> {
    if (taskGuids.length === 0) {
      return {
        changes: [],
        unavailableGuids: new Set<string>(),
        coverage: this.controlStore.listTaskStatusEvents
          ? 'agent_observations'
          : 'unavailable',
      };
    }
    const missingGuids: string[] = taskGuids.filter(
      (guid: string): boolean => !taskByGuid.has(guid),
    );
    if (missingGuids.length === 0) {
      return {
        changes: [],
        unavailableGuids: new Set<string>(),
        coverage: 'agent_observations',
      };
    }
    let result: TaskStatusEventResult;
    let coverage: TaskFulfillmentResponse['coverage']['taskHistory'] =
      'agent_observations';
    const since: Date = new Date(
      now.getTime() - PROMISE_HISTORY_DAYS * 86_400_000,
    );
    if (this.tasks.readTaskHistory) {
      let sourceResult: TaskHistorySourceResult;
      try {
        sourceResult = await this.tasks.readTaskHistory(
          input.integration,
          input.actorOpenId,
          taskGuids,
          since,
          TASK_EVENT_HISTORY_LIMIT,
        );
      } catch (error: unknown) {
        this.logger.warn(
          `Trusted task history read failed: ${error instanceof Error
            ? error.message
            : String(error)}`,
        );
        warnings.push('可信任务历史来源暂时不可读取，部分承诺待核实');
        return {
          changes: [],
          unavailableGuids: new Set(missingGuids),
          coverage: 'unavailable',
        };
      }
      if (sourceResult.coverage !== 'full' || sourceResult.warning) {
        if (sourceResult.warning) {
          warnings.push(`任务状态历史${sourceWarning(sourceResult.warning)}`);
        } else {
          warnings.push('可信任务历史来源未提供完整覆盖，部分承诺待核实');
        }
        return {
          changes: [],
          unavailableGuids: new Set(missingGuids),
          coverage: 'unavailable',
        };
      }
      result = sourceResult;
      coverage = 'full';
    } else {
      if (!this.controlStore.listTaskStatusEvents) {
        return {
          changes: [],
          unavailableGuids: new Set(missingGuids),
          coverage: 'unavailable',
        };
      }
      try {
        result = await this.controlStore.listTaskStatusEvents(
          input.integration.tenantId,
          input.actorOpenId,
          taskGuids,
          since,
          TASK_EVENT_HISTORY_LIMIT,
        );
      } catch (error: unknown) {
        this.logger.warn(
          `Task status event read failed: ${error instanceof Error
            ? error.message
            : String(error)}`,
        );
        warnings.push('任务状态历史暂时不可读取，部分承诺待核实');
        return {
          changes: [],
          unavailableGuids: new Set(missingGuids),
          coverage: 'unavailable',
        };
      }
      if (result.warning) {
        warnings.push(`任务状态历史${sourceWarning(result.warning)}`);
        return {
          changes: [],
          unavailableGuids: new Set(missingGuids),
          coverage: 'unavailable',
        };
      }
    }
    const eventsByGuid: Map<string, TaskStatusEvent[]> = new Map();
    result.items.forEach((event: TaskStatusEvent): void => {
      const events: TaskStatusEvent[] = eventsByGuid.get(event.guid) ?? [];
      events.push(event);
      eventsByGuid.set(event.guid, events);
    });
    const changes: TaskFulfillmentChange[] = [];
    const unavailableGuids: Set<string> = new Set<string>();
    let hasNewerOrdinaryEvent: boolean = false;
    missingGuids.forEach((guid: string): void => {
      const events: TaskStatusEvent[] = (eventsByGuid.get(guid) ?? [])
        .sort(
          (left: TaskStatusEvent, right: TaskStatusEvent): number =>
            Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
        );
      const event: TaskStatusEvent | undefined = events[0];
      if (!event) return;
      if (event.kind !== 'completed' && event.kind !== 'reopened') {
        hasNewerOrdinaryEvent = true;
        unavailableGuids.add(guid);
        return;
      }
      if (event.kind === 'completed' && (
        event.completedAt === null ||
        !Number.isFinite(Date.parse(event.completedAt))
      )) {
        return;
      }
      taskByGuid.set(
        guid,
        this.toTaskItem({
          guid,
          title: event.title,
          status: event.status,
          completedAt: event.completedAt,
          dueAt: event.dueAt,
          url: event.url,
        }, input.timezone, input.referenceDate),
      );
      changes.push(this.toTaskFulfillmentChange(event));
    });
    if (hasNewerOrdinaryEvent) {
      warnings.push('任务状态历史包含较新的普通变化，部分承诺待核实');
    }
    return { changes, unavailableGuids, coverage };
  }

  private toTaskFulfillmentChange(
    event: TaskStatusEvent,
  ): TaskFulfillmentChange {
    return {
      guid: event.guid,
      title: event.title,
      kind: event.kind === 'completed' || event.kind === 'reopened'
        ? event.kind
        : 'changed',
      previousTitle: event.previousTitle,
      currentTitle: event.title,
      previousStatus: event.previousStatus,
      currentStatus: event.status,
      previousCompletedAt: event.previousCompletedAt,
      currentCompletedAt: event.completedAt,
      previousDueAt: event.previousDueAt,
      currentDueAt: event.dueAt,
      observedAt: event.occurredAt,
    };
  }

  private async lookupMissingTasks(
    input: TaskFulfillmentInput,
    taskGuids: string[],
    taskByGuid: Map<string, TaskFulfillmentItem>,
    taskSourceIncomplete: boolean,
    taskLookupUnavailable: Set<string>,
    warnings: string[],
  ): Promise<DailyReportTaskRecord[]> {
    if (taskSourceIncomplete || !this.tasks.getTaskByGuid) return [];
    const missingGuids: string[] = taskGuids.filter(
      (guid: string): boolean => !taskByGuid.has(guid),
    );
    const detailedTasks: DailyReportTaskRecord[] = [];
    for (const taskGuid of missingGuids) {
      try {
        const task: DailyReportTaskRecord | null =
          await this.tasks.getTaskByGuid(
            input.integration,
            input.actorOpenId,
            taskGuid,
          );
        if (task === null) continue;
        taskByGuid.set(
          task.guid,
          this.toTaskItem(task, input.timezone, input.referenceDate),
        );
        detailedTasks.push(task);
      } catch (error: unknown) {
        taskLookupUnavailable.add(taskGuid);
        this.logger.warn(
          `Task detail read failed for ${taskGuid}: ${error instanceof Error
            ? error.message
            : String(error)}`,
        );
      }
    }
    if (taskLookupUnavailable.size > 0) {
      warnings.push('部分关联任务详情读取失败，承诺状态无法完全核实');
    }
    return detailedTasks;
  }

  private toPromise(
    action: PendingAction,
    taskByGuid: Map<string, TaskFulfillmentItem>,
    taskSourceIncomplete: boolean,
    taskLookupUnavailable: Set<string>,
    changeByGuid: Map<string, TaskFulfillmentChange>,
    replacements: TaskReplacementResult,
  ): TaskPromiseFulfillmentItem | null {
    if ((action.payload.actionKind ?? 'followup') !== 'followup') return null;
    const candidate: FollowupTaskCandidate | undefined =
      this.selectedCandidate(action);
    const nextAction: string = (
      candidate?.title ?? action.payload.draft.nextAction ?? ''
    ).trim();
    if (!nextAction || NO_NEXT_STEP_PATTERN.test(nextAction)) return null;

    const taskGuid: string | null = action.result.taskGuid?.trim() || null;
    const originalTask: TaskFulfillmentItem | undefined = taskGuid === null
      ? undefined
      : taskByGuid.get(taskGuid);
    const replacement: TaskReplacement | undefined = taskGuid === null
      ? undefined
      : replacements.byOriginalGuid.get(taskGuid);
    const replacementTask: TaskFulfillmentItem | undefined = replacement === undefined
      ? undefined
      : taskByGuid.get(replacement.taskGuid);
    const useReplacement: boolean = originalTask === undefined &&
      replacement !== undefined;
    const effectiveGuid: string | null = useReplacement
      ? replacement?.taskGuid ?? taskGuid
      : taskGuid;
    const task: TaskFulfillmentItem | undefined = useReplacement
      ? replacementTask
      : originalTask;
    const change: TaskFulfillmentChange | undefined = effectiveGuid === null
      ? undefined
      : changeByGuid.get(effectiveGuid);
    const status: TaskPromiseStatus = this.promiseStatus(
      effectiveGuid,
      task,
      taskSourceIncomplete,
      taskLookupUnavailable,
      change,
    );
    return {
      pendingActionId: action.id,
      customerName: candidate?.customerName ??
        action.payload.draft.customerName,
      opportunityName: candidate?.opportunityName ??
        action.payload.draft.opportunityName,
      nextAction,
      promisedDueAt: candidate?.dueAt ?? action.payload.draft.dueAt,
      confirmedAt: action.updatedAt.toISOString(),
      taskGuid,
      taskUrl: task?.url ?? action.result.taskUrl ?? null,
      taskTitle: task?.title ?? null,
      taskStatus: task?.status ?? null,
      taskCompletedAt: task?.completedAt ?? null,
      taskDueAt: task?.dueAt ?? null,
      ...(replacement ? {
        replacementTaskGuid: replacement.taskGuid,
        replacementTaskUrl: replacementTask?.url ?? replacement.taskUrl,
        replacementRelation: 'replaces' as const,
      } : {}),
      status,
      completionState: this.promiseCompletionState(
        effectiveGuid,
        task,
        taskLookupUnavailable,
      ),
      suggestedAction: this.promiseSuggestedAction(status),
      ...(change ? { change } : {}),
    };
  }

  private toTaskItem(
    task: DailyReportTaskRecord,
    timezone: string,
    referenceDate: string,
  ): TaskFulfillmentItem {
    const dueDate: string | null = task.dueAt
      ? localDateKey(new Date(task.dueAt), timezone)
      : null;
    const daysUntilDue: number | null = dueDate === null
      ? null
      : dateOrdinal(dueDate) - dateOrdinal(referenceDate);
    return {
      guid: task.guid,
      title: task.title,
      status: task.status,
      completedAt: task.completedAt ?? null,
      dueAt: task.dueAt,
      dueDate,
      daysUntilDue,
      url: task.url,
      ...classify(daysUntilDue),
    };
  }

  private selectedCandidate(
    action: PendingAction,
  ): FollowupTaskCandidate | undefined {
    const selectedId: string | undefined =
      action.payload.selectedTaskCandidateIds?.[0];
    if (!selectedId) return undefined;
    return action.payload.taskCandidates?.find(
      (candidate: FollowupTaskCandidate): boolean =>
        candidate.id === selectedId,
    );
  }

  private promiseStatus(
    taskGuid: string | null,
    task: TaskFulfillmentItem | undefined,
    taskSourceIncomplete: boolean,
    taskLookupUnavailable: Set<string>,
    change: TaskFulfillmentChange | undefined,
  ): TaskPromiseStatus {
    if (taskGuid === null) return 'not_task_tracked';
    if (taskLookupUnavailable.has(taskGuid)) return 'task_lookup_unavailable';
    if (task === undefined) {
      return taskSourceIncomplete ? 'task_lookup_incomplete' : 'task_not_visible';
    }
    if (task.completedAt !== null) return 'completed';
    if (change?.kind === 'changed' || change?.kind === 'reopened') {
      return 'open_changed';
    }
    if (task.category === 'overdue') return 'open_overdue';
    if (task.category === 'due_today') return 'open_due_today';
    if (task.category === 'unscheduled') return 'open_unscheduled';
    return 'open_scheduled';
  }

  private promiseSuggestedAction(status: TaskPromiseStatus): string {
    const actions: Record<TaskPromiseStatus, string> = {
      open_overdue: '该承诺关联的任务已逾期，立即确认是否继续执行并更新期限。',
      open_due_today: '该承诺今天到期，请完成后及时更新任务状态。',
      open_scheduled: '该承诺已形成未完成任务，按当前排期推进。',
      open_unscheduled: '该承诺已形成任务，但任务缺少可检查的截止时间。',
      open_changed: '关联任务最近发生变更，请确认新的标题、期限和执行安排。',
      completed: '关联任务已被读取为完成，请复核完成证据并更新跟进记录。',
      not_task_tracked: '该跟进承诺没有关联任务，需要人工确认是否补建任务。',
      task_not_visible: '关联任务不在当前未完成任务范围内，需要人工核对完成、删除或移交状态。',
      task_lookup_incomplete: '任务读取不完整，暂不能判断关联任务是否仍未完成，请稍后重试。',
      task_lookup_unavailable: '关联任务详情读取失败，暂不能判断是否完成或发生变更。',
    };
    return actions[status];
  }

  private promiseCompletionState(
    taskGuid: string | null,
    task: TaskFulfillmentItem | undefined,
    taskLookupUnavailable: Set<string>,
  ): TaskPromiseCompletionState {
    if (taskGuid === null || task === undefined) return 'unknown';
    if (taskLookupUnavailable.has(taskGuid)) return 'unknown';
    if (task.completedAt !== null) return 'completed';
    const normalizedStatus: string = task.status
      .normalize('NFKC')
      .trim()
      .toLocaleLowerCase()
      .replace(/[\s_-]+/gu, '');
    return PARTIAL_TASK_STATUSES.has(normalizedStatus)
      ? 'partially_completed'
      : 'still_open';
  }

  private count(
    items: TaskFulfillmentItem[],
    category: TaskFulfillmentCategory,
  ): number {
    return items.filter(
      (item: TaskFulfillmentItem): boolean => item.category === category,
    ).length;
  }

  private recommend(metrics: TaskFulfillmentMetrics): string[] {
    const recommendations: string[] = [];
    if (metrics.overdueCount > 0) {
      recommendations.push(
        `优先处理 ${metrics.overdueCount} 个逾期任务，确认继续执行或调整期限。`,
      );
    }
    if (metrics.dueTodayCount > 0) {
      recommendations.push(
        `今天有 ${metrics.dueTodayCount} 个任务到期，完成后及时更新飞书任务。`,
      );
    }
    if (metrics.dueSoonCount > 0) {
      recommendations.push(
        `提前准备 ${metrics.dueSoonCount} 个三天内到期任务所需的材料和协作。`,
      );
    }
    if (metrics.unscheduledCount > 0) {
      recommendations.push(
        `为 ${metrics.unscheduledCount} 个未设期限任务补充可检查的截止时间。`,
      );
    }
    if (metrics.overduePromiseCount > 0) {
      recommendations.push(
        `有 ${metrics.overduePromiseCount} 个销售承诺关联任务已逾期，优先重新确认交付时间。`,
      );
    }
    if (metrics.partiallyCompletedPromiseCount > 0) {
      recommendations.push(
        `有 ${metrics.partiallyCompletedPromiseCount} 个销售承诺对应任务已开始但未完成，建议确认剩余工作和新的交付时间。`,
      );
    }
    if (metrics.untrackedPromiseCount > 0) {
      recommendations.push(
        `有 ${metrics.untrackedPromiseCount} 个已确认跟进承诺未关联任务，建议逐条补充执行载体。`,
      );
    }
    if (metrics.unverifiablePromiseCount > 0) {
      recommendations.push(
        `有 ${metrics.unverifiablePromiseCount} 个关联任务当前不可见，需要人工核对结果。`,
      );
    }
    if (metrics.openTaskCount > 0 && recommendations.length === 0) {
      recommendations.push('当前任务均在正常排期内，按计划推进即可。');
    }
    return recommendations;
  }

  private unavailable(
    input: TaskFulfillmentInput,
    now: Date,
    warnings: string[],
  ): TaskFulfillmentResponse {
    return {
      referenceDate: input.referenceDate,
      timezone: input.timezone,
      status: 'unavailable',
      generatedAt: now.toISOString(),
      metrics: {
        openTaskCount: 0,
        completedTaskCount: 0,
        overdueCount: 0,
        dueTodayCount: 0,
        dueSoonCount: 0,
        unscheduledCount: 0,
        scheduledCount: 0,
        promiseCount: 0,
        linkedOpenPromiseCount: 0,
        completedPromiseCount: 0,
        partiallyCompletedPromiseCount: 0,
        stillOpenPromiseCount: 0,
        changedPromiseCount: 0,
        overduePromiseCount: 0,
        untrackedPromiseCount: 0,
        unverifiablePromiseCount: 0,
      },
      items: [],
      completedItems: [],
      promises: [],
      changes: [],
      recommendations: [],
      coverage: {
        openTasks: true,
        completedTasks: 'unavailable',
        promiseReconciliation: 'agent_confirmed_only',
        promiseHistoryDays: PROMISE_HISTORY_DAYS,
        taskSnapshots: 'unavailable',
        taskHistory: 'unavailable',
      },
      warnings,
    };
  }

  private countPromises(
    promises: TaskPromiseFulfillmentItem[],
    status: TaskPromiseStatus,
  ): number {
    return promises.filter(
      (promise: TaskPromiseFulfillmentItem): boolean =>
        promise.status === status,
    ).length;
  }

  private countCompletionStates(
    promises: TaskPromiseFulfillmentItem[],
    state: TaskPromiseCompletionState,
  ): number {
    return promises.filter(
      (promise: TaskPromiseFulfillmentItem): boolean =>
        promise.completionState === state,
    ).length;
  }
}

export { TaskFulfillmentService };
export type { TaskFulfillmentInput, TaskFulfillmentTasksReader };
