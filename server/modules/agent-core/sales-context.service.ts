import { Inject, Injectable } from '@nestjs/common';

import type {
  SalesContext,
  SalesContextConflict,
} from '@shared/api.interface';
import { FeishuApiError } from '@server/modules/feishu/feishu-api.error';
import type {
  SalesRecordsGateway,
  TaskGateway,
} from './agent.ports';
import {
  SALES_RECORDS_GATEWAY,
  TASK_GATEWAY,
} from './agent.ports';
import type {
  SalesContextHints,
  SalesContextBaseResult,
  SalesContextTaskResult,
  TenantIntegration,
} from './agent.types';

@Injectable()
export class SalesContextService {
  constructor(
    @Inject(SALES_RECORDS_GATEWAY)
    private readonly records: SalesRecordsGateway,
    @Inject(TASK_GATEWAY)
    private readonly tasks: TaskGateway,
  ) {}

  async read(
    integration: TenantIntegration,
    actorOpenId: string,
    hints: SalesContextHints,
    now: Date = new Date(),
  ): Promise<SalesContext> {
    const readAt: string = now.toISOString();
    const empty: SalesContext = {
      status: 'unavailable',
      customer: null,
      customerCandidates: [],
      opportunities: [],
      recentFollowups: [],
      conflicts: [],
      tasks: [],
      warnings: [],
      readAt,
    };
    if (!hints.customerName || !this.records.readSalesContext) {
      return {
        ...empty,
        status: 'partial',
        warnings: ['business_context_not_configured'],
      };
    }

    try {
      const base = await this.records.readSalesContext(
        integration,
        actorOpenId,
        hints,
      );
      const customers = base.customers.map((item) => ({
        name: item.name,
        contactName: item.contactName,
        latestSummary: item.latestSummary,
        lastFollowupAt: item.lastFollowupAt,
        source: {
          recordId: item.recordId,
          recordUrl: item.recordUrl,
          sourceVersion: item.sourceVersion,
        },
      }));
      if (customers.length > 1) {
        return {
          ...empty,
          status: 'needs_clarification',
          customerCandidates: customers,
          opportunities: base.opportunities.map((item) => ({
            name: item.name,
            progress: item.progress,
            expectedAmount: item.expectedAmount,
            nextAction: item.nextAction,
            dueAt: item.dueAt,
            source: {
              recordId: item.recordId,
              recordUrl: item.recordUrl,
              sourceVersion: item.sourceVersion,
            },
          })),
          recentFollowups: this.mapFollowups(base.followups),
          warnings: [...base.warnings, 'customer_match_ambiguous'],
        };
      }

      const customer = customers[0] ?? null;
      if (!customer) {
        return {
          ...empty,
          status: 'partial',
          warnings: [...base.warnings, 'customer_not_found'],
        };
      }

      const opportunities = base.opportunities.map((item) => ({
        name: item.name,
        progress: item.progress,
        expectedAmount: item.expectedAmount,
        nextAction: item.nextAction,
        dueAt: item.dueAt,
        source: {
          recordId: item.recordId,
          recordUrl: item.recordUrl,
          sourceVersion: item.sourceVersion,
        },
      }));
      const recentFollowups = this.mapFollowups(base.followups);
      if (opportunities.length > 1) {
        return {
          ...empty,
          status: 'needs_clarification',
          customer,
          customerCandidates: [],
          opportunities,
          recentFollowups,
          warnings: [...base.warnings, 'opportunity_match_ambiguous'],
        };
      }

      const conflicts: SalesContextConflict[] = this.findConflicts(
        opportunities,
        recentFollowups,
      );

      let taskResult: SalesContextTaskResult = {
        items: [],
        warning: 'task_context_not_configured',
      };
      if (this.tasks.searchOwnedTasks) {
        try {
          taskResult = await this.tasks.searchOwnedTasks(
            integration,
            actorOpenId,
            customer.name,
          );
        } catch {
          taskResult = { items: [], warning: 'task_context_unavailable' };
        }
      }
      const warnings: string[] = [...base.warnings];
      if (taskResult.warning) warnings.push(taskResult.warning);
      if (conflicts.length > 0) {
        warnings.push('sales_context_source_conflict');
      }

      return {
        status: warnings.length > 0 ? 'partial' : 'ready',
        customer,
        customerCandidates: [],
        opportunities,
        recentFollowups,
        conflicts,
        tasks: taskResult.items,
        warnings,
        readAt,
      };
    } catch (error: unknown) {
      return {
        ...empty,
        warnings: [
          error instanceof FeishuApiError && error.code === '91403'
            ? 'business_context_permission_denied'
            : 'business_context_unavailable',
        ],
      };
    }
  }

  private mapFollowups(
    followups: SalesContextBaseResult['followups'],
  ): SalesContext['recentFollowups'] {
    return followups.map((item) => ({
      summary: item.summary,
      opportunityRecordId: item.opportunityRecordId,
      nextAction: item.nextAction,
      dueAt: item.dueAt,
      source: {
        recordId: item.recordId,
        recordUrl: item.recordUrl,
        sourceVersion: item.sourceVersion,
      },
    }));
  }

  private findConflicts(
    opportunities: SalesContext['opportunities'],
    followups: SalesContext['recentFollowups'],
  ): SalesContextConflict[] {
    const conflicts: SalesContextConflict[] = [];
    for (const opportunity of opportunities) {
      const followup = followups.find(
        (item) =>
          item.opportunityRecordId === opportunity.source.recordId,
      );
      if (!followup) continue;

      for (const field of ['nextAction', 'dueAt'] as const) {
        const opportunityValue: string | null = opportunity[field];
        const followupValue: string | null = followup[field];
        if (
          opportunityValue === null ||
          followupValue === null ||
          !this.valuesConflict(field, opportunityValue, followupValue)
        ) {
          continue;
        }

        conflicts.push({
          field,
          opportunityValue,
          followupValue,
          opportunitySource: opportunity.source,
          followupSource: followup.source,
          newerSource: this.compareVersions(
            opportunity.source.sourceVersion,
            followup.source.sourceVersion,
          ),
        });
      }
    }
    return conflicts;
  }

  private valuesConflict(
    field: 'nextAction' | 'dueAt',
    left: string,
    right: string,
  ): boolean {
    if (field === 'dueAt') {
      const leftTime: number = Date.parse(left);
      const rightTime: number = Date.parse(right);
      if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) {
        return leftTime !== rightTime;
      }
    }
    return this.normalizeValue(left) !== this.normalizeValue(right);
  }

  private normalizeValue(value: string): string {
    return value
      .normalize('NFKC')
      .trim()
      .replace(/\s+/gu, ' ')
      .toLocaleLowerCase();
  }

  private compareVersions(
    opportunityVersion: string | null,
    followupVersion: string | null,
  ): SalesContextConflict['newerSource'] {
    if (!opportunityVersion || !followupVersion) return 'unknown';
    const opportunityTime: number = Date.parse(opportunityVersion);
    const followupTime: number = Date.parse(followupVersion);
    if (Number.isNaN(opportunityTime) || Number.isNaN(followupTime)) {
      return 'unknown';
    }
    if (opportunityTime === followupTime) return 'same';
    return opportunityTime > followupTime ? 'opportunity' : 'followup';
  }
}
