import { describe, expect, it, vi } from 'vitest';

import type {
  PlatformSessionResponse,
  TeamReviewResponse,
} from '@shared/api.interface';
import type {
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import type {
  PlatformMember,
  ReportingRelation,
} from '@server/modules/identity-access/identity-access.types';
import {
  TeamReviewService,
  type DailyReportGenerator,
  type TeamReviewIdentityReader,
} from '@server/modules/insight/team-review.service';

const NOW: Date = new Date('2026-09-30T02:00:00.000Z');

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

const session = (roles: PlatformSessionResponse['roles']): PlatformSessionResponse => ({
  tenant: { id: 'tenant-a', name: 'Tenant A', timezone: 'Asia/Shanghai' },
  member: {
    id: 'member-manager',
    feishuOpenId: 'ou_manager',
    displayName: '主管',
  },
  roles,
  permissions: [],
  navigation: [],
  policyVersion: 'test',
});

const member = (
  id: string,
  openId: string,
  displayName: string,
  status: PlatformMember['status'] = 'active',
): PlatformMember => ({
  id,
  tenantId: 'tenant-a',
  feishuOpenId: openId,
  displayName,
  status,
});

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

const report = (
  actorOpenId: string,
  status: TeamReviewResponse['members'][number]['status'] = 'ready',
  overdueTaskCount = 0,
) => ({
  reportDate: '2026-09-30',
  timezone: 'Asia/Shanghai',
  status,
  generatedAt: NOW.toISOString(),
  metrics: {
    followupCount: actorOpenId === 'ou_manager' ? 1 : 2,
    opportunityCount: 1,
    openTaskCount: overdueTaskCount > 0 ? 2 : 1,
    overdueTaskCount,
  },
  followups: [],
  opportunities: [],
  tasks: [],
  highlights: ['有数据'],
  nextActions: actorOpenId === 'ou_no_action' ? [] : ['下一步'],
  warnings: status === 'unavailable'
    ? ['成员日报读取失败']
    : status === 'partial'
      ? ['来源不完整']
      : [],
});

const makeIdentity = (
  members: PlatformMember[],
  relations: ReportingRelation[],
): TeamReviewIdentityReader => ({
  listMembers: vi.fn(async () => members),
  listReportingRelations: vi.fn(async () => relations),
});

const makeReports = (): DailyReportGenerator => ({
  generate: vi.fn(async (input) => {
    if (input.actorOpenId === 'ou_unavailable') {
      return report(input.actorOpenId, 'unavailable');
    }
    if (input.actorOpenId === 'ou_overdue') {
      return report(input.actorOpenId, 'ready', 2);
    }
    return report(input.actorOpenId);
  }),
});

describe('TeamReviewService', (): void => {
  it('aggregates the manager and recursive reports without reading outside scope', async (): Promise<void> => {
    const members: PlatformMember[] = [
      member('member-manager', 'ou_manager', '主管'),
      member('member-a', 'ou_sales_a', '销售甲'),
      member('member-b', 'ou_sales_b', '销售乙'),
      member('member-outside', 'ou_outside', '其他团队'),
    ];
    const identity = makeIdentity(members, [
      relation('member-manager', 'member-a'),
      relation('member-a', 'member-b'),
      relation('member-outside', 'member-manager'),
    ]);
    const reports = makeReports();
    const result: TeamReviewResponse = await new TeamReviewService(
      identity,
      reports,
    ).generate({
      integration,
      session: session(['manager']),
      reportDate: '2026-09-30',
      timezone: 'Asia/Shanghai',
      now: NOW,
    });

    expect(result.status).toBe('ready');
    expect(result.metrics).toMatchObject({
      memberCount: 3,
      activeMemberCount: 3,
      followupCount: 5,
      opportunityCount: 3,
      openTaskCount: 3,
      overdueTaskCount: 0,
      attentionMemberCount: 0,
    });
    expect(result.members.map((item) => item.memberId)).toEqual([
      'member-manager',
      'member-a',
      'member-b',
    ]);
    expect(reports.generate).toHaveBeenCalledTimes(3);
    expect(result.warnings).toEqual([]);
  });

  it('lets executives review all active members and surfaces overdue risk', async (): Promise<void> => {
    const members: PlatformMember[] = [
      member('member-manager', 'ou_manager', '主管'),
      member('member-overdue', 'ou_overdue', '销售乙'),
      member('member-unavailable', 'ou_unavailable', '销售丙'),
      member('member-disabled', 'ou_disabled', '已离职', 'disabled'),
    ];
    const result: TeamReviewResponse = await new TeamReviewService(
      makeIdentity(members, []),
      makeReports(),
    ).generate({
      integration,
      session: session(['executive']),
      reportDate: '2026-09-30',
      timezone: 'Asia/Shanghai',
      now: NOW,
    });

    expect(result.status).toBe('partial');
    expect(result.metrics).toMatchObject({
      memberCount: 3,
      activeMemberCount: 2,
      overdueTaskCount: 2,
      attentionMemberCount: 2,
    });
    expect(result.attentions).toEqual(expect.arrayContaining([
      {
        memberId: 'member-overdue',
        displayName: '销售乙',
        severity: 'high',
        reasons: ['有 2 个未完成任务已逾期'],
      },
      {
        memberId: 'member-unavailable',
        displayName: '销售丙',
        severity: 'high',
        reasons: ['数据不完整，暂时无法形成可靠判断'],
      },
    ]));
    expect(result.warnings).toContain('销售丙：成员日报读取失败');
  });

  it('fails closed when the viewer is not an active team member', async (): Promise<void> => {
    const result: TeamReviewResponse = await new TeamReviewService(
      makeIdentity([member('member-other', 'ou_other', '其他')], []),
      makeReports(),
    ).generate({
      integration,
      session: session(['manager']),
      reportDate: '2026-09-30',
      timezone: 'Asia/Shanghai',
      now: NOW,
    });

    expect(result).toMatchObject({
      status: 'unavailable',
      members: [],
      warnings: ['当前主管成员不在有效团队范围内'],
    });
  });

  it('does not read team data for a sales-only viewer or disabled integration', async (): Promise<void> => {
    const identity: TeamReviewIdentityReader = makeIdentity([
      member('member-manager', 'ou_manager', '主管'),
    ], []);
    const reports: DailyReportGenerator = makeReports();
    const service = new TeamReviewService(identity, reports);

    const salesResult: TeamReviewResponse = await service.generate({
      integration,
      session: session(['sales']),
      reportDate: '2026-09-30',
      timezone: 'Asia/Shanghai',
      now: NOW,
    });
    const disabledResult: TeamReviewResponse = await service.generate({
      integration: { ...integration, status: 'disabled' },
      session: session(['manager']),
      reportDate: '2026-09-30',
      timezone: 'Asia/Shanghai',
      now: NOW,
    });

    expect(salesResult.warnings).toEqual(['当前成员没有团队 Review 权限']);
    expect(disabledResult.warnings).toEqual(['销售数据连接未启用']);
    expect(identity.listMembers).not.toHaveBeenCalled();
    expect(reports.generate).not.toHaveBeenCalled();
  });
});
