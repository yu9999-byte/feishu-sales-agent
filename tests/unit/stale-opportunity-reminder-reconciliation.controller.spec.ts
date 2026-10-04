import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';

import type { Request } from 'express';
import type {
  StaleOpportunityReminderReconciliationListResponse,
  StaleOpportunityReminderReconciliationResponse,
} from '@shared/api.interface';
import {
  StaleOpportunityReminderReconciliationController,
} from '@server/modules/insight/stale-opportunity-reminder-reconciliation.controller';
import {
  StaleOpportunityReminderReconciliationError,
} from '@server/modules/insight/stale-opportunity-reminder-reconciliation.service';
import {
  StaleOpportunityReadinessModule,
} from '@server/modules/insight/stale-opportunity-readiness.module';
import { PlatformAccessDeniedError } from
  '@server/modules/platform-shell/platform-session.service';

const TENANT_ID: string = '10000000-0000-4000-8000-00000000000a';
const MEMBER_ID: string = '20000000-0000-4000-8000-00000000000a';
const EXPECTED_UPDATED_AT: string = '2026-09-29T02:00:00.000Z';

const request = (): Request => ({
  headers: { cookie: 'sales-agent-session=session-token' },
} as never);

const authenticatedSession = {
  tenantId: TENANT_ID,
  member: {
    id: MEMBER_ID,
    tenantId: TENANT_ID,
    feishuOpenId: 'ou_admin',
    displayName: '提醒运营管理员',
    status: 'active' as const,
  },
  tokenHash: 'session-hash',
};

const listResponse: StaleOpportunityReminderReconciliationListResponse = {
  status: 'ready',
  items: [],
  warnings: [],
};

const reconcileResponse: StaleOpportunityReminderReconciliationResponse = {
  reconciliationId: '30000000-0000-4000-8000-00000000000a',
  opportunityRecordId: 'opportunity-1',
  followupVersion: 'followup-version-1',
  reminderKind: 'stale_followup',
  decision: 'keep_frozen',
  previousStatus: 'uncertain',
  currentStatus: 'uncertain',
  updatedAt: '2026-09-29T03:00:00.000Z',
};

const makeController = (overrides: {
  authenticateSession?: ReturnType<typeof vi.fn>;
  assertPermission?: ReturnType<typeof vi.fn>;
  listUncertain?: ReturnType<typeof vi.fn>;
  reconcile?: ReturnType<typeof vi.fn>;
} = {}) => {
  const authenticateSession = overrides.authenticateSession ??
    vi.fn(async () => authenticatedSession);
  const assertPermission = overrides.assertPermission ??
    vi.fn(async (): Promise<void> => undefined);
  const listUncertain = overrides.listUncertain ??
    vi.fn(async () => listResponse);
  const reconcile = overrides.reconcile ??
    vi.fn(async () => reconcileResponse);
  const controller = new StaleOpportunityReminderReconciliationController(
    { authenticateSession } as never,
    { assertPermission } as never,
    { listUncertain, reconcile } as never,
  );
  return {
    controller,
    authenticateSession,
    assertPermission,
    listUncertain,
    reconcile,
  };
};

describe('StaleOpportunityReminderReconciliationController', (): void => {
  it('registers the reconciliation controller in the insight module', (): void => {
    const controllers: unknown = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      StaleOpportunityReadinessModule,
    );

    expect(controllers).toEqual(expect.arrayContaining([
      StaleOpportunityReminderReconciliationController,
    ]));
  });

  it('requires the trusted Feishu web session before reading', async (): Promise<void> => {
    const { controller, authenticateSession, listUncertain } =
      makeController();

    await expect(controller.list({ headers: {} } as never))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(authenticateSession).not.toHaveBeenCalled();
    expect(listUncertain).not.toHaveBeenCalled();
  });

  it('requires the platform admin policy permission', async (): Promise<void> => {
    const assertPermission = vi.fn(async (): Promise<void> => {
      throw new PlatformAccessDeniedError();
    });
    const { controller, listUncertain } = makeController({
      assertPermission,
    });

    await expect(controller.list(request()))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(assertPermission).toHaveBeenCalledWith(
      authenticatedSession,
      'admin:manage-policies',
    );
    expect(listUncertain).not.toHaveBeenCalled();
  });

  it('always lists uncertain reminders inside the session tenant', async (): Promise<void> => {
    const { controller, listUncertain } = makeController();

    await expect(controller.list(request(), '25')).resolves
      .toEqual(listResponse);
    expect(listUncertain).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      limit: 25,
    });
  });

  it('injects tenant and operator identity from the session', async (): Promise<void> => {
    const { controller, reconcile } = makeController();

    await expect(controller.reconcile(
      request(),
      'opportunity-1',
      {
        tenantId: 'attacker-tenant',
        operatorMemberId: 'attacker-member',
        followupVersion: 'followup-version-1',
        reminderKind: 'stale_followup',
        expectedUpdatedAt: EXPECTED_UPDATED_AT,
        decision: 'keep_frozen',
        note: '证据仍不足，继续冻结等待核查',
      },
    )).resolves.toEqual(reconcileResponse);
    expect(reconcile).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      operatorMemberId: MEMBER_ID,
      opportunityRecordId: 'opportunity-1',
      followupVersion: 'followup-version-1',
      reminderKind: 'stale_followup',
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      decision: 'keep_frozen',
      note: '证据仍不足，继续冻结等待核查',
      messageId: undefined,
      sentAt: undefined,
    });
  });

  it('maps optimistic concurrency conflicts to HTTP 409', async (): Promise<void> => {
    const reconcile = vi.fn(async (): Promise<never> => {
      throw new StaleOpportunityReminderReconciliationError(
        'CONFLICT',
        '提醒记录已变化，请刷新后重新核对',
        'sent',
        '2026-09-29T03:00:00.000Z',
      );
    });
    const { controller } = makeController({ reconcile });

    await expect(controller.reconcile(request(), 'opportunity-1', {
      followupVersion: 'followup-version-1',
      reminderKind: 'stale_followup',
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      decision: 'authorize_retry',
      note: '确认没有发送，允许重新尝试',
    })).rejects.toBeInstanceOf(ConflictException);
  });
});
