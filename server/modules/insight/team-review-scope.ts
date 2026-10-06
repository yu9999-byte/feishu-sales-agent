import type {
  PlatformRole,
} from '@shared/api.interface';
import type {
  PlatformMember,
  ReportingRelation,
} from '@server/modules/identity-access/identity-access.types';

interface TeamReviewScope {
  kind: 'team' | 'tenant';
  memberIds: Set<string>;
  warnings: string[];
}

interface TeamReviewScopeInput {
  viewerMemberId: string;
  roles: PlatformRole[];
  relations: ReportingRelation[];
  now: Date;
}

const hasTeamReviewRole = (roles: PlatformRole[]): boolean =>
  roles.some((role: PlatformRole): boolean =>
    role === 'manager' || role === 'executive' || role === 'admin'
  );

const isTenantScope = (roles: PlatformRole[]): boolean =>
  roles.includes('executive') || roles.includes('admin');

const collectManagerMemberIds = (
  viewerMemberId: string,
  relations: ReportingRelation[],
  now: Date,
): { memberIds: Set<string>; warnings: string[] } => {
  const activeRelations: ReportingRelation[] = relations.filter(
    (relation: ReportingRelation): boolean =>
      relation.validFrom.getTime() <= now.getTime() &&
      (relation.validTo === null || relation.validTo.getTime() > now.getTime()),
  );
  const memberIds: Set<string> = new Set<string>([viewerMemberId]);
  const visiting: Set<string> = new Set<string>();
  const visited: Set<string> = new Set<string>();
  let hasCycle: boolean = false;

  const visit = (managerMemberId: string): void => {
    if (visiting.has(managerMemberId)) {
      hasCycle = true;
      return;
    }
    if (visited.has(managerMemberId)) return;
    visiting.add(managerMemberId);
    activeRelations
      .filter(
        (relation: ReportingRelation): boolean =>
          relation.managerMemberId === managerMemberId,
      )
      .forEach((relation: ReportingRelation): void => {
        memberIds.add(relation.reportMemberId);
        visit(relation.reportMemberId);
      });
    visiting.delete(managerMemberId);
    visited.add(managerMemberId);
  };

  visit(viewerMemberId);
  return {
    memberIds,
    warnings: hasCycle ? ['组织汇报关系存在循环，已限制为可确认范围'] : [],
  };
};

const resolveTeamReviewScope = (
  input: TeamReviewScopeInput,
  activeMembers: PlatformMember[],
): TeamReviewScope => {
  if (isTenantScope(input.roles)) {
    return {
      kind: 'tenant',
      memberIds: new Set<string>(
        activeMembers.map((member: PlatformMember): string => member.id),
      ),
      warnings: [],
    };
  }
  const managerScope = collectManagerMemberIds(
    input.viewerMemberId,
    input.relations,
    input.now,
  );
  return {
    kind: 'team',
    ...managerScope,
  };
};

export {
  hasTeamReviewRole,
  resolveTeamReviewScope,
};
export type { TeamReviewScope, TeamReviewScopeInput };
