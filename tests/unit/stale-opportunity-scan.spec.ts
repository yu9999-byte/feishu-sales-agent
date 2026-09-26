import { describe, expect, it, vi } from 'vitest';

import type {
  StaleOpportunityFollowupPage,
  StaleOpportunityPage,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import {
  StaleOpportunityScanService,
  type StaleOpportunityRecordsReader,
  type StaleOpportunityTaskReader,
} from '@server/modules/insight/stale-opportunity-scan.service';

const NOW = new Date('2026-09-28T02:00:00.000Z');

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
      fields: {
        customerName: '客户名称',
      },
    },
    opportunities: {
      tableId: 'opportunities',
      primaryField: '商机名称',
      fields: {
        opportunityName: '商机名称',
        customerLink: '关联客户',
        ownerOpenId: '负责人',
        status: '商机状态',
      },
      statusValues: {
        active: ['进行中'],
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
        ownerOpenId: '负责人',
        communicationAt: '本次沟通发生时间',
      },
    },
  },
};

const opportunity = (): StaleOpportunityPage['items'][number] => ({
  recordId: 'opportunity-1',
  name: '北辰数字化项目',
  status: 'active',
  ownerOpenId: 'ou_sales_a',
  sourceVersion: '2026-09-21T02:00:00.000Z',
});

const followup = (
  communicationAt = '2026-09-20T01:00:00.000Z',
): StaleOpportunityFollowupPage['items'][number] => ({
  recordId: 'followup-1',
  opportunityRecordId: 'opportunity-1',
  communicationAt,
  sourceVersion: communicationAt,
});

const input = (enabled = true) => ({
  enabled,
  integration,
  actorOpenId: 'ou_sales_a',
  timezone: 'Asia/Shanghai',
  now: NOW,
});

describe('StaleOpportunityScanService', (): void => {
  it('is disabled by default and performs no reads', async (): Promise<void> => {
    const readStaleOpportunityPage = vi.fn();
    const readStaleOpportunityFollowupPage = vi.fn();
    const searchOwnedTasks = vi.fn();
    const service = new StaleOpportunityScanService(
      { readStaleOpportunityPage, readStaleOpportunityFollowupPage },
      { searchOwnedTasks },
    );

    const result = await service.scan({
      integration,
      actorOpenId: 'ou_sales_a',
      timezone: 'Asia/Shanghai',
      now: NOW,
    });

    expect(result.status).toBe('disabled');
    expect(result.skips[0]?.reason).toBe('disabled');
    expect(readStaleOpportunityPage).not.toHaveBeenCalled();
    expect(readStaleOpportunityFollowupPage).not.toHaveBeenCalled();
    expect(searchOwnedTasks).not.toHaveBeenCalled();
  });

  it('consumes all opportunity and followup pages before returning a candidate', async (): Promise<void> => {
    const readStaleOpportunityPage = vi.fn(
      async (
        _tenant: TenantIntegration,
        _actor: string,
        pageToken?: string,
      ): Promise<StaleOpportunityPage> => pageToken === 'opportunity-page-2'
        ? { items: [opportunity()], nextPageToken: null }
        : { items: [], nextPageToken: 'opportunity-page-2' },
    );
    const readStaleOpportunityFollowupPage = vi.fn(
      async (
        _tenant: TenantIntegration,
        _actor: string,
        pageToken?: string,
      ): Promise<StaleOpportunityFollowupPage> =>
        pageToken === 'followup-page-2'
          ? {
              items: [followup('2026-09-20T02:00:00.000Z')],
              nextPageToken: null,
            }
          : {
              items: [followup('2026-09-19T02:00:00.000Z')],
              nextPageToken: 'followup-page-2',
            },
    );
    const searchOwnedTasks = vi.fn(async () => ({ items: [] }));
    const service = new StaleOpportunityScanService(
      { readStaleOpportunityPage, readStaleOpportunityFollowupPage },
      { searchOwnedTasks },
    );

    const result = await service.scan(input());

    expect(result.status).toBe('complete');
    expect(result.candidates).toEqual([{
      opportunityRecordId: 'opportunity-1',
      opportunityName: '北辰数字化项目',
      ownerOpenId: 'ou_sales_a',
      followupRecordId: 'followup-1',
      lastEffectiveFollowupAt: '2026-09-20T02:00:00.000Z',
      followupVersion: '2026-09-20T02:00:00.000Z',
    }]);
    expect(readStaleOpportunityPage.mock.calls[1]?.[2])
      .toBe('opportunity-page-2');
    expect(readStaleOpportunityFollowupPage.mock.calls[1]?.[2])
      .toBe('followup-page-2');
    expect(searchOwnedTasks).toHaveBeenCalledWith(
      integration,
      'ou_sales_a',
      '北辰数字化项目',
    );
  });

  it('fails closed when a source reports incomplete pagination', async (): Promise<void> => {
    const readStaleOpportunityPage = vi.fn(
      async (): Promise<StaleOpportunityPage> => ({
        items: [opportunity()],
        nextPageToken: null,
        warning: 'stale_opportunity_pagination_incomplete',
      }),
    );
    const readStaleOpportunityFollowupPage = vi.fn();
    const searchOwnedTasks = vi.fn();
    const service = new StaleOpportunityScanService(
      { readStaleOpportunityPage, readStaleOpportunityFollowupPage },
      { searchOwnedTasks },
    );

    const result = await service.scan(input());

    expect(result).toMatchObject({
      status: 'incomplete',
      candidates: [],
      warnings: ['stale_opportunity_pagination_incomplete'],
    });
    expect(readStaleOpportunityFollowupPage).not.toHaveBeenCalled();
    expect(searchOwnedTasks).not.toHaveBeenCalled();
  });

  it('fails closed when Task read throws or reports partial visibility', async (): Promise<void> => {
    const records: StaleOpportunityRecordsReader = {
      readStaleOpportunityPage: async (): Promise<StaleOpportunityPage> => ({
        items: [opportunity()],
        nextPageToken: null,
      }),
      readStaleOpportunityFollowupPage:
        async (): Promise<StaleOpportunityFollowupPage> => ({
          items: [followup()],
          nextPageToken: null,
        }),
    };
    const unavailable = new StaleOpportunityScanService(records, {
      searchOwnedTasks: async (): Promise<never> => {
        throw new Error('Task unavailable');
      },
    });
    const limited = new StaleOpportunityScanService(records, {
      searchOwnedTasks: async () => ({
        items: [],
        warning: 'task_query_scope_limited',
      }),
    });

    expect(await unavailable.scan(input())).toMatchObject({
      status: 'incomplete',
      candidates: [],
      warnings: ['stale_opportunity_task_read_unavailable'],
    });
    expect(await limited.scan(input())).toMatchObject({
      status: 'incomplete',
      candidates: [],
      warnings: ['task_query_scope_limited'],
    });
  });

  it('skips a stale opportunity when relevant unfinished work exists', async (): Promise<void> => {
    const records: StaleOpportunityRecordsReader = {
      readStaleOpportunityPage: async (): Promise<StaleOpportunityPage> => ({
        items: [opportunity()],
        nextPageToken: null,
      }),
      readStaleOpportunityFollowupPage:
        async (): Promise<StaleOpportunityFollowupPage> => ({
          items: [followup()],
          nextPageToken: null,
        }),
    };
    const tasks: StaleOpportunityTaskReader = {
      searchOwnedTasks: async () => ({
        items: [{
          guid: 'task-1',
          title: '推进北辰数字化项目',
          status: 'todo',
          dueAt: null,
          url: null,
        }],
      }),
    };

    const result = await new StaleOpportunityScanService(records, tasks)
      .scan(input());

    expect(result.status).toBe('complete');
    expect(result.candidates).toEqual([]);
    expect(result.skips).toEqual([{
      opportunityRecordId: 'opportunity-1',
      opportunityName: '北辰数字化项目',
      reason: 'task_already_open',
    }]);
  });
});
