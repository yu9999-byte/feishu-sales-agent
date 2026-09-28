import { describe, expect, it, vi } from 'vitest';

import type {
  DailyReportBaseResult,
  DailyReportTaskResult,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import {
  DailySalesReportService,
  type DailyReportRecordsReader,
  type DailyReportTasksReader,
} from '@server/modules/insight/daily-sales-report.service';

const NOW: Date = new Date('2026-09-29T04:00:00.000Z');

const integration: TenantIntegration = {
  tenantId: 'tenant-a',
  feishuTenantKey: 'tenant-key-a',
  name: 'Tenant A',
  status: 'active',
  appId: 'cli_test',
  appSecretEnv: 'TEST_SECRET',
  appType: 'selfBuild',
  base: {
    appToken: 'base-a',
    customers: {
      tableId: 'customers',
      primaryField: '客户名称',
      fields: { customerName: '客户名称' },
    },
    opportunities: {
      tableId: 'opportunities',
      primaryField: '商机名称',
      fields: {
        opportunityName: '商机名称',
        customerLink: '关联客户',
      },
    },
    followups: {
      tableId: 'followups',
      primaryField: '跟进标题',
      fields: {
        sourceMessageId: '来源消息ID',
        customerLink: '关联客户',
        opportunityLink: '关联商机',
        rawText: '跟进原文',
        summary: '跟进摘要',
      },
    },
  },
};

const baseResult: DailyReportBaseResult = {
  customers: [{
    recordId: 'customer-1',
    name: '北辰数字化',
    sourceVersion: '2026-09-29T03:00:00.000Z',
    recordUrl: 'https://example.com/customer-1',
  }],
  opportunities: [{
    recordId: 'opportunity-1',
    name: '北辰试点',
    progress: '方案评估',
    nextAction: '安排技术交流',
    dueAt: '2026-09-30T02:00:00.000Z',
    sourceVersion: '2026-09-29T03:00:00.000Z',
    recordUrl: 'https://example.com/opportunity-1',
  }],
  followups: [{
    recordId: 'followup-1',
    customerRecordId: 'customer-1',
    opportunityRecordId: 'opportunity-1',
    summary: '已完成方案评审，客户等待内部确认',
    communicationAt: '2026-09-29T02:00:00.000Z',
    nextAction: '安排技术交流',
    dueAt: '2026-09-30T02:00:00.000Z',
    sourceVersion: '2026-09-29T02:00:00.000Z',
    recordUrl: 'https://example.com/followup-1',
  }],
  warnings: [],
};

const taskResult: DailyReportTaskResult = {
  items: [{
    guid: 'task-1',
    title: '补充客户预算信息',
    status: 'todo',
    dueAt: '2026-09-28T02:00:00.000Z',
    url: 'https://example.com/task-1',
  }],
};

describe('DailySalesReportService', (): void => {
  it('aggregates only the requested local day and marks overdue tasks', async (): Promise<void> => {
    const records: DailyReportRecordsReader = {
      readDailyReport: vi.fn(async (): Promise<DailyReportBaseResult> => baseResult),
    };
    const tasks: DailyReportTasksReader = {
      listOwnedTasks: vi.fn(async (): Promise<DailyReportTaskResult> => taskResult),
    };
    const service: DailySalesReportService = new DailySalesReportService(
      records,
      tasks,
    );

    const result = await service.generate({
      integration,
      actorOpenId: 'ou_sales_a',
      reportDate: '2026-09-29',
      timezone: 'Asia/Shanghai',
      now: NOW,
    });

    expect(result.status).toBe('ready');
    expect(result.metrics).toEqual({
      followupCount: 1,
      opportunityCount: 1,
      openTaskCount: 1,
      overdueTaskCount: 1,
    });
    expect(result.followups[0]).toMatchObject({
      customerName: '北辰数字化',
      opportunityName: '北辰试点',
    });
    expect(result.tasks[0]?.overdue).toBe(true);
    expect(result.nextActions).toEqual([
      '安排技术交流',
      '补充客户预算信息',
    ]);
  });

  it('does not invent report data when Base pagination is incomplete', async (): Promise<void> => {
    const records: DailyReportRecordsReader = {
      readDailyReport: async (): Promise<DailyReportBaseResult> => ({
        customers: [],
        followups: [],
        opportunities: [],
        warnings: ['daily_report_pagination_incomplete'],
      }),
    };
    const tasks: DailyReportTasksReader = {
      listOwnedTasks: async (): Promise<DailyReportTaskResult> => taskResult,
    };
    const result = await new DailySalesReportService(records, tasks).generate({
      integration,
      actorOpenId: 'ou_sales_a',
      reportDate: '2026-09-29',
      timezone: 'Asia/Shanghai',
      now: NOW,
    });

    expect(result.status).toBe('unavailable');
    expect(result.metrics).toEqual({
      followupCount: 0,
      opportunityCount: 0,
      openTaskCount: 0,
      overdueTaskCount: 0,
    });
    expect(result.warnings).toContain('daily_report_pagination_incomplete');
  });

  it('returns an honest empty report without writes when sources are complete but empty', async (): Promise<void> => {
    const records: DailyReportRecordsReader = {
      readDailyReport: async (): Promise<DailyReportBaseResult> => ({
        customers: [],
        followups: [],
        opportunities: [],
        warnings: [],
      }),
    };
    const tasks: DailyReportTasksReader = {
      listOwnedTasks: async (): Promise<DailyReportTaskResult> => ({ items: [] }),
    };
    const result = await new DailySalesReportService(records, tasks).generate({
      integration,
      actorOpenId: 'ou_sales_a',
      reportDate: '2026-09-29',
      timezone: 'Asia/Shanghai',
      now: NOW,
    });

    expect(result.status).toBe('empty');
    expect(result.highlights).toEqual(['当天没有读取到已登记的跟进']);
    expect(result.warnings).toEqual([]);
  });
});
