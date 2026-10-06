import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import type {
  StaleOpportunityReminderExecutionReadinessResponse,
  StaleOpportunityReminderScheduleObservationResponse,
  StaleOpportunityReminderScheduleObservationSummary,
} from '@shared/api.interface';
import {
  AGENT_CONFIG,
  type AgentRuntimeConfig,
} from '@server/config/agent.config';
import {
  CONTROL_STORE,
} from '@server/modules/agent-core/agent.ports';
import {
  redactErrorMessage,
  redactErrorStack,
} from '@server/modules/agent-core/agent.redaction';
import type {
  AuditEventInput,
} from '@server/modules/agent-core/agent.types';
import {
  StaleOpportunityReminderExecutionReadinessService,
} from './stale-opportunity-reminder-execution-readiness.service';

interface ScheduleObservationReadinessInspector {
  inspect(input?: { now?: Date; traceId?: string }): Promise<
    StaleOpportunityReminderExecutionReadinessResponse
  >;
}

interface ScheduleObservationAuditWriter {
  appendAudit(event: AuditEventInput): Promise<void>;
}

interface ScheduleObservationInput {
  now?: Date;
  traceId?: string;
}

const READINESS_UNAVAILABLE_WARNING: string =
  'stale_opportunity_schedule_observation_readiness_unavailable';
const AUDIT_TARGET_UNAVAILABLE_WARNING: string =
  'stale_opportunity_schedule_observation_audit_target_unavailable';
const AUDIT_FAILED_WARNING: string =
  'stale_opportunity_schedule_observation_audit_failed';

const unavailableSummary = (
): StaleOpportunityReminderScheduleObservationSummary => ({
  executionReadinessStatus: 'unavailable',
  blockerCount: 0,
  warningCount: 1,
  historyGovernanceStatus: 'not_checked',
  senderEvidenceStatus: 'not_checked',
  ledgerStatus: 'not_checked',
  candidateProbeStatus: 'not_checked',
  candidateCount: 0,
  matchingCandidateCount: 0,
});

@Injectable()
class StaleOpportunityReminderScheduleObservationService {
  private readonly logger: Logger = new Logger(
    StaleOpportunityReminderScheduleObservationService.name,
  );

  constructor(
    @Inject(AGENT_CONFIG)
    private readonly config: AgentRuntimeConfig,
    @Inject(StaleOpportunityReminderExecutionReadinessService)
    private readonly readiness: ScheduleObservationReadinessInspector,
    @Inject(CONTROL_STORE)
    private readonly audit: ScheduleObservationAuditWriter,
  ) {}

  async observe(
    input: ScheduleObservationInput = {},
  ): Promise<StaleOpportunityReminderScheduleObservationResponse> {
    const now: Date = input.now ?? new Date();
    const traceId: string = input.traceId ?? randomUUID();
    let readiness: StaleOpportunityReminderExecutionReadinessResponse;

    try {
      readiness = await this.readiness.inspect({ now, traceId });
    } catch (error: unknown) {
      return this.handleReadinessFailure(now, traceId, error);
    }

    const summary: StaleOpportunityReminderScheduleObservationSummary =
      this.summarize(readiness);
    const baseStatus: 'blocked' | 'ready' =
      readiness.status === 'ready_for_manual_activation'
        ? 'ready'
        : 'blocked';
    const auditRecorded: boolean = await this.appendAudit(
      traceId,
      baseStatus === 'ready' ? 'succeeded' : 'ignored',
      {
        observationStatus: baseStatus,
        readinessStatus: readiness.status,
        blockers: readiness.blockers,
        configuration: {
          executionEnabled: readiness.configuration.executionEnabled,
          reminderEnabled: readiness.configuration.reminderEnabled,
          scanEnabled: readiness.configuration.scanEnabled,
          executionTokenConfigured:
            readiness.configuration.executionTokenConfigured,
          scanTokenConfigured:
            readiness.configuration.scanTokenConfigured,
          executionTokenDistinctFromScan:
            readiness.configuration.executionTokenDistinctFromScan,
          allowlistConfigured:
            readiness.configuration.allowlistConfigured,
          historyGovernanceReady:
            readiness.configuration.historyGovernanceReady,
          senderConfigured: readiness.configuration.senderConfigured,
        },
        target: {
          tenantStatus: readiness.target.tenantStatus,
          memberStatus: readiness.target.memberStatus,
          recipientOpenIdMatches: readiness.target.recipientOpenIdMatches,
          permissionGranted: readiness.target.permissionGranted,
          dataSourceConfigured: readiness.target.dataSourceConfigured,
        },
        historyGovernance: {
          status: readiness.historyGovernance.status,
          summary: {
            opportunityCount:
              readiness.historyGovernance.summary.opportunityCount,
            statusConfirmedCount:
              readiness.historyGovernance.summary.statusConfirmedCount,
            statusNeedsConfirmationCount:
              readiness.historyGovernance.summary
                .statusNeedsConfirmationCount,
            followupTimeConfirmedCount:
              readiness.historyGovernance.summary
                .followupTimeConfirmedCount,
            followupTimeNeedsConfirmationCount:
              readiness.historyGovernance.summary
                .followupTimeNeedsConfirmationCount,
            readyForScanCount:
              readiness.historyGovernance.summary.readyForScanCount,
          },
        },
        senderEvidence: {
          status: readiness.senderEvidence.status,
          credentialsStatus: readiness.senderEvidence.credentialsStatus,
          botStatus: readiness.senderEvidence.botStatus,
          botOpenIdPresent: readiness.senderEvidence.botOpenIdPresent,
          sendPermissionStatus:
            readiness.senderEvidence.sendPermissionStatus,
          recipientVisibilityStatus:
            readiness.senderEvidence.recipientVisibility.status,
        },
        ledger: {
          status: readiness.ledger.status,
          uncertainDeliveryFound:
            readiness.ledger.uncertainDeliveryFound,
        },
        candidateProbe: {
          status: readiness.candidateProbe.status,
          candidateCount: readiness.candidateProbe.candidateCount,
          matchingCandidateCount:
            readiness.candidateProbe.matchingCandidateCount,
        },
        warningCount: readiness.warnings.length,
      },
    );
    const warnings: string[] = this.withAuditWarning(
      readiness.warnings,
      auditRecorded,
    );

    return {
      mode: 'read-only-observation',
      traceId,
      status: auditRecorded ? baseStatus : 'incomplete',
      observedAt: now.toISOString(),
      blockers: readiness.blockers,
      summary: {
        ...summary,
        warningCount: warnings.length,
      },
      auditRecorded,
      warnings,
    };
  }

  private summarize(
    readiness: StaleOpportunityReminderExecutionReadinessResponse,
  ): StaleOpportunityReminderScheduleObservationSummary {
    return {
      executionReadinessStatus: readiness.status,
      blockerCount: readiness.blockers.length,
      warningCount: readiness.warnings.length,
      historyGovernanceStatus: readiness.historyGovernance.status,
      senderEvidenceStatus: readiness.senderEvidence.status,
      ledgerStatus: readiness.ledger.status,
      candidateProbeStatus: readiness.candidateProbe.status,
      candidateCount: readiness.candidateProbe.candidateCount,
      matchingCandidateCount:
        readiness.candidateProbe.matchingCandidateCount,
    };
  }

  private async handleReadinessFailure(
    now: Date,
    traceId: string,
    error: unknown,
  ): Promise<StaleOpportunityReminderScheduleObservationResponse> {
    this.logFailure('Readiness inspection failed', traceId, error);
    const auditRecorded: boolean = await this.appendAudit(
      traceId,
      'failed',
      {
        observationStatus: 'unavailable',
        readinessStatus: 'unavailable',
        blockerCount: 0,
        warningCount: 1,
      },
    );
    const warnings: string[] = this.withAuditWarning(
      [READINESS_UNAVAILABLE_WARNING],
      auditRecorded,
    );

    return {
      mode: 'read-only-observation',
      traceId,
      status: 'unavailable',
      observedAt: now.toISOString(),
      blockers: [],
      summary: {
        ...unavailableSummary(),
        warningCount: warnings.length,
      },
      auditRecorded,
      warnings,
    };
  }

  private async appendAudit(
    traceId: string,
    outcome: AuditEventInput['outcome'],
    details: AuditEventInput['details'],
  ): Promise<boolean> {
    const tenantId: string | undefined =
      this.config.staleOpportunityReminder?.execution?.allowedTenantId
        ?.trim();
    if (!tenantId) return false;

    try {
      await this.audit.appendAudit({
        tenantId,
        traceId,
        eventType: 'stale_opportunity_reminder.schedule_observed.v1',
        outcome,
        details,
      });
      return true;
    } catch (error: unknown) {
      this.logFailure('Schedule observation audit failed', traceId, error);
      return false;
    }
  }

  private withAuditWarning(
    warnings: string[],
    auditRecorded: boolean,
  ): string[] {
    const result: string[] = [...warnings];
    if (!auditRecorded) {
      const tenantId: string | undefined =
        this.config.staleOpportunityReminder?.execution?.allowedTenantId
          ?.trim();
      result.push(
        tenantId ? AUDIT_FAILED_WARNING : AUDIT_TARGET_UNAVAILABLE_WARNING,
      );
    }
    return Array.from(new Set<string>(result)).sort();
  }

  private logFailure(
    message: string,
    traceId: string,
    error: unknown,
  ): void {
    const normalized: Error = error instanceof Error
      ? error
      : new Error('Unknown schedule observation failure');
    this.logger.error(
      `${message} for trace ${traceId}: ${redactErrorMessage(normalized)}`,
      redactErrorStack(normalized),
    );
  }
}

export { StaleOpportunityReminderScheduleObservationService };
export type {
  ScheduleObservationAuditWriter,
  ScheduleObservationInput,
  ScheduleObservationReadinessInspector,
};
