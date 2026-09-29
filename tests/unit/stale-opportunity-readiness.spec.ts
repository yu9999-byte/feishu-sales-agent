import { describe, expect, it, vi } from 'vitest';

import type {
  StaleOpportunityFollowupPage,
  StaleOpportunityPage,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import { StaleOpportunityReadinessService } from
  '@server/modules/insight/stale-opportunity-readiness.service';

const NOW = new Date('2026-09-29T02:00:00.000Z');

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
        ownerOpenId: '负责人',
        status: '商机状态',
      },
      statusValues: { active: ['进行中'] },
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

const opportunity = (
  status: StaleOpportunityPage['items'][number]['status'] = 'active',
): StaleOpportunityPage['items'][number] => ({
  recordId: status === 'unknown' ? 'opportunity-unknown' : 'opportunity-1',
  name: status === 'unknown' ? '待确认商机' : '北辰数字化项目',
  status,
  ownerOpenId: 'ou_sales_a',
  sourceVersion: '2026-09-28T02:00:00.000Z',
  recordUrl: 'https://example.com/opportunity',
});

const followup = (
  opportunityRecordId = 'opportunity-1',
  communicationAt = '2026-09-20T02:00:00.000Z',
): StaleOpportunityFollowupPage['items'][number] => ({
  recordId: `followup-${opportunityRecordId}`,
  opportunityRecordId,
  communicationAt,
  sourceVersion: `version-${communicationAt}`,
});

const reader = (
  opportunities: StaleOpportunityPage['items'],
  followups: StaleOpportunityFollowupPage['items'],
) => ({
  readStaleOpportunityPage: vi.fn(async (): Promise<StaleOpportunityPage> => ({
    items: opportunities,
    nextPageToken: null,
  })),
  readStaleOpportunityFollowupPage: vi.fn(
    async (): Promise<StaleOpportunityFollowupPage> => ({
      items: followups,
      nextPageToken: null,
    }),
  ),
});

describe('StaleOpportunityReadinessService', (): void => {
  it('reports confirmed status and latest effective followup time', async (): Promise<void> => {
    const records = reader(
      [opportunity()],
      [
        followup('opportunity-1', '2026-09-19T02:00:00.000Z'),
        followup('opportunity-1', '2026-09-20T02:00:00.000Z'),
      ],
    );
    const result = await new StaleOpportunityReadinessService(records).generate({
      integration,
      actorOpenId: 'ou_sales_a',
      now: NOW,
    });

    expect(result.status).toBe('ready');
    expect(result.summary).toEqual({
      opportunityCount: 1,
      statusConfirmedCount: 1,
      statusNeedsConfirmationCount: 0,
      followupTimeConfirmedCount: 1,
      followupTimeNeedsConfirmationCount: 0,
      readyForScanCount: 1,
    });
    expect(result.items[0]).toMatchObject({
      status: 'active',
      lastEffectiveFollowupAt: '2026-09-20T02:00:00.000Z',
      blockers: [],
    });
  });

  it('never infers unknown status or missing history time', async (): Promise<void> => {
    const records = reader(
      [opportunity('unknown'), {
        ...opportunity(),
        recordId: 'opportunity-2',
        name: '没有历史跟进',
      }],
      [],
    );
    const result = await new StaleOpportunityReadinessService(records).generate({
      integration,
      actorOpenId: 'ou_sales_a',
      now: NOW,
    });

    expect(result.summary).toMatchObject({
      opportunityCount: 2,
      statusNeedsConfirmationCount: 1,
      followupTimeNeedsConfirmationCount: 2,
      readyForScanCount: 0,
    });
    expect(result.items.map((item) => item.blockers)).toEqual([
      ['status_unconfirmed', 'followup_time_missing'],
      ['followup_time_missing'],
    ]);
  });

  it('fails closed when either source is incomplete', async (): Promise<void> => {
    const records = {
      readStaleOpportunityPage: vi.fn(
        async (): Promise<StaleOpportunityPage> => ({
          items: [opportunity()],
          nextPageToken: null,
          warning: 'stale_opportunity_pagination_incomplete',
        }),
      ),
      readStaleOpportunityFollowupPage: vi.fn(
        async (): Promise<StaleOpportunityFollowupPage> => ({
          items: [followup()],
          nextPageToken: null,
        }),
      ),
    };
    const result = await new StaleOpportunityReadinessService(records).generate({
      integration,
      actorOpenId: 'ou_sales_a',
      now: NOW,
    });

    expect(result).toMatchObject({
      status: 'incomplete',
      items: [],
      warnings: ['stale_opportunity_pagination_incomplete'],
    });
  });

  it('returns unavailable when the integration is disabled', async (): Promise<void> => {
    const records = reader([], []);
    const result = await new StaleOpportunityReadinessService(records).generate({
      integration: { ...integration, status: 'disabled' },
      actorOpenId: 'ou_sales_a',
      now: NOW,
    });

    expect(result.status).toBe('unavailable');
    expect(records.readStaleOpportunityPage).not.toHaveBeenCalled();
  });
});
