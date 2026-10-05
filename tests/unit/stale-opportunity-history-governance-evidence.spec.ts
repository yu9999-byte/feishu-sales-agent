import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';

import type {
  StaleOpportunityReadinessItem,
  StaleOpportunityReadinessResponse,
} from '@shared/api.interface';
import type { AgentRuntimeConfig } from '@server/config/agent.config';
import type {
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import type {
  PlatformMember,
} from '@server/modules/identity-access/identity-access.types';
import {
  StaleOpportunityHistoryGovernanceEvidenceService,
} from '@server/modules/insight/stale-opportunity-history-governance-evidence.service';
import {
  StaleOpportunityReadinessModule,
} from '@server/modules/insight/stale-opportunity-readiness.module';

const NOW: Date = new Date('2026-10-06T02:00:00.000Z');
const TENANT_ID: string = '00000000-0000-4000-8000-00000000000a';
const MEMBER_ID: string = '00000000-0000-4000-8000-00000000000b';
const OPEN_ID: string = 'ou_sales_a';

const config = (): AgentRuntimeConfig => ({
  host: '127.0.0.1',
  port: 3100,
  databaseUrl: 'postgres://test',
  llm: {
    baseUrl: 'https://llm.example.test',
    apiKey: 'test-key',
    model: 'test-model',
  },
  feishu: {
    verificationToken: 'verification-token',
    encryptKey: undefined,
  },
  staleOpportunityReminder: {
    enabled: false,
    historyGovernanceReady: false,
    senderConfigured: false,
    execution: {
      enabled: false,
      triggerToken: 'execution-token',
      allowedTenantId: TENANT_ID,
      allowedMemberId: MEMBER_ID,
      allowedRecipientOpenId: OPEN_ID,
    },
  },
});

const integration = (): TenantIntegration => ({
  tenantId: TENANT_ID,
  feishuTenantKey: 'tenant-key-a',
  name: '测试企业',
  status: 'active',
  appId: 'cli_test',
  appSecretEnv: 'TEST_FEISHU_SECRET',
  appType: 'selfBuild',
  base: {
    appToken: 'base-token',
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
        sourceMessageId: '来源消息',
        customerLink: '关联客户',
        opportunityLink: '关联商机',
        rawText: '原文',
        summary: '摘要',
        ownerOpenId: '负责人',
        communicationAt: '沟通时间',
      },
    },
  },
});

const member = (openId: string = OPEN_ID): PlatformMember => ({
  id: MEMBER_ID,
  tenantId: TENANT_ID,
  feishuOpenId: openId,
  displayName: '销售甲',
  status: 'active',
});

const item = (
  blockers: StaleOpportunityReadinessItem['blockers'] = [],
): StaleOpportunityReadinessItem => ({
  recordId: 'opportunity-1',
  name: '北辰数字化项目',
  status: blockers.includes('status_unconfirmed') ? 'unknown' : 'active',
  sourceVersion: 'opportunity-version-1',
  lastEffectiveFollowupAt: blockers.includes('followup_time_missing')
    ? null
    : '2026-09-20T02:00:00.000Z',
  followupRecordId: 'followup-1',
  followupSourceVersion: 'followup-version-1',
  blockers,
  recordUrl: 'https://example.test/opportunity-1',
});

const report = (
  items: StaleOpportunityReadinessItem[],
  status: StaleOpportunityReadinessResponse['status'] = 'ready',
): StaleOpportunityReadinessResponse => ({
  generatedAt: NOW.toISOString(),
  status,
  summary: {
    opportunityCount: items.length,
    statusConfirmedCount: items.filter(
      (current: StaleOpportunityReadinessItem): boolean =>
        current.status !== 'unknown',
    ).length,
    statusNeedsConfirmationCount: items.filter(
      (current: StaleOpportunityReadinessItem): boolean =>
        current.blockers.includes('status_unconfirmed'),
    ).length,
    followupTimeConfirmedCount: items.filter(
      (current: StaleOpportunityReadinessItem): boolean =>
        current.lastEffectiveFollowupAt !== null,
    ).length,
    followupTimeNeedsConfirmationCount: items.filter(
      (current: StaleOpportunityReadinessItem): boolean =>
        current.blockers.includes('followup_time_missing'),
    ).length,
    readyForScanCount: items.filter(
      (current: StaleOpportunityReadinessItem): boolean =>
        current.blockers.length === 0,
    ).length,
  },
  items: status === 'ready' ? items : [],
  warnings: status === 'ready' ? [] : ['source_incomplete'],
});

const service = (
  selectedReport: StaleOpportunityReadinessResponse,
  selectedMember: PlatformMember | null = member(),
) => {
  const generate = vi.fn(async (): Promise<
    StaleOpportunityReadinessResponse
  > => selectedReport);
  const current = new StaleOpportunityHistoryGovernanceEvidenceService(
    config(),
    { resolveTenantById: vi.fn(async () => integration()) },
    { resolveMemberById: vi.fn(async () => selectedMember) },
    { generate },
  );
  return { current, generate };
};

describe('StaleOpportunityHistoryGovernanceEvidenceService', (): void => {
  it('registers the evidence service in the insight module', (): void => {
    const providers: unknown[] = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      StaleOpportunityReadinessModule,
    );

    expect(providers).toContain(
      StaleOpportunityHistoryGovernanceEvidenceService,
    );
  });

  it('marks a non-empty fully governed target complete', async (): Promise<void> => {
    const { current, generate } = service(report([item()]));

    await expect(current.inspect({ now: NOW })).resolves.toEqual({
      status: 'complete',
      checkedAt: NOW.toISOString(),
      summary: report([item()]).summary,
      pendingItems: [],
      warnings: [],
    });
    expect(generate).toHaveBeenCalledWith({
      integration: integration(),
      actorOpenId: OPEN_ID,
      now: NOW,
    });
  });

  it('returns exact pending items instead of trusting a manual flag', async (): Promise<void> => {
    const pending: StaleOpportunityReadinessItem = item([
      'status_unconfirmed',
      'followup_time_missing',
    ]);
    const { current } = service(report([pending]));

    await expect(current.inspect({ now: NOW })).resolves.toMatchObject({
      status: 'incomplete',
      pendingItems: [pending],
      warnings: ['stale_opportunity_history_governance_pending'],
      summary: {
        opportunityCount: 1,
        statusNeedsConfirmationCount: 1,
        followupTimeNeedsConfirmationCount: 1,
        readyForScanCount: 0,
      },
    });
  });

  it('fails closed for an empty governance scope', async (): Promise<void> => {
    const { current } = service(report([]));

    await expect(current.inspect({ now: NOW })).resolves.toMatchObject({
      status: 'incomplete',
      pendingItems: [],
      warnings: ['stale_opportunity_history_governance_scope_empty'],
    });
  });

  it('preserves an incomplete source as incomplete evidence', async (): Promise<void> => {
    const { current } = service(report([], 'incomplete'));

    await expect(current.inspect({ now: NOW })).resolves.toMatchObject({
      status: 'incomplete',
      warnings: [
        'source_incomplete',
        'stale_opportunity_history_governance_source_incomplete',
      ],
    });
  });

  it('does not read Base when the allowlisted identity mismatches', async (): Promise<void> => {
    const { current, generate } = service(report([item()]), member('ou_other'));

    await expect(current.inspect({ now: NOW })).resolves.toMatchObject({
      status: 'unavailable',
      warnings: ['stale_opportunity_history_governance_target_unavailable'],
    });
    expect(generate).not.toHaveBeenCalled();
  });
});
