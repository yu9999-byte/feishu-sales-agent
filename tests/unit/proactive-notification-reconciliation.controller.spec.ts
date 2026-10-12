import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';

import type { Request } from 'express';
import type {
  ProactiveNotificationReconciliationListResponse,
  ProactiveNotificationReconciliationResponse,
} from '@shared/api.interface';
import {
  ProactiveNotificationReconciliationController,
} from '@server/modules/insight/proactive-notification-reconciliation.controller';
import {
  ProactiveNotificationReconciliationError,
} from '@server/modules/insight/proactive-notification-reconciliation.service';
import { ProactiveSalesNotificationModule } from
  '@server/modules/insight/proactive-sales-notification.module';
import { PlatformAccessDeniedError } from
  '@server/modules/platform-shell/platform-session.service';

const TENANT_ID: string = '10000000-0000-4000-8000-000000000031';
const MEMBER_ID: string = '20000000-0000-4000-8000-000000000031';
const NOTIFICATION_ID: string = '30000000-0000-4000-8000-000000000031';
const UPDATED_AT: string = '2026-10-12T10:05:00.000Z';

const request = (): Request => ({
  headers: { cookie: 'sales-agent-session=session-token' },
} as never);

const authenticatedSession = {
  tenantId: TENANT_ID,
  member: {
    id: MEMBER_ID,
    tenantId: TENANT_ID,
    feishuOpenId: 'ou_admin',
    displayName: '通知运营管理员',
    status: 'active' as const,
  },
  tokenHash: 'session-hash',
};

const listResponse: ProactiveNotificationReconciliationListResponse = {
  status: 'ready',
  items: [],
  warnings: [],
};

const reconcileResponse: ProactiveNotificationReconciliationResponse = {
  reconciliationId: '40000000-0000-4000-8000-000000000031',
  notificationId: NOTIFICATION_ID,
  decision: 'keep_frozen',
  previousStatus: 'uncertain',
  currentStatus: 'uncertain',
  updatedAt: '2026-10-13T01:00:00.000Z',
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
  const controller = new ProactiveNotificationReconciliationController(
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

describe('ProactiveNotificationReconciliationController', (): void => {
  it('registers the controller in the proactive notification module', (): void => {
    const controllers: unknown = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      ProactiveSalesNotificationModule,
    );
    expect(controllers).toEqual(expect.arrayContaining([
      ProactiveNotificationReconciliationController,
    ]));
  });

  it('requires a trusted Feishu web session before reading', async (): Promise<void> => {
    const { controller, authenticateSession, listUncertain } =
      makeController();

    await expect(controller.list({ headers: {} } as never))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(authenticateSession).not.toHaveBeenCalled();
    expect(listUncertain).not.toHaveBeenCalled();
  });

  it('requires the admin policy permission', async (): Promise<void> => {
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

  it('injects tenant scope when listing uncertain notifications', async (): Promise<void> => {
    const { controller, listUncertain } = makeController();

    await expect(controller.list(request(), '25')).resolves
      .toEqual(listResponse);
    expect(listUncertain).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      limit: 25,
    });
  });

  it('injects tenant and operator identity when reconciling', async (): Promise<void> => {
    const { controller, reconcile } = makeController();

    await expect(controller.reconcile(request(), NOTIFICATION_ID, {
      tenantId: 'attacker-tenant',
      operatorMemberId: 'attacker-member',
      expectedUpdatedAt: UPDATED_AT,
      decision: 'keep_frozen',
      note: '证据仍不足，继续冻结等待核查',
    })).resolves.toEqual(reconcileResponse);
    expect(reconcile).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      operatorMemberId: MEMBER_ID,
      notificationId: NOTIFICATION_ID,
      expectedUpdatedAt: UPDATED_AT,
      decision: 'keep_frozen',
      note: '证据仍不足，继续冻结等待核查',
      messageId: undefined,
      sentAt: undefined,
    });
  });

  it('maps optimistic concurrency conflicts to HTTP 409', async (): Promise<void> => {
    const reconcile = vi.fn(async (): Promise<never> => {
      throw new ProactiveNotificationReconciliationError(
        'CONFLICT',
        '通知记录已变化，请刷新后重新核对',
        'sent',
        '2026-10-13T01:00:00.000Z',
      );
    });
    const { controller } = makeController({ reconcile });

    await expect(controller.reconcile(request(), NOTIFICATION_ID, {
      expectedUpdatedAt: UPDATED_AT,
      decision: 'authorize_retry',
      note: '确认未送达，仅释放一次重试',
    })).rejects.toBeInstanceOf(ConflictException);
  });
});
