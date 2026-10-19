import { Inject, Injectable } from '@nestjs/common';
import type { PlatformPermission } from '@shared/api.interface';
import { SALES_RECORDS_GATEWAY, type SalesRecordsGateway } from '@server/modules/agent-core/agent.ports';
import type { TenantIntegration } from '@server/modules/agent-core/agent.types';
import { PlatformSessionService } from '@server/modules/platform-shell/platform-session.service';
import { resolvePreparationCustomer, type PreparationCustomerCandidate } from './customer-preparation-customer';

interface PreparationAccessResult {
  status: 'matched' | 'ambiguous' | 'not_found' | 'unavailable';
  candidates: PreparationCustomerCandidate[];
  coverage: 'complete' | 'partial' | 'unavailable';
}

const READ_PERMISSIONS: PlatformPermission[] = [
  'customer:read', 'opportunity:read', 'followup:read', 'playbook:read',
];

@Injectable()
class CustomerPreparationAccessService {
  constructor(
    private readonly sessions: PlatformSessionService,
    @Inject(SALES_RECORDS_GATEWAY) private readonly records: SalesRecordsGateway,
  ) {}

  async resolve(
    integration: TenantIntegration,
    actorOpenId: string,
    customerName: string,
  ): Promise<PreparationAccessResult> {
    if (integration.status !== 'active' || !actorOpenId.trim()) throw new Error('ACCESS_DENIED');
    const member = await this.sessions.getActiveMember(integration.tenantId, actorOpenId);
    if (!member || member.status !== 'active' || member.tenantId !== integration.tenantId ||
      member.feishuOpenId !== actorOpenId) throw new Error('ACCESS_DENIED');
    const session = await this.sessions.getSessionByMembership(integration.tenantId, member.id);
    if (session.tenant.id !== integration.tenantId || session.member.id !== member.id ||
      session.member.feishuOpenId !== actorOpenId ||
      !READ_PERMISSIONS.every((permission: PlatformPermission): boolean =>
        session.permissions.includes(permission))) throw new Error('ACCESS_DENIED');
    // Validate before reading any customer content, even if the source is unavailable.
    resolvePreparationCustomer(customerName, []);
    if (!this.records.readOpportunityPortfolio) {
      return { status: 'unavailable', candidates: [], coverage: 'unavailable' };
    }
    try {
      const portfolio = await this.records.readOpportunityPortfolio(integration, actorOpenId);
      return { ...resolvePreparationCustomer(customerName, portfolio.customers),
        coverage: portfolio.warnings.length ? 'partial' : 'complete' };
    } catch {
      return { status: 'unavailable', candidates: [], coverage: 'unavailable' };
    }
  }
}

export { CustomerPreparationAccessService };
export type { PreparationAccessResult };
