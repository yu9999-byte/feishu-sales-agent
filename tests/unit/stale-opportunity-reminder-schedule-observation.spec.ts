import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';

import type {
  StaleOpportunityReminderExecutionReadinessResponse,
} from '@shared/api.interface';
import type { AgentRuntimeConfig } from '@server/config/agent.config';
import type {
  AuditEventInput,
} from '@server/modules/agent-core/agent.types';
import {
  StaleOpportunityReadinessModule,
} from '@server/modules/insight/stale-opportunity-readiness.module';
import {
  StaleOpportunityReminderScheduleObservationService,
} from '@server/modules/insight/stale-opportunity-reminder-schedule-observation.service';

const NOW: Date = new Date('2026-10-06T02:00:00.000Z');
const TRACE_ID: string = 'schedule-observation-trace';
const TENANT_ID: string = '00000000-0000-4000-8000-00000000000a';

const runtimeConfig = (
  allowedTenantId: string | null = TENANT_ID,
): AgentRuntimeConfig => ({
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
  staleOpportunityScan: {
    enabled: true,
    triggerToken: 'scan-token',
  },
  staleOpportunityReminder: {
    enabled: false,
    historyGovernanceReady: false,
    senderConfigured: false,
    scheduleObservation: {
      triggerToken: 'schedule-observation-token',
    },
    execution: {
      enabled: false,
      triggerToken: 'execution-token',
      allowedTenantId: allowedTenantId ?? undefined,
      allowedMemberId: 'member-a',
      allowedRecipientOpenId: 'ou_sales_a',
    },
  },
});

const readinessResponse = (
  status: StaleOpportunityReminderExecutionReadinessResponse['status'] =
    'ready_for_manual_activation',
): StaleOpportunityReminderExecutionReadinessResponse => ({
  mode: 'read-only',
  status,
  checkedAt: NOW.toISOString(),
  configuration: {
    executionEnabled: false,
    reminderEnabled: false,
    scanEnabled: true,
    executionTokenConfigured: true,
    scanTokenConfigured: true,
    executionTokenDistinctFromScan: true,
    allowlistConfigured: true,
    historyGovernanceReady: false,
    senderConfigured: false,
  },
  target: {
    tenantId: TENANT_ID,
    tenantName: '不得进入调度响应的企业名称',
    tenantStatus: 'active',
    memberId: 'member-a',
    memberDisplayName: '不得进入调度响应的销售姓名',
    memberStatus: 'active',
    recipientOpenId: 'ou_sales_a',
    recipientOpenIdMatches: true,
    permissionGranted: true,
    dataSourceConfigured: true,
  },
  historyGovernance: {
    status: status === 'blocked' ? 'incomplete' : 'complete',
    checkedAt: NOW.toISOString(),
    summary: {
      opportunityCount: 5,
      statusConfirmedCount: 1,
      statusNeedsConfirmationCount: 4,
      followupTimeConfirmedCount: 0,
      followupTimeNeedsConfirmationCount: 5,
      readyForScanCount: 0,
    },
    pendingItems: [],
    warnings: [],
  },
  senderEvidence: {
    status: 'complete',
    checkedAt: NOW.toISOString(),
    credentialsStatus: 'valid',
    botStatus: 'enabled',
    botOpenIdPresent: true,
    sendPermissionStatus: 'granted',
    grantedSendScope: 'im:message:send_as_bot',
    recipientVisibility: {
      status: 'not_checked',
      inspectionPermissionGranted: false,
    },
    warnings: [],
  },
  ledger: {
    status: 'clear',
    uncertainDeliveryFound: false,
  },
  candidateProbe: {
    status: 'complete',
    traceId: 'candidate-probe-trace',
    candidateCount: 1,
    matchingCandidateCount: 1,
    items: [{
      tenantId: TENANT_ID,
      memberId: 'member-a',
      opportunityRecordId: 'opportunity-secret-id',
      opportunityName: '不得进入调度响应的商机名称',
      ownerOpenId: 'ou_sales_a',
      followupRecordId: 'followup-secret-id',
      lastEffectiveFollowupAt: '2026-09-20T02:00:00.000Z',
      followupVersion: 'followup-secret-version',
    }],
    warnings: [],
  },
  blockers: status === 'blocked'
    ? ['history_governance_incomplete']
    : [],
  warnings: status === 'blocked'
    ? ['stale_opportunity_history_governance_pending']
    : [],
});

const createService = (
  options: {
    config?: AgentRuntimeConfig;
    readiness?: StaleOpportunityReminderExecutionReadinessResponse;
    readinessFails?: boolean;
    auditFails?: boolean;
  } = {},
) => {
  const inspect = vi.fn(async (): Promise<
    StaleOpportunityReminderExecutionReadinessResponse
  > => {
    if (options.readinessFails) throw new Error('readiness unavailable');
    return options.readiness ?? readinessResponse();
  });
  const appendAudit = vi.fn(async (_event: AuditEventInput): Promise<void> => {
    if (options.auditFails) throw new Error('audit unavailable');
  });
  const service = new StaleOpportunityReminderScheduleObservationService(
    options.config ?? runtimeConfig(),
    { inspect },
    { appendAudit },
  );
  return { service, inspect, appendAudit };
};

describe(
  'StaleOpportunityReminderScheduleObservationService',
  (): void => {
    it('registers the read-only schedule observer', (): void => {
      const providers: unknown[] = Reflect.getMetadata(
        MODULE_METADATA.PROVIDERS,
        StaleOpportunityReadinessModule,
      );

      expect(providers).toEqual(expect.arrayContaining([
        StaleOpportunityReminderScheduleObservationService,
      ]));
    });

    it('records a redacted ready observation without returning business identifiers', async (): Promise<void> => {
      const current = createService();

      const result = await current.service.observe({
        now: NOW,
        traceId: TRACE_ID,
      });

      expect(result).toMatchObject({
        mode: 'read-only-observation',
        traceId: TRACE_ID,
        status: 'ready',
        observedAt: NOW.toISOString(),
        blockers: [],
        auditRecorded: true,
        summary: {
          executionReadinessStatus: 'ready_for_manual_activation',
          candidateCount: 1,
          matchingCandidateCount: 1,
        },
      });
      expect(current.inspect).toHaveBeenCalledWith({
        now: NOW,
        traceId: TRACE_ID,
      });
      expect(current.appendAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          traceId: TRACE_ID,
          eventType:
            'stale_opportunity_reminder.schedule_observed.v1',
          outcome: 'succeeded',
        }),
      );
      const serialized: string = JSON.stringify([
        result,
        current.appendAudit.mock.calls[0]?.[0],
      ]);
      expect(serialized).not.toContain('不得进入调度响应');
      expect(serialized).not.toContain('opportunity-secret-id');
      expect(serialized).not.toContain('followup-secret-id');
      expect(serialized).not.toContain('followup-secret-version');
      expect(serialized).not.toContain('ou_sales_a');
    });

    it('records a blocked readiness result as ignored', async (): Promise<void> => {
      const current = createService({
        readiness: readinessResponse('blocked'),
      });

      const result = await current.service.observe({
        now: NOW,
        traceId: TRACE_ID,
      });

      expect(result.status).toBe('blocked');
      expect(result.blockers).toEqual([
        'history_governance_incomplete',
      ]);
      expect(current.appendAudit).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'ignored' }),
      );
    });

    it('records a failed audit event when readiness inspection is unavailable', async (): Promise<void> => {
      const current = createService({ readinessFails: true });

      const result = await current.service.observe({
        now: NOW,
        traceId: TRACE_ID,
      });

      expect(result).toMatchObject({
        status: 'unavailable',
        auditRecorded: true,
        blockers: [],
        warnings: [
          'stale_opportunity_schedule_observation_readiness_unavailable',
        ],
      });
      expect(current.appendAudit).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'failed' }),
      );
    });

    it('marks an otherwise ready observation incomplete when audit persistence fails', async (): Promise<void> => {
      const current = createService({ auditFails: true });

      const result = await current.service.observe({
        now: NOW,
        traceId: TRACE_ID,
      });

      expect(result.status).toBe('incomplete');
      expect(result.auditRecorded).toBe(false);
      expect(result.warnings).toContain(
        'stale_opportunity_schedule_observation_audit_failed',
      );
    });

    it('does not invent an audit tenant when the exact target is missing', async (): Promise<void> => {
      const current = createService({
        config: runtimeConfig(null),
      });

      const result = await current.service.observe({
        now: NOW,
        traceId: TRACE_ID,
      });

      expect(result.status).toBe('incomplete');
      expect(result.auditRecorded).toBe(false);
      expect(result.warnings).toContain(
        'stale_opportunity_schedule_observation_audit_target_unavailable',
      );
      expect(current.appendAudit).not.toHaveBeenCalled();
    });
  },
);
