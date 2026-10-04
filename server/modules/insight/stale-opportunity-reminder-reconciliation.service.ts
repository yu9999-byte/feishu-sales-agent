import type {
  StaleOpportunityReminderUncertainReader,
  StaleOpportunityReminderUncertainRecord,
} from './stale-opportunity-reminder.service';

interface StaleOpportunityReminderReconciliationInput {
  tenantId?: string;
  limit?: number;
}

interface StaleOpportunityReminderReconciliationResult {
  status: 'ready' | 'unavailable';
  items: StaleOpportunityReminderUncertainRecord[];
  warnings: string[];
}

const DEFAULT_LIMIT: number = 50;
const MAX_LIMIT: number = 100;

class StaleOpportunityReminderReconciliationService {
  constructor(
    private readonly reader: StaleOpportunityReminderUncertainReader,
  ) {}

  async listUncertain(
    input: StaleOpportunityReminderReconciliationInput = {},
  ): Promise<StaleOpportunityReminderReconciliationResult> {
    const limit: number = input.limit ?? DEFAULT_LIMIT;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_LIMIT
    ) {
      return {
        status: 'unavailable',
        items: [],
        warnings: ['reconciliation_limit_invalid'],
      };
    }
    if (input.tenantId !== undefined && !input.tenantId.trim()) {
      return {
        status: 'unavailable',
        items: [],
        warnings: ['reconciliation_tenant_invalid'],
      };
    }
    try {
      const items: StaleOpportunityReminderUncertainRecord[] =
        await this.reader.listUncertain({
          tenantId: input.tenantId,
          limit,
        });
      return { status: 'ready', items, warnings: [] };
    } catch (_error: unknown) {
      return {
        status: 'unavailable',
        items: [],
        warnings: ['reconciliation_source_unavailable'],
      };
    }
  }
}

export {
  StaleOpportunityReminderReconciliationService,
};
export type {
  StaleOpportunityReminderReconciliationInput,
  StaleOpportunityReminderReconciliationResult,
};
