import { describe, expect, it, vi } from 'vitest';

import type {
  StaleOpportunityFollowupPage,
  StaleOpportunityPage,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import {
  StaleOpportunityGovernanceError,
  StaleOpportunityReadinessService,
} from
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

  it('retains the invalid followup identity and version for manual repair', async (): Promise<void> => {
    const records = reader(
      [opportunity()],
      [
        followup('opportunity-1', '2026-09-20T02:00:00.000Z'),
        {
          ...followup('opportunity-1', '2026-09-21T02:00:00.000Z'),
          recordId: 'followup-missing-time',
          communicationAt: null,
          sourceVersion: 'followup-v2',
        },
      ],
    );

    const result = await new StaleOpportunityReadinessService(records).generate({
      integration,
      actorOpenId: 'ou_sales_a',
      now: NOW,
    });

    expect(result.items[0]).toMatchObject({
      lastEffectiveFollowupAt: null,
      followupRecordId: 'followup-missing-time',
      followupSourceVersion: 'followup-v2',
      blockers: ['followup_time_missing'],
    });
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

  it('governs one opportunity with version checks, write verification, and audit', async (): Promise<void> => {
    let currentOpportunity = opportunity('unknown');
    let currentFollowup = {
      ...followup('opportunity-unknown', '2026-09-20T02:00:00.000Z'),
      sourceVersion: 'followup-v1',
    };
    const audit = vi.fn(async (): Promise<void> => undefined);
    const records = {
      readStaleOpportunity: vi.fn(async (): Promise<typeof currentOpportunity> =>
        currentOpportunity),
      readStaleOpportunityFollowup: vi.fn(
        async (): Promise<typeof currentFollowup> => currentFollowup,
      ),
      updateOpportunityStatus: vi.fn(async (_integration: TenantIntegration,
        _actorOpenId: string,
        input: {
          status: 'active' | 'won' | 'lost' | 'closed';
          expectedStatus: 'active' | 'won' | 'lost' | 'closed' | 'unknown';
        }): Promise<{
        previousStatus: typeof input.expectedStatus;
        status: typeof input.status;
      }> => {
        const previousStatus = currentOpportunity.status;
        currentOpportunity = {
          ...currentOpportunity,
          status: input.status,
          sourceVersion: 'opportunity-v2',
        };
        return { previousStatus, status: input.status };
      }),
      updateStaleOpportunityFollowupCommunicationAt: vi.fn(
        async (_integration: TenantIntegration, _actorOpenId: string,
          input: { communicationAt: string }): Promise<{
          communicationAt: string;
          sourceVersion: string;
          recordUrl: string | null;
        }> => {
          currentFollowup = {
            ...currentFollowup,
            communicationAt: new Date(input.communicationAt).toISOString(),
            sourceVersion: 'followup-v2',
          };
          return {
            communicationAt: currentFollowup.communicationAt,
            sourceVersion: currentFollowup.sourceVersion,
            recordUrl: null,
          };
        },
      ),
    };
    const service = new StaleOpportunityReadinessService(
      records,
      undefined,
      { appendAudit: audit } as never,
    );

    const result = await service.govern({
      integration,
      actorOpenId: 'ou_sales_a',
      request: {
        recordId: 'opportunity-unknown',
        status: 'active',
        expectedStatus: 'unknown',
        expectedSourceVersion: currentOpportunity.sourceVersion,
        followupRecordId: currentFollowup.recordId,
        expectedFollowupSourceVersion: currentFollowup.sourceVersion,
        communicationAt: '2026-09-23T02:00:00.000Z',
        idempotencyKey: 'governance-1',
      },
    });

    expect(result).toMatchObject({
      status: 'active',
      communicationAt: '2026-09-23T02:00:00.000Z',
      sourceVersion: 'opportunity-v2',
      followupSourceVersion: 'followup-v2',
    });
    expect(audit).toHaveBeenCalledTimes(2);
    expect(audit.mock.calls.map((call) => call[0].outcome)).toEqual([
      'accepted',
      'succeeded',
    ]);
  });

  it('rejects stale versions before any write', async (): Promise<void> => {
    const records = {
      readStaleOpportunity: vi.fn(async () => opportunity('active')),
      updateOpportunityStatus: vi.fn(),
    };
    const service = new StaleOpportunityReadinessService(records);

    await expect(service.govern({
      integration,
      actorOpenId: 'ou_sales_a',
      request: {
        recordId: 'opportunity-1',
        status: 'won',
        expectedStatus: 'active',
        expectedSourceVersion: 'stale-version',
        followupRecordId: null,
        expectedFollowupSourceVersion: null,
        idempotencyKey: 'governance-2',
      },
    })).rejects.toMatchObject<Partial<StaleOpportunityGovernanceError>>({
      code: 'CONFLICT',
    });
    expect(records.updateOpportunityStatus).not.toHaveBeenCalled();
  });

  it('never creates a historical followup when no existing record exists', async (): Promise<void> => {
    const updateStatus = vi.fn();
    const records = {
      readStaleOpportunity: vi.fn(async () => opportunity('active')),
      updateOpportunityStatus: updateStatus,
      updateStaleOpportunityFollowupCommunicationAt: vi.fn(),
    };
    const service = new StaleOpportunityReadinessService(records);

    await expect(service.govern({
      integration,
      actorOpenId: 'ou_sales_a',
      request: {
        recordId: 'opportunity-1',
        status: 'active',
        expectedStatus: 'active',
        expectedSourceVersion: '2026-09-28T02:00:00.000Z',
        followupRecordId: null,
        expectedFollowupSourceVersion: null,
        communicationAt: '2026-09-23T02:00:00.000Z',
        idempotencyKey: 'governance-3',
      },
    })).rejects.toMatchObject<Partial<StaleOpportunityGovernanceError>>({
      code: 'VALIDATION_FAILED',
    });
    expect(updateStatus).not.toHaveBeenCalled();
  });
});
