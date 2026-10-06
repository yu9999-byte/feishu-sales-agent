import { describe, expect, it, vi } from 'vitest';

import type {
  OpportunityDecisionHealth,
  OpportunityDecisionItem,
  OpportunityDecisionResponse,
  PlatformSessionResponse,
  TeamOpportunityDecisionResponse,
} from '@shared/api.interface';
import type { TenantIntegration } from
  '@server/modules/agent-core/agent.types';
import type {
  PlatformMember,
  ReportingRelation,
} from '@server/modules/identity-access/identity-access.types';
import {
  TeamOpportunityDecisionService,
  type OpportunityDecisionAnalyzer,
} from '@server/modules/insight/team-opportunity-decision.service';
import type { TeamReviewIdentityReader } from
  '@server/modules/insight/team-review.service';

const NOW = new Date('2026-10-07T04:00:00.000Z');

const integration: TenantIntegration = {
  tenantId: 'tenant-a',
  feishuTenantKey: 'tenant-key-a',
  name: 'Tenant A',
  status: 'active',
  appId: 'app-a',
  appSecretEnv: 'APP_SECRET_A',
  appType: 'selfBuild',
  base: {
    appToken: 'base-a',
    customers: {
      tableId: 'customers',
      primaryField: '客户',
      fields: { customerName: '客户' },
    },
    opportunities: {
      tableId: 'opportunities',
      primaryField: '商机',
      fields: { opportunityName: '商机', customerLink: '客户关联' },
    },
    followups: {
      tableId: 'followups',
      primaryField: '跟进',
      fields: {
        sourceMessageId: '消息',
        customerLink: '客户关联',
        opportunityLink: '商机关联',
        rawText: '原文',
        summary: '摘要',
      },
    },
  },
};

const session = (
  roles: PlatformSessionResponse['roles'],
): PlatformSessionResponse => ({
  tenant: { id: 'tenant-a', name: 'Tenant A', timezone: 'Asia/Shanghai' },
  member: {
    id: 'manager',
    feishuOpenId: 'ou_manager',
    displayName: '主管',
  },
  roles,
  permissions: ['review:read-team', 'opportunity:read'],
  navigation: [],
  policyVersion: 'test',
});

const member = (
  id: string,
  openId: string,
  displayName: string,
  tenantId = 'tenant-a',
  status: PlatformMember['status'] = 'active',
): PlatformMember => ({ id, tenantId, feishuOpenId: openId, displayName, status });

const relation = (
  managerMemberId: string,
  reportMemberId: string,
): ReportingRelation => ({
  tenantId: 'tenant-a',
  managerMemberId,
  reportMemberId,
  validFrom: new Date('2026-01-01T00:00:00.000Z'),
  validTo: null,
});

const opportunity = (
  name: string,
  health: OpportunityDecisionHealth,
  priorityScore: number,
  expectedAmount: number | null,
  rank = 1,
): OpportunityDecisionItem => ({
  rank,
  recordId: `opp-${name}`,
  recordUrl: null,
  name,
  customerRecordId: null,
  customerName: null,
  lifecycleStatus: 'active',
  expectedAmount,
  progress: '方案沟通',
  lastFollowupAt: '2026-10-01T00:00:00.000Z',
  lastFollowupSummary: '完成需求确认',
  nextAction: '确认决策人',
  dueAt: '2026-10-08',
  health,
  priorityScore,
  risks: health === 'on_track' ? [] : [{
    code: 'followup_stale',
    severity: health === 'critical' ? 'high' : 'medium',
    title: '跟进停滞',
    detail: '超过约定时间没有新进展',
    evidenceIds: ['ev-1'],
  }],
  gaps: [],
  recommendation: {
    action: `推进${name}`,
    reason: '需要解除当前风险',
    dueAt: '2026-10-08',
    evidenceIds: ['ev-1'],
    requiresConfirmation: true,
  },
  taskPromises: [],
  evidence: [],
});

const report = (
  priorities: OpportunityDecisionItem[],
  status: OpportunityDecisionResponse['status'] = 'ready',
  warnings: string[] = [],
): OpportunityDecisionResponse => ({
  referenceDate: '2026-10-07',
  timezone: 'Asia/Shanghai',
  status,
  generatedAt: NOW.toISOString(),
  summary: {
    totalOpportunityCount: priorities.length,
    activeOpportunityCount: priorities.length,
    excludedClosedOpportunityCount: 0,
    criticalCount: priorities.filter((item) => item.health === 'critical').length,
    atRiskCount: priorities.filter((item) => item.health === 'at_risk').length,
    needsAttentionCount: priorities.filter(
      (item) => item.health === 'needs_attention',
    ).length,
    onTrackCount: priorities.filter((item) => item.health === 'on_track').length,
  },
  customers: [],
  priorities,
  globalTaskAlerts: [],
  coverage: {
    scope: 'self',
    customers: 'complete',
    opportunities: 'complete',
    followups: 'complete',
    taskPromises: 'agent_confirmed_only',
    taskAssociation: 'explicit_agent_confirmation_only',
  },
  warnings,
});

const identity = (
  members: PlatformMember[],
  relations: ReportingRelation[],
): TeamReviewIdentityReader => ({
  listMembers: vi.fn(async () => members),
  listReportingRelations: vi.fn(async () => relations),
});

const analyzer = (
  reports: Record<string, OpportunityDecisionResponse | Error>,
): OpportunityDecisionAnalyzer => ({
  analyze: vi.fn(async (input) => {
    const value = reports[input.actorOpenId] ?? report([]);
    if (value instanceof Error) throw value;
    return value;
  }),
});

const generate = async (
  members: PlatformMember[],
  relations: ReportingRelation[],
  reports: Record<string, OpportunityDecisionResponse | Error>,
  roles: PlatformSessionResponse['roles'] = ['manager'],
): Promise<{
  result: TeamOpportunityDecisionResponse;
  decisions: OpportunityDecisionAnalyzer;
}> => {
  const decisions = analyzer(reports);
  const result = await new TeamOpportunityDecisionService(
    identity(members, relations),
    decisions,
  ).generate({
    integration,
    session: session(roles),
    referenceDate: '2026-10-07',
    timezone: 'Asia/Shanghai',
    now: NOW,
  });
  return { result, decisions };
};

describe('TeamOpportunityDecisionService', (): void => {
  it('reads only the manager and recursive reports, then ranks team opportunities', async (): Promise<void> => {
    const { result, decisions } = await generate([
      member('manager', 'ou_manager', '主管'),
      member('sales-a', 'ou_a', '销售甲'),
      member('sales-b', 'ou_b', '销售乙'),
      member('outside', 'ou_outside', '其他团队'),
    ], [
      relation('manager', 'sales-a'),
      relation('sales-a', 'sales-b'),
    ], {
      ou_manager: report([opportunity('主管商机', 'on_track', 10, 5000)]),
      ou_a: report([opportunity('甲方商机', 'at_risk', 50, 10000)]),
      ou_b: report([opportunity('乙方商机', 'critical', 40, null)]),
      ou_outside: report([opportunity('越权商机', 'critical', 99, 999999)]),
    });

    expect(result.status).toBe('ready');
    expect(result.scope).toBe('team');
    expect(result.priorities.map((item) => [
      item.teamRank,
      item.ownerDisplayName,
      item.opportunity.name,
    ])).toEqual([
      [1, '销售乙', '乙方商机'],
      [2, '销售甲', '甲方商机'],
      [3, '主管', '主管商机'],
    ]);
    expect(decisions.analyze).toHaveBeenCalledTimes(3);
    expect(decisions.analyze).not.toHaveBeenCalledWith(
      expect.objectContaining({ actorOpenId: 'ou_outside' }),
    );
  });

  it('lets executive and admin roles read all active tenant members only', async (): Promise<void> => {
    const { result, decisions } = await generate([
      member('manager', 'ou_manager', '主管'),
      member('sales-a', 'ou_a', '销售甲'),
      member('disabled', 'ou_disabled', '离职销售', 'tenant-a', 'disabled'),
      member('other-tenant', 'ou_other', '其他租户', 'tenant-b'),
    ], [], {
      ou_manager: report([]),
      ou_a: report([opportunity('甲方商机', 'on_track', 1, 100)]),
    }, ['executive']);

    expect(result.scope).toBe('tenant');
    expect(result.metrics.memberCount).toBe(2);
    expect(decisions.analyze).toHaveBeenCalledTimes(2);
  });

  it('keeps readable members when one member fails and marks the result partial', async (): Promise<void> => {
    const { result } = await generate([
      member('manager', 'ou_manager', '主管'),
      member('sales-a', 'ou_a', '销售甲'),
    ], [relation('manager', 'sales-a')], {
      ou_manager: report([opportunity('主管商机', 'on_track', 1, null)]),
      ou_a: new Error('source down'),
    });

    expect(result.status).toBe('partial');
    expect(result.metrics.readableMemberCount).toBe(1);
    expect(result.priorities).toHaveLength(1);
    expect(result.members.find((item) => item.memberId === 'sales-a')).toMatchObject({
      status: 'unavailable',
      warnings: ['成员商机决策读取失败'],
    });
    expect(result.warnings).toContain('销售甲：成员商机决策读取失败');
  });

  it('is unavailable when every scoped member is unreadable', async (): Promise<void> => {
    const { result } = await generate([
      member('manager', 'ou_manager', '主管'),
    ], [], { ou_manager: new Error('source down') });

    expect(result.status).toBe('unavailable');
    expect(result.metrics.readableMemberCount).toBe(0);
    expect(result.priorities).toEqual([]);
  });

  it('preserves unknown amount as null and returns empty for readable members without active opportunities', async (): Promise<void> => {
    const unknown = await generate([
      member('manager', 'ou_manager', '主管'),
    ], [], {
      ou_manager: report([opportunity('未知金额', 'needs_attention', 3, null)]),
    });
    const empty = await generate([
      member('manager', 'ou_manager', '主管'),
    ], [], { ou_manager: report([], 'empty') });

    expect(unknown.result.metrics.knownExpectedAmount).toBeNull();
    expect(unknown.result.members[0].knownExpectedAmount).toBeNull();
    expect(empty.result.status).toBe('empty');
  });

  it('builds suggested manager actions from real recommendations without executing them', async (): Promise<void> => {
    const { result } = await generate([
      member('manager', 'ou_manager', '主管'),
    ], [], {
      ou_manager: report([opportunity('北辰项目', 'critical', 80, 300000)]),
    });

    expect(result.managerActions).toEqual([expect.objectContaining({
      ownerDisplayName: '主管',
      opportunityName: '北辰项目',
      action: '推进北辰项目',
      reason: '需要解除当前风险',
      requiresConfirmation: true,
    })]);
  });

  it('fails closed for sales-only, inactive integration, and an invalid viewer', async (): Promise<void> => {
    const members = [member('other', 'ou_other', '其他成员')];
    const identityReader = identity(members, []);
    const decisions = analyzer({});
    const service = new TeamOpportunityDecisionService(identityReader, decisions);
    const salesOnly = await service.generate({
      integration,
      session: session(['sales']),
      referenceDate: '2026-10-07',
      timezone: 'Asia/Shanghai',
      now: NOW,
    });
    const disabled = await service.generate({
      integration: { ...integration, status: 'disabled' },
      session: session(['manager']),
      referenceDate: '2026-10-07',
      timezone: 'Asia/Shanghai',
      now: NOW,
    });
    const invalidViewer = await service.generate({
      integration,
      session: session(['manager']),
      referenceDate: '2026-10-07',
      timezone: 'Asia/Shanghai',
      now: NOW,
    });

    expect(salesOnly.warnings).toEqual(['当前成员没有团队商机决策权限']);
    expect(disabled.warnings).toEqual(['销售数据连接未启用']);
    expect(invalidViewer.warnings).toEqual(['当前主管成员不在有效团队范围内']);
    expect(decisions.analyze).not.toHaveBeenCalled();
  });
});
