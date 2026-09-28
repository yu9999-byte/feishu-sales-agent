import { Inject, Injectable, Logger } from '@nestjs/common';

import type {
  DailySalesReportFollowup,
  DailySalesReportOpportunity,
  DailySalesReportResponse,
  DailySalesReportTask,
} from '@shared/api.interface';
import {
  SALES_RECORDS_GATEWAY,
  TASK_GATEWAY,
} from '@server/modules/agent-core/agent.ports';
import type {
  DailyReportBaseResult,
  DailyReportCustomerRecord,
  DailyReportOpportunityRecord,
  DailyReportTaskResult,
  DailyReportTaskRecord,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';

interface DailySalesReportInput {
  integration: TenantIntegration;
  actorOpenId: string;
  reportDate: string;
  timezone: string;
  now?: Date;
}

interface DailyReportRecordsReader {
  readDailyReport?(
    integration: TenantIntegration,
    actorOpenId: string,
    reportDate: string,
    timezone: string,
  ): Promise<DailyReportBaseResult>;
}

interface DailyReportTasksReader {
  listOwnedTasks?(
    integration: TenantIntegration,
    actorOpenId: string,
  ): Promise<DailyReportTaskResult>;
}

const REPORT_DATE_PATTERN: RegExp = /^\d{4}-\d{2}-\d{2}$/u;

const isValidReportDate = (value: string): boolean => {
  if (!REPORT_DATE_PATTERN.test(value)) return false;
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
    return isValidReportDate(result) ? result : null;
  } catch (_error: unknown) {
    return null;
  }
};

const dedupe = (values: string[], limit: number): string[] => {
  const unique: string[] = [];
  for (const value of values) {
    const normalized: string = value.trim();
    if (!normalized || unique.includes(normalized)) continue;
    unique.push(normalized);
    if (unique.length >= limit) break;
  }
  return unique;
};

@Injectable()
class DailySalesReportService {
  private readonly logger: Logger =
    new Logger(DailySalesReportService.name);

  constructor(
    @Inject(SALES_RECORDS_GATEWAY)
    private readonly records: DailyReportRecordsReader,
    @Inject(TASK_GATEWAY)
    private readonly tasks: DailyReportTasksReader,
  ) {}

  async generate(
    input: DailySalesReportInput,
  ): Promise<DailySalesReportResponse> {
    const now: Date = input.now ?? new Date();
    const warnings: string[] = [];
    if (input.integration.status !== 'active') {
      return this.unavailable(input, now, ['销售数据连接未启用']);
    }
    if (!input.actorOpenId.trim()) {
      return this.unavailable(input, now, ['当前销售身份不可用']);
    }
    if (!isValidReportDate(input.reportDate)) {
      return this.unavailable(input, now, ['日报日期格式无效']);
    }
    try {
      Intl.DateTimeFormat('en-US', { timeZone: input.timezone });
    } catch (_error: unknown) {
      return this.unavailable(input, now, ['销售时区无效']);
    }

    const baseResult: DailyReportBaseResult | null =
      await this.readBase(input, now, warnings);
    const taskResult: DailyReportTaskRecord[] =
      await this.readTasks(input, warnings);
    if (baseResult === null) {
      return this.unavailable(input, now, warnings);
    }
    if (baseResult.warnings.length > 0) {
      return this.unavailable(input, now, warnings);
    }

    const customers: Map<string, DailyReportCustomerRecord> = new Map(
      baseResult.customers.map(
        (customer: DailyReportCustomerRecord): [string, DailyReportCustomerRecord] =>
          [customer.recordId, customer],
      ),
    );
    const opportunities: Map<string, DailyReportOpportunityRecord> = new Map(
      baseResult.opportunities.map(
        (opportunity: DailyReportOpportunityRecord): [string, DailyReportOpportunityRecord] =>
          [opportunity.recordId, opportunity],
      ),
    );
    const followups: DailySalesReportFollowup[] = baseResult.followups
      .filter((item): item is typeof item & { communicationAt: string } => {
        if (!item.communicationAt) {
          warnings.push('存在没有沟通时间的跟进，已跳过');
          return false;
        }
        return localDateKey(
          new Date(item.communicationAt),
          input.timezone,
        ) === input.reportDate;
      })
      .sort(
        (left, right): number =>
          Date.parse(right.communicationAt) - Date.parse(left.communicationAt),
      )
      .map((item): DailySalesReportFollowup => ({
        recordId: item.recordId,
        customerName: item.customerRecordId
          ? customers.get(item.customerRecordId)?.name ?? null
          : null,
        opportunityName: item.opportunityRecordId
          ? opportunities.get(item.opportunityRecordId)?.name ?? null
          : null,
        summary: item.summary,
        communicationAt: item.communicationAt,
        nextAction: item.nextAction,
        dueAt: item.dueAt,
        source: {
          recordId: item.recordId,
          recordUrl: item.recordUrl,
          sourceVersion: item.sourceVersion,
        },
      }));

    const touchedOpportunityIds: Set<string> = new Set(
      followups.flatMap((item): string[] => {
        const source = baseResult.followups.find(
          (candidate): boolean => candidate.recordId === item.recordId,
        );
        return source?.opportunityRecordId
          ? [source.opportunityRecordId]
          : [];
      }),
    );
    const reportOpportunities: DailySalesReportOpportunity[] =
      [...touchedOpportunityIds]
        .map((recordId): DailyReportOpportunityRecord | null =>
          opportunities.get(recordId) ?? null,
        )
        .filter(
          (item): item is DailyReportOpportunityRecord => item !== null,
        )
        .map((item): DailySalesReportOpportunity => ({
          recordId: item.recordId,
          name: item.name,
          progress: item.progress,
          nextAction: item.nextAction,
          dueAt: item.dueAt,
          source: {
            recordId: item.recordId,
            recordUrl: item.recordUrl,
            sourceVersion: item.sourceVersion,
          },
        }));

    const reportTasks: DailySalesReportTask[] = taskResult
      .map((task: DailyReportTaskRecord): DailySalesReportTask => {
        const dueDate: string | null = task.dueAt
          ? localDateKey(new Date(task.dueAt), input.timezone)
          : null;
        return {
          guid: task.guid,
          title: task.title,
          status: task.status,
          dueAt: task.dueAt,
          url: task.url,
          overdue: dueDate !== null && dueDate < input.reportDate,
        };
      })
      .sort((left, right): number => {
        if (left.dueAt === null) return 1;
        if (right.dueAt === null) return -1;
        return Date.parse(left.dueAt) - Date.parse(right.dueAt);
      });

    const overdueTaskCount: number = reportTasks.filter(
      (task: DailySalesReportTask): boolean => task.overdue,
    ).length;
    const highlights: string[] = [];
    if (followups.length === 0) {
      highlights.push('当天没有读取到已登记的跟进');
    } else {
      highlights.push(`当天登记了 ${followups.length} 条跟进`);
    }
    if (reportOpportunities.length > 0) {
      highlights.push(`当天跟进涉及 ${reportOpportunities.length} 个商机`);
    }
    if (overdueTaskCount > 0) {
      highlights.push(`有 ${overdueTaskCount} 个未完成任务已逾期`);
    }

    const nextActions: string[] = dedupe([
      ...followups.map(
        (item: DailySalesReportFollowup): string => item.nextAction ?? '',
      ),
      ...reportOpportunities.map(
        (item: DailySalesReportOpportunity): string => item.nextAction ?? '',
      ),
      ...reportTasks.map((item: DailySalesReportTask): string => item.title),
    ], 5);
    if (nextActions.length === 0 && followups.length > 0) {
      warnings.push('当天跟进没有明确下一步');
    }

    const hasData: boolean = followups.length > 0 ||
      reportOpportunities.length > 0 || reportTasks.length > 0;
    const status = warnings.length > 0
      ? hasData ? 'partial' : 'unavailable'
      : hasData ? 'ready' : 'empty';
    return {
      reportDate: input.reportDate,
      timezone: input.timezone,
      status,
      generatedAt: now.toISOString(),
      metrics: {
        followupCount: followups.length,
        opportunityCount: reportOpportunities.length,
        openTaskCount: reportTasks.length,
        overdueTaskCount,
      },
      followups,
      opportunities: reportOpportunities,
      tasks: reportTasks,
      highlights,
      nextActions,
      warnings,
    };
  }

  private async readBase(
    input: DailySalesReportInput,
    _now: Date,
    warnings: string[],
  ): Promise<DailyReportBaseResult | null> {
    if (!this.records.readDailyReport) {
      warnings.push('跟进数据源未配置');
      return null;
    }
    try {
      const result: DailyReportBaseResult =
        await this.records.readDailyReport(
          input.integration,
          input.actorOpenId,
          input.reportDate,
          input.timezone,
        );
      warnings.push(...result.warnings);
      return result;
    } catch (error: unknown) {
      this.logger.warn(
        `Daily report Base read failed: ${error instanceof Error
          ? error.message
          : String(error)}`,
      );
      warnings.push('跟进数据源暂时不可用');
      return null;
    }
  }

  private async readTasks(
    input: DailySalesReportInput,
    warnings: string[],
  ): Promise<DailyReportTaskRecord[]> {
    if (!this.tasks.listOwnedTasks) {
      warnings.push('任务数据源未配置');
      return [];
    }
    try {
      const result = await this.tasks.listOwnedTasks(
        input.integration,
        input.actorOpenId,
      );
      if (result.warning) warnings.push(result.warning);
      return result.items;
    } catch (error: unknown) {
      this.logger.warn(
        `Daily report Task read failed: ${error instanceof Error
          ? error.message
          : String(error)}`,
      );
      warnings.push('任务数据源暂时不可用');
      return [];
    }
  }

  private unavailable(
    input: DailySalesReportInput,
    now: Date,
    warnings: string[],
  ): DailySalesReportResponse {
    return {
      reportDate: input.reportDate,
      timezone: input.timezone,
      status: 'unavailable',
      generatedAt: now.toISOString(),
      metrics: {
        followupCount: 0,
        opportunityCount: 0,
        openTaskCount: 0,
        overdueTaskCount: 0,
      },
      followups: [],
      opportunities: [],
      tasks: [],
      highlights: [],
      nextActions: [],
      warnings,
    };
  }
}

export { DailySalesReportService };
export type {
  DailyReportRecordsReader,
  DailyReportTasksReader,
  DailySalesReportInput,
};
