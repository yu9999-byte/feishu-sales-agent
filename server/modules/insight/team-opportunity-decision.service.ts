import { Inject, Injectable, Logger } from '@nestjs/common';

import type {
  OpportunityDecisionHealth,
  OpportunityDecisionResponse,
  PlatformSessionResponse,
  TeamOpportunityDecisionItem,
  TeamOpportunityDecisionMember,
  TeamOpportunityDecisionMetrics,
  TeamOpportunityDecisionResponse,
} from '@shared/api.interface';
import type { TenantIntegration } from
  '@server/modules/agent-core/agent.types';
import {
  IDENTITY_ACCESS_REPOSITORY,
} from '@server/modules/identity-access/identity-access.ports';
import type {
  PlatformMember,
  ReportingRelation,
} from '@server/modules/identity-access/identity-access.types';
import {
  OpportunityDecisionService,
  type OpportunityDecisionInput,
} from './opportunity-decision.service';
import {
  hasTeamReviewRole,
  resolveTeamReviewScope,
  type TeamReviewScope,
} from './team-review-scope';
import type { TeamReviewIdentityReader } from './team-review.service';

interface TeamOpportunityDecisionInput {
  integration: TenantIntegration;
  session: PlatformSessionResponse;
  referenceDate: string;
  timezone: string;
  now?: Date;
}

interface OpportunityDecisionAnalyzer {
  analyze(input: OpportunityDecisionInput): Promise<OpportunityDecisionResponse>;
}

interface MemberDecision {
  member: PlatformMember;
  report: OpportunityDecisionResponse;
}

const HEALTH_PRIORITY: Record<OpportunityDecisionHealth, number> = {
  critical: 4,
  at_risk: 3,
  needs_attention: 2,
  on_track: 1,
};

const memberFailure = (
  input: TeamOpportunityDecisionInput,
  now: Date,
): OpportunityDecisionResponse => ({
  referenceDate: input.referenceDate,
  timezone: input.timezone,
  status: 'unavailable',
  generatedAt: now.toISOString(),
  summary: {
    totalOpportunityCount: 0,
    activeOpportunityCount: 0,
    excludedClosedOpportunityCount: 0,
    criticalCount: 0,
    atRiskCount: 0,
    needsAttentionCount: 0,
    onTrackCount: 0,
  },
  customers: [],
  priorities: [],
  globalTaskAlerts: [],
  coverage: {
    scope: 'self',
    customers: 'unavailable',
    opportunities: 'unavailable',
    followups: 'unavailable',
    taskPromises: 'unavailable',
    taskAssociation: 'explicit_agent_confirmation_only',
  },
  warnings: ['成员商机决策读取失败'],
});

const knownAmount = (
  values: Array<number | null>,
): number | null => {
  const known: number[] = values.filter(
    (value: number | null): value is number => value !== null,
  );
  return known.length === 0
    ? null
    : known.reduce((sum: number, value: number): number => sum + value, 0);
};

@Injectable()
class TeamOpportunityDecisionService {
  private readonly logger: Logger = new Logger(
    TeamOpportunityDecisionService.name,
  );

  constructor(
    @Inject(IDENTITY_ACCESS_REPOSITORY)
    private readonly identity: TeamReviewIdentityReader,
    @Inject(OpportunityDecisionService)
    private readonly decisions: OpportunityDecisionAnalyzer,
  ) {}

  async generate(
    input: TeamOpportunityDecisionInput,
  ): Promise<TeamOpportunityDecisionResponse> {
    const now: Date = input.now ?? new Date();
    if (input.integration.status !== 'active') {
      return this.unavailable(input, now, ['销售数据连接未启用']);
    }
    if (!hasTeamReviewRole(input.session.roles)) {
      return this.unavailable(input, now, ['当前成员没有团队商机决策权限']);
    }

    let members: PlatformMember[];
    let relations: ReportingRelation[];
    try {
      [members, relations] = await Promise.all([
        this.identity.listMembers(input.integration.tenantId),
        this.identity.listReportingRelations(input.integration.tenantId),
      ]);
    } catch (error: unknown) {
      this.logger.warn(
        `Team opportunity scope read failed: ${error instanceof Error
          ? error.message
          : String(error)}`,
      );
      return this.unavailable(input, now, ['团队组织范围读取失败']);
    }
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
      relations: relations.filter(
        (relation: ReportingRelation): boolean =>
          relation.tenantId === input.integration.tenantId,
      ),
      now,
    }, activeMembers);
    const scopedMembers: PlatformMember[] = activeMembers.filter(
      (member: PlatformMember): boolean => scope.memberIds.has(member.id),
    );
    if (scopedMembers.length === 0) {
      return this.unavailable(input, now, [
        ...scope.warnings,
        '没有可读取的团队成员',
      ], scope.kind);
    }

    const memberDecisions: MemberDecision[] = [];
    const warnings: string[] = [...scope.warnings];
    for (const member of scopedMembers) {
      let report: OpportunityDecisionResponse;
      try {
        report = await this.decisions.analyze({
          integration: input.integration,
          actorOpenId: member.feishuOpenId,
          referenceDate: input.referenceDate,
          timezone: input.timezone,
          now,
        });
      } catch (error: unknown) {
        this.logger.warn(
          `Team opportunity member read failed: ${member.id}; ${
            error instanceof Error ? error.message : String(error)}`,
        );
        report = memberFailure(input, now);
      }
      memberDecisions.push({ member, report });
      warnings.push(...report.warnings.map(
        (warning: string): string => `${member.displayName}：${warning}`,
      ));
    }

    const priorities: TeamOpportunityDecisionItem[] = memberDecisions
      .flatMap(({ member, report }: MemberDecision) =>
        report.priorities.map((opportunity): TeamOpportunityDecisionItem => ({
          teamRank: 0,
          memberRank: opportunity.rank,
          ownerMemberId: member.id,
          ownerDisplayName: member.displayName,
          opportunity,
        })),
      )
      .sort(this.comparePriorities)
      .map((item: TeamOpportunityDecisionItem, index: number) => ({
        ...item,
        teamRank: index + 1,
      }));
    const membersSummary: TeamOpportunityDecisionMember[] = memberDecisions
      .map((decision: MemberDecision): TeamOpportunityDecisionMember =>
        this.memberSummary(decision, priorities)
      );
    const metrics: TeamOpportunityDecisionMetrics = this.metrics(
      membersSummary,
      priorities,
    );
    const status: TeamOpportunityDecisionResponse['status'] = this.status(
      membersSummary,
      priorities.length,
    );
    return {
      referenceDate: input.referenceDate,
      timezone: input.timezone,
      status,
      generatedAt: now.toISOString(),
      scope: scope.kind,
      metrics,
      priorities,
      members: membersSummary,
      managerActions: priorities
        .filter((item: TeamOpportunityDecisionItem): boolean =>
          item.opportunity.recommendation !== null
        )
        .slice(0, 5)
        .map((item: TeamOpportunityDecisionItem) => ({
          ownerMemberId: item.ownerMemberId,
          ownerDisplayName: item.ownerDisplayName,
          opportunityRecordId: item.opportunity.recordId,
          opportunityName: item.opportunity.name,
          action: item.opportunity.recommendation?.action ?? '',
          reason: item.opportunity.recommendation?.reason ?? '',
          requiresConfirmation: true,
        })),
      taskAlerts: memberDecisions.flatMap(
        ({ member, report }: MemberDecision) => report.globalTaskAlerts.map(
          (alert) => ({
            ...alert,
            ownerMemberId: member.id,
            ownerDisplayName: member.displayName,
          }),
        ),
      ),
      warnings: Array.from(new Set(warnings)),
    };
  }

  private readonly comparePriorities = (
    left: TeamOpportunityDecisionItem,
    right: TeamOpportunityDecisionItem,
  ): number => {
    const healthDifference: number =
      HEALTH_PRIORITY[right.opportunity.health] -
      HEALTH_PRIORITY[left.opportunity.health];
    if (healthDifference !== 0) return healthDifference;
    const scoreDifference: number =
      right.opportunity.priorityScore - left.opportunity.priorityScore;
    if (scoreDifference !== 0) return scoreDifference;
    const leftAmount: number = left.opportunity.expectedAmount ??
      Number.NEGATIVE_INFINITY;
    const rightAmount: number = right.opportunity.expectedAmount ??
      Number.NEGATIVE_INFINITY;
    if (rightAmount !== leftAmount) return rightAmount - leftAmount;
    const nameDifference: number = left.opportunity.name.localeCompare(
      right.opportunity.name,
      'zh-CN',
    );
    if (nameDifference !== 0) return nameDifference;
    return left.ownerDisplayName.localeCompare(right.ownerDisplayName, 'zh-CN');
  };

  private memberSummary(
    decision: MemberDecision,
    priorities: TeamOpportunityDecisionItem[],
  ): TeamOpportunityDecisionMember {
    const owned: TeamOpportunityDecisionItem[] = priorities.filter(
      (item: TeamOpportunityDecisionItem): boolean =>
        item.ownerMemberId === decision.member.id,
    );
    const top: TeamOpportunityDecisionItem | undefined = owned[0];
    return {
      memberId: decision.member.id,
      displayName: decision.member.displayName,
      status: decision.report.status,
      activeOpportunityCount: decision.report.summary.activeOpportunityCount,
      criticalCount: decision.report.summary.criticalCount,
      atRiskCount: decision.report.summary.atRiskCount,
      needsAttentionCount: decision.report.summary.needsAttentionCount,
      onTrackCount: decision.report.summary.onTrackCount,
      knownExpectedAmount: knownAmount(
        decision.report.priorities.map((item) => item.expectedAmount),
      ),
      topTeamRank: top?.teamRank ?? null,
      topOpportunityName: top?.opportunity.name ?? null,
      topRecommendation: top?.opportunity.recommendation?.action ?? null,
      warnings: decision.report.warnings,
    };
  }

  private metrics(
    members: TeamOpportunityDecisionMember[],
    priorities: TeamOpportunityDecisionItem[],
  ): TeamOpportunityDecisionMetrics {
    const count = (health: OpportunityDecisionHealth): number =>
      priorities.filter((item) => item.opportunity.health === health).length;
    return {
      memberCount: members.length,
      readableMemberCount: members.filter(
        (member: TeamOpportunityDecisionMember): boolean =>
          member.status !== 'unavailable',
      ).length,
      activeOpportunityCount: priorities.length,
      criticalCount: count('critical'),
      atRiskCount: count('at_risk'),
      needsAttentionCount: count('needs_attention'),
      onTrackCount: count('on_track'),
      knownExpectedAmount: knownAmount(
        priorities.map((item) => item.opportunity.expectedAmount),
      ),
    };
  }

  private status(
    members: TeamOpportunityDecisionMember[],
    priorityCount: number,
  ): TeamOpportunityDecisionResponse['status'] {
    const readableCount: number = members.filter(
      (member: TeamOpportunityDecisionMember): boolean =>
        member.status !== 'unavailable',
    ).length;
    if (readableCount === 0) return 'unavailable';
    if (members.some((member: TeamOpportunityDecisionMember): boolean =>
      member.status === 'unavailable' || member.status === 'partial'
    )) return 'partial';
    return priorityCount > 0 ? 'ready' : 'empty';
  }

  private unavailable(
    input: TeamOpportunityDecisionInput,
    now: Date,
    warnings: string[],
    scope: TeamOpportunityDecisionResponse['scope'] = 'team',
  ): TeamOpportunityDecisionResponse {
    return {
      referenceDate: input.referenceDate,
      timezone: input.timezone,
      status: 'unavailable',
      generatedAt: now.toISOString(),
      scope,
      metrics: {
        memberCount: 0,
        readableMemberCount: 0,
        activeOpportunityCount: 0,
        criticalCount: 0,
        atRiskCount: 0,
        needsAttentionCount: 0,
        onTrackCount: 0,
        knownExpectedAmount: null,
      },
      priorities: [],
      members: [],
      managerActions: [],
      taskAlerts: [],
      warnings,
    };
  }
}

export { TeamOpportunityDecisionService };
export type {
  OpportunityDecisionAnalyzer,
  TeamOpportunityDecisionInput,
};
