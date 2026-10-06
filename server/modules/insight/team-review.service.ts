import { Inject, Injectable, Logger } from '@nestjs/common';

import type {
  DailySalesReportResponse,
  DailySalesReportStatus,
  PlatformSessionResponse,
  TeamReviewAttention,
  TeamReviewMemberSummary,
  TeamReviewResponse,
} from '@shared/api.interface';
import {
  IDENTITY_ACCESS_REPOSITORY,
} from '@server/modules/identity-access/identity-access.ports';
import type {
  PlatformMember,
  ReportingRelation,
} from '@server/modules/identity-access/identity-access.types';
import type { TenantIntegration } from '@server/modules/agent-core/agent.types';
import {
  DailySalesReportService,
  type DailySalesReportInput,
} from './daily-sales-report.service';
import {
  hasTeamReviewRole,
  resolveTeamReviewScope,
  type TeamReviewScope,
} from './team-review-scope';

interface TeamReviewInput {
  integration: TenantIntegration;
  session: PlatformSessionResponse;
  reportDate: string;
  timezone: string;
  now?: Date;
}

interface TeamReviewIdentityReader {
  listMembers(tenantId: string): Promise<PlatformMember[]>;
  listReportingRelations(tenantId: string): Promise<ReportingRelation[]>;
}

interface DailyReportGenerator {
  generate(input: DailySalesReportInput): Promise<DailySalesReportResponse>;
}

const HIGH_ATTENTION_REASON = '数据不完整，暂时无法形成可靠判断';

const emptyReport = (
  reportDate: string,
  timezone: string,
  now: Date,
  warning: string,
): DailySalesReportResponse => ({
  reportDate,
  timezone,
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
  warnings: [warning],
});

const buildAttention = (
  member: PlatformMember,
  report: DailySalesReportResponse,
): TeamReviewAttention | null => {
  const reasons: string[] = [];
  let severity: TeamReviewAttention['severity'] = 'medium';
  if (report.status === 'unavailable' || report.status === 'partial') {
    reasons.push(HIGH_ATTENTION_REASON);
    severity = 'high';
  }
  if (report.metrics.overdueTaskCount > 0) {
    reasons.push(
      `有 ${report.metrics.overdueTaskCount} 个未完成任务已逾期`,
    );
    severity = 'high';
  }
  if (
    report.status !== 'unavailable' &&
    report.metrics.followupCount === 0
  ) {
    reasons.push('当天没有登记跟进');
  }
  if (
    report.metrics.followupCount > 0 &&
    report.nextActions.length === 0
  ) {
    reasons.push('跟进没有形成明确下一步');
  }
  if (reasons.length === 0) return null;
  return {
    memberId: member.id,
    displayName: member.displayName,
    severity,
    reasons,
  };
};

const mapMemberSummary = (
  member: PlatformMember,
  report: DailySalesReportResponse,
): TeamReviewMemberSummary => ({
  memberId: member.id,
  displayName: member.displayName,
  status: report.status,
  metrics: report.metrics,
  highlights: report.highlights,
  nextActions: report.nextActions,
  warnings: report.warnings,
});

@Injectable()
class TeamReviewService {
  private readonly logger: Logger = new Logger(TeamReviewService.name);

  constructor(
    @Inject(IDENTITY_ACCESS_REPOSITORY)
    private readonly identity: TeamReviewIdentityReader,
    @Inject(DailySalesReportService)
    private readonly dailyReports: DailyReportGenerator,
  ) {}

  async generate(input: TeamReviewInput): Promise<TeamReviewResponse> {
    const now: Date = input.now ?? new Date();
    if (input.integration.status !== 'active') {
      return this.unavailable(input, now, ['销售数据连接未启用']);
    }
    if (!hasTeamReviewRole(input.session.roles)) {
      return this.unavailable(input, now, ['当前成员没有团队 Review 权限']);
    }
    const members: PlatformMember[] = await this.identity.listMembers(
      input.integration.tenantId,
    );
    const relations: ReportingRelation[] = await this.identity
      .listReportingRelations(input.integration.tenantId);
    const activeMembers: PlatformMember[] = members.filter(
      (member: PlatformMember): boolean =>
        member.tenantId === input.integration.tenantId &&
        member.status === 'active',
    );
    const viewerExists: boolean = activeMembers.some(
      (member: PlatformMember): boolean =>
        member.id === input.session.member.id &&
        member.feishuOpenId === input.session.member.feishuOpenId,
    );
    if (!viewerExists) {
      return this.unavailable(
        input,
        now,
        ['当前主管成员不在有效团队范围内'],
      );
    }

    const scope: TeamReviewScope = resolveTeamReviewScope({
      viewerMemberId: input.session.member.id,
      roles: input.session.roles,
      relations,
      now,
    }, activeMembers);
    const scopedMembers: PlatformMember[] = activeMembers.filter(
      (member: PlatformMember): boolean => scope.memberIds.has(member.id),
    );
    if (scopedMembers.length === 0) {
      return this.unavailable(input, now, [
        ...scope.warnings,
        '没有可读取的团队成员',
      ]);
    }

    const summaries: TeamReviewMemberSummary[] = [];
    const attentions: TeamReviewAttention[] = [];
    const warnings: string[] = [...scope.warnings];
    for (const member of scopedMembers) {
      const reportInput: DailySalesReportInput = {
        integration: input.integration,
        actorOpenId: member.feishuOpenId,
        reportDate: input.reportDate,
        timezone: input.timezone,
        now,
      };
      let report: DailySalesReportResponse;
      try {
        report = await this.dailyReports.generate(reportInput);
      } catch (error: unknown) {
        this.logger.warn(
          `Team review member read failed: ${member.id}; ${error instanceof Error
            ? error.message
            : String(error)}`,
        );
        report = emptyReport(
          input.reportDate,
          input.timezone,
          now,
          '成员日报读取失败',
        );
      }
      summaries.push(mapMemberSummary(member, report));
      warnings.push(
        ...report.warnings.map(
          (warning: string): string => `${member.displayName}：${warning}`,
        ),
      );
      const attention: TeamReviewAttention | null = buildAttention(
        member,
        report,
      );
      if (attention !== null) attentions.push(attention);
    }

    attentions.sort((left, right): number => {
      if (left.severity !== right.severity) {
        return left.severity === 'high' ? -1 : 1;
      }
      return left.displayName.localeCompare(right.displayName, 'zh-CN');
    });
    const metrics = this.metrics(summaries, attentions);
    const status: TeamReviewResponse['status'] = this.status(
      summaries,
      metrics.activeMemberCount,
    );
    return {
      reviewDate: input.reportDate,
      timezone: input.timezone,
      status,
      generatedAt: now.toISOString(),
      metrics,
      members: summaries,
      attentions,
      highlights: this.highlights(metrics),
      managerActions: attentions.slice(0, 5).map(
        (attention: TeamReviewAttention): string =>
          `优先与 ${attention.displayName} 核对：${attention.reasons[0] ?? '需要关注'}`,
      ),
      warnings,
    };
  }

  private metrics(
    members: TeamReviewMemberSummary[],
    attentions: TeamReviewAttention[],
  ): TeamReviewResponse['metrics'] {
    return {
      memberCount: members.length,
      activeMemberCount: members.filter(
        (member: TeamReviewMemberSummary): boolean =>
          member.status === 'ready' || member.status === 'partial',
      ).length,
      followupCount: members.reduce(
        (total: number, member: TeamReviewMemberSummary): number =>
          total + member.metrics.followupCount,
        0,
      ),
      opportunityCount: members.reduce(
        (total: number, member: TeamReviewMemberSummary): number =>
          total + member.metrics.opportunityCount,
        0,
      ),
      openTaskCount: members.reduce(
        (total: number, member: TeamReviewMemberSummary): number =>
          total + member.metrics.openTaskCount,
        0,
      ),
      overdueTaskCount: members.reduce(
        (total: number, member: TeamReviewMemberSummary): number =>
          total + member.metrics.overdueTaskCount,
        0,
      ),
      attentionMemberCount: attentions.length,
    };
  }

  private status(
    members: TeamReviewMemberSummary[],
    activeMemberCount: number,
  ): TeamReviewResponse['status'] {
    const hasUnavailable: boolean = members.some(
      (member: TeamReviewMemberSummary): boolean =>
        member.status === 'unavailable',
    );
    const hasPartial: boolean = members.some(
      (member: TeamReviewMemberSummary): boolean =>
        member.status === 'partial',
    );
    if (hasUnavailable && activeMemberCount === 0) return 'unavailable';
    if (hasUnavailable || hasPartial) return 'partial';
    return activeMemberCount > 0 ? 'ready' : 'empty';
  }

  private highlights(
    metrics: TeamReviewResponse['metrics'],
  ): string[] {
    const highlights: string[] = [
      `团队范围内共 ${metrics.memberCount} 名成员`,
      `其中 ${metrics.activeMemberCount} 名成员有当天数据`,
    ];
    if (metrics.overdueTaskCount > 0) {
      highlights.push(`团队有 ${metrics.overdueTaskCount} 个逾期未完成任务`);
    }
    if (metrics.attentionMemberCount > 0) {
      highlights.push(`有 ${metrics.attentionMemberCount} 名成员需要主管关注`);
    }
    return highlights;
  }

  private unavailable(
    input: TeamReviewInput,
    now: Date,
    warnings: string[],
  ): TeamReviewResponse {
    return {
      reviewDate: input.reportDate,
      timezone: input.timezone,
      status: 'unavailable',
      generatedAt: now.toISOString(),
      metrics: {
        memberCount: 0,
        activeMemberCount: 0,
        followupCount: 0,
        opportunityCount: 0,
        openTaskCount: 0,
        overdueTaskCount: 0,
        attentionMemberCount: 0,
      },
      members: [],
      attentions: [],
      highlights: [],
      managerActions: [],
      warnings,
    };
  }
}

export { TeamReviewService };
export type {
  DailyReportGenerator,
  TeamReviewIdentityReader,
  TeamReviewInput,
};
