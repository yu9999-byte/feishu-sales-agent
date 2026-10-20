import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

import type {
  CustomerCommunicationPreparationResponse,
  CustomerPreparationResultSnapshot,
  PlatformSessionResponse,
} from '@shared/api.interface';
import type { ControlStore } from
  '@server/modules/agent-core/agent.ports';
import type { TenantIntegration } from
  '@server/modules/agent-core/agent.types';
import { CustomerCommunicationPreparationController } from
  '@server/modules/insight/customer-communication-preparation.controller';
import type { CustomerCommunicationPreparationService } from
  '@server/modules/insight/customer-communication-preparation.service';
import type { CustomerPreparationAccessService } from
  '@server/modules/insight/customer-preparation-access.service';
import {
  PlatformAccessDeniedError,
  type PlatformSessionService,
} from '@server/modules/platform-shell/platform-session.service';
import type { PlatformShellService } from
  '@server/modules/platform-shell/platform-shell.service';
import type { FeishuWebAuthService } from
  '@server/modules/web-auth/feishu-web-auth.service';

const TENANT_ID = '00000000-0000-4000-8000-00000000000a';
const MEMBER_ID = '00000000-0000-4000-8000-00000000000b';
const OPEN_ID = 'ou_sales_a';

const integration: TenantIntegration = {
  tenantId: TENANT_ID,
  feishuTenantKey: 'tenant-key-a',
  name: 'Tenant A',
  status: 'active',
  appId: 'app-a',
  appSecretEnv: 'APP_SECRET_A',
  appType: 'selfBuild',
  base: {
    appToken: 'base-a',
    customers: {
      tableId: 'customers',
      primaryField: '客户',
      fields: { customerName: '客户' },
    },
    opportunities: {
      tableId: 'opportunities',
      primaryField: '商机',
      fields: { opportunityName: '商机', customerLink: '客户关联' },
    },
    followups: {
      tableId: 'followups',
      primaryField: '跟进',
      fields: {
        sourceMessageId: '消息',
        customerLink: '客户关联',
        opportunityLink: '商机关联',
        rawText: '原文',
        summary: '摘要',
      },
    },
  },
};

const platformSession: PlatformSessionResponse = {
  tenant: { id: TENANT_ID, name: 'Tenant A', timezone: 'Asia/Shanghai' },
  member: {
    id: MEMBER_ID,
    feishuOpenId: OPEN_ID,
    displayName: '销售 A',
  },
  roles: ['sales'],
  permissions: [
    'customer:read',
    'opportunity:read',
    'followup:read',
    'playbook:read',
  ],
  navigation: [],
  policyVersion: 'test',
};

const response: CustomerCommunicationPreparationResponse = {
  referenceDate: '2026-10-07',
  timezone: 'Asia/Shanghai',
  status: 'empty',
  generatedAt: '2026-10-07T05:00:00.000Z',
  customer: null,
  objective: null,
  angles: [],
  questions: [],
  materials: [],
  materialSearch: {
    status: 'no_trusted_match',
    configuredSourceCount: 0,
    checkedSourceCount: 0,
    trustedResultCount: 0,
    warnings: ['客户信息不足，未检索资料'],
  },
  drafts: [],
  evidence: [],
  coverage: {
    scope: 'self',
    customers: 'complete',
    opportunities: 'complete',
    followups: 'complete',
    taskPromises: 'agent_confirmed_only',
    associations: 'explicit_record_links_only',
  },
  warnings: [],
};

interface Harness {
  controller: CustomerCommunicationPreparationController;
  shell: { assertPermission: ReturnType<typeof vi.fn> };
  sessions: { getSessionByMembership: ReturnType<typeof vi.fn> };
  preparations: { generate: ReturnType<typeof vi.fn> };
  store: {
    resolveTenantById: ReturnType<typeof vi.fn>;
    getPreparationResult: ReturnType<typeof vi.fn>;
    getPreparationDelivery: ReturnType<typeof vi.fn>;
    confirmPreparationDelivery: ReturnType<typeof vi.fn>;
    savePreparationDraft: ReturnType<typeof vi.fn>;
  };
  access: { resolve: ReturnType<typeof vi.fn> };
}

const setup = (): Harness => {
  const auth = {
    authenticateSession: vi.fn(async () => ({
      tenantId: TENANT_ID,
      member: {
        id: MEMBER_ID,
        tenantId: TENANT_ID,
        feishuOpenId: OPEN_ID,
        displayName: '销售 A',
        status: 'active',
      },
      tokenHash: 'hash',
    })),
  };
  const shell = {
    assertPermission: vi.fn(async (): Promise<void> => undefined),
  };
  const sessions = {
    getSessionByMembership: vi.fn(
      async (): Promise<PlatformSessionResponse> => platformSession,
    ),
  };
  const preparations = {
    generate: vi.fn(
      async (): Promise<CustomerCommunicationPreparationResponse> => response,
    ),
  };
  const store = {
    getPreparationResult: vi.fn(),
    getPreparationDelivery: vi.fn(),
    confirmPreparationDelivery: vi.fn(),
    savePreparationDraft: vi.fn(),
    resolveTenantById: vi.fn(
      async (): Promise<TenantIntegration | null> => integration,
    ),
  };
  const access = { resolve: vi.fn() };
  return {
    controller: new CustomerCommunicationPreparationController(
      auth as unknown as FeishuWebAuthService,
      shell as unknown as PlatformShellService,
      sessions as unknown as PlatformSessionService,
      preparations as unknown as CustomerCommunicationPreparationService,
      store as unknown as ControlStore,
      access as unknown as CustomerPreparationAccessService,
    ),
    shell,
    sessions,
    preparations,
    store,
    access,
  };
};

const request = (withCookie: boolean = true): Request => ({
  headers: {
    cookie: withCookie ? 'sales-agent-session=session-secret' : undefined,
  },
}) as Request;

describe('CustomerCommunicationPreparationController', (): void => {
  const editableSnapshot: CustomerPreparationResultSnapshot = {
    id: 'result', revision: 1, createdAt: response.generatedAt,
    request: { customerName: '客户甲', communicationAt: null, purpose: null },
    report: { ...response, customer: {
      recordId: 'customer-a', name: '客户甲', contactName: null,
      latestSummary: null, lastFollowupAt: null,
      source: { recordId: 'customer-a', recordUrl: null, sourceVersion: null },
    }, drafts: [{ channel: 'email', subject: '原主题', body: '原正文', title: '邮件',
      editable: true, execution: 'preview_only', sourceKeys: [] }] },
  };
  const edit = { channel: 'email', subject: '新主题', body: '新正文', expectedRevision: 1 };

  it.each(['pending', 'dispatching', 'sent', 'unknown', 'not_recorded'])('reads only authorized delivery status %s', async (status) => {
    const harness = setup();
    harness.store.getPreparationResult.mockResolvedValue(editableSnapshot);
    harness.access.resolve.mockResolvedValue({ status: 'matched', candidates: [{ recordId: 'customer-a' }] });
    harness.store.getPreparationDelivery.mockResolvedValue(status === 'not_recorded' ? null : { status });
    await expect(harness.controller.getPreparationDelivery(request(), 'result')).resolves.toEqual({ status });
    expect(harness.store.getPreparationDelivery).toHaveBeenCalledWith({ tenantId: TENANT_ID, actorOpenId: OPEN_ID, resultId: 'result' });
    expect(harness.preparations.generate).not.toHaveBeenCalled();
  });

  it.each(['logged_out', 'permission', 'revoked', 'unavailable', 'missing'])('blocks delivery reads when %s', async (mode) => {
    const harness = setup();
    harness.store.getPreparationResult.mockResolvedValue(mode === 'missing' ? null : editableSnapshot);
    if (mode === 'permission') harness.shell.assertPermission.mockRejectedValue(new PlatformAccessDeniedError());
    harness.access.resolve.mockResolvedValue({ status: mode === 'unavailable' ? 'unavailable' : 'not_found', candidates: [] });
    await expect(harness.controller.getPreparationDelivery(request(mode !== 'logged_out'), 'result')).rejects.toBeInstanceOf(
      mode === 'logged_out' ? UnauthorizedException : mode === 'permission' ? ForbiddenException : mode === 'unavailable' ? ServiceUnavailableException : NotFoundException);
    expect(harness.store.getPreparationDelivery).not.toHaveBeenCalled();
  });

  it('confirms verified delivery with current version and customer access', async () => {
    const harness = setup();
    const updatedAt = '2026-10-19T01:00:00.000Z';
    harness.store.getPreparationResult.mockResolvedValue(editableSnapshot);
    harness.access.resolve.mockResolvedValue({ status: 'matched', candidates: [{ recordId: 'customer-a' }] });
    harness.store.confirmPreparationDelivery.mockResolvedValue(true);
    harness.store.getPreparationDelivery.mockResolvedValue({ status: 'sent', updatedAt, reconciliationVersion: 2 });
    const response = await harness.controller.confirmPreparationDelivery(request(), 'result', {
      expectedVersion: 1, messageId: 'om_verified', sentAt: '2026-10-19T00:55:00Z', note: '已核对飞书会话消息记录',
    });
    expect(response).toEqual({ status: 'sent', updatedAt });
    expect(harness.store.confirmPreparationDelivery).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT_ID, actorOpenId: OPEN_ID, operatorOpenId: OPEN_ID, resultId: 'result',
      expectedVersion: 1, messageId: 'om_verified',
    }));
  });

  it.each([
    { expectedVersion: 0 },
    { messageId: '', note: '有效核查说明' },
    { messageId: 'om_verified', note: '短' },
    { messageId: 'om_verified', note: '有效核查说明', sentAt: 'tomorrow' },
    { messageId: 'om_verified', note: '有效核查说明', extra: true },
  ])('rejects malformed delivery evidence %j', async (override) => {
    const harness = setup();
    harness.store.getPreparationResult.mockResolvedValue(editableSnapshot);
    harness.access.resolve.mockResolvedValue({ status: 'matched', candidates: [{ recordId: 'customer-a' }] });
    await expect(harness.controller.confirmPreparationDelivery(request(), 'result', {
      expectedVersion: 1, sentAt: '2026-10-19T00:55:00Z',
      messageId: 'om_verified', note: '已核对飞书会话消息记录', ...override,
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.store.confirmPreparationDelivery).not.toHaveBeenCalled();
  });

  it('rejects delivery evidence dated in the future before writing', async () => {
    const harness = setup();
    harness.store.getPreparationResult.mockResolvedValue(editableSnapshot);
    harness.access.resolve.mockResolvedValue({ status: 'matched', candidates: [{ recordId: 'customer-a' }] });
    await expect(harness.controller.confirmPreparationDelivery(request(), 'result', {
      expectedVersion: 1, sentAt: '2099-10-19T00:55:00Z',
      messageId: 'om_verified', note: '已核对飞书会话消息记录',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.store.confirmPreparationDelivery).not.toHaveBeenCalled();
  });

  it('rejects stale evidence versions without altering the delivery ledger', async () => {
    const harness = setup();
    harness.store.getPreparationResult.mockResolvedValue(editableSnapshot);
    harness.access.resolve.mockResolvedValue({ status: 'matched', candidates: [{ recordId: 'customer-a' }] });
    harness.store.confirmPreparationDelivery.mockResolvedValue(false);
    await expect(harness.controller.confirmPreparationDelivery(request(), 'result', {
      expectedVersion: 1, sentAt: '2026-10-19T00:55:00Z',
      messageId: 'om_verified', note: '已核对飞书会话消息记录',
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it.each(['saved', 'conflict', 'invalid', 'missing_channel'])('handles draft save %s with authenticated scope', async (mode) => {
    const harness = setup();
    harness.store.getPreparationResult.mockResolvedValueOnce(editableSnapshot);
    harness.access.resolve.mockResolvedValueOnce({ status: 'matched', candidates: [{ recordId: 'customer-a', name: '客户甲' }], coverage: 'complete' });
    const saved = { ...editableSnapshot, revision: 2 };
    harness.store.savePreparationDraft.mockResolvedValueOnce(mode === 'conflict' ? null : saved);
    const input = mode === 'invalid' ? { ...edit, tenantId: 'other' } :
      mode === 'missing_channel' ? { ...edit, channel: 'feishu', subject: null } : edit;
    const result = harness.controller.savePreparationDraft(request(), 'result', input);
    if (mode === 'saved') await expect(result).resolves.toBe(saved);
    else await expect(result).rejects.toBeInstanceOf(mode === 'conflict' ? ConflictException : BadRequestException);
    if (mode === 'invalid' || mode === 'missing_channel') expect(harness.store.savePreparationDraft).not.toHaveBeenCalled();
    else expect(harness.store.savePreparationDraft).toHaveBeenCalledWith({ tenantId: TENANT_ID, actorOpenId: OPEN_ID, id: 'result', edit });
    expect(harness.preparations.generate).not.toHaveBeenCalled();
  });

  it.each(['logged_out', 'permission', 'revoked', 'unavailable', 'missing'])(
    'refuses draft writes when access is %s', async (mode) => {
      const harness = setup();
      harness.store.getPreparationResult.mockResolvedValueOnce(mode === 'missing' ? null : editableSnapshot);
      if (mode === 'permission') harness.shell.assertPermission.mockRejectedValueOnce(new PlatformAccessDeniedError());
      harness.access.resolve.mockResolvedValueOnce({ status: mode === 'unavailable' ? 'unavailable' : 'not_found', candidates: [], coverage: 'complete' });
      await expect(harness.controller.savePreparationDraft(request(mode !== 'logged_out'), 'result', edit))
        .rejects.toBeInstanceOf(mode === 'logged_out' ? UnauthorizedException :
          mode === 'permission' ? ForbiddenException : mode === 'unavailable' ? ServiceUnavailableException : NotFoundException);
      expect(harness.store.savePreparationDraft).not.toHaveBeenCalled();
    },
  );

  it.each(['matched', 'revoked', 'unavailable', 'denied'])(
    'revalidates current customer access for a saved result: %s', async (mode) => {
      const harness = setup();
      const snapshot: CustomerPreparationResultSnapshot = {
        id: 'result', revision: 1, createdAt: response.generatedAt,
        request: { customerName: '客户甲', communicationAt: null, purpose: null },
        report: { ...response, customer: {
          recordId: 'customer-a', name: '客户甲', contactName: null,
          latestSummary: null, lastFollowupAt: null,
          source: { recordId: 'customer-a', recordUrl: null, sourceVersion: null },
        } },
      };
      harness.store.getPreparationResult.mockResolvedValueOnce(snapshot);
      if (mode === 'denied') harness.access.resolve.mockRejectedValueOnce(new Error('denied'));
      else harness.access.resolve.mockResolvedValueOnce({
        status: mode === 'unavailable' ? 'unavailable' : mode === 'revoked' ? 'not_found' : 'matched',
        candidates: mode === 'matched' ? [{ recordId: 'customer-a', name: '客户甲' }] : [],
        coverage: 'complete',
      });
      const result = harness.controller.getPreparationResult(request(), 'result');
      if (mode === 'matched') await expect(result).resolves.toBe(snapshot);
      else await expect(result).rejects.toBeInstanceOf(
        mode === 'unavailable' ? ServiceUnavailableException :
          mode === 'denied' ? ForbiddenException : NotFoundException,
      );
      expect(harness.access.resolve).toHaveBeenCalledWith(integration, OPEN_ID, '客户甲');
      expect(harness.preparations.generate).not.toHaveBeenCalled();
    },
  );

  it('rejects saved-result reads before storage when login or permission is missing', async () => {
    const harness = setup();
    await expect(harness.controller.getPreparationResult(request(false), 'result'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    harness.shell.assertPermission.mockRejectedValueOnce(new PlatformAccessDeniedError());
    await expect(harness.controller.getPreparationResult(request(), 'result'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(harness.store.getPreparationResult).not.toHaveBeenCalled();
  });

  it('scopes saved-result lookup to the authenticated tenant and actor', async () => {
    const harness = setup();
    harness.store.getPreparationResult.mockResolvedValueOnce(null);
    await expect(harness.controller.getPreparationResult(request(), 'result'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(harness.store.getPreparationResult).toHaveBeenCalledWith(TENANT_ID, OPEN_ID, 'result');
    expect(harness.access.resolve).not.toHaveBeenCalled();
    expect(harness.preparations.generate).not.toHaveBeenCalled();
  });

  it('passes only authenticated identity and the URL customer id', async (): Promise<void> => {
    const harness: Harness = setup();

    const result: CustomerCommunicationPreparationResponse =
      await harness.controller.getCustomerCommunication(
        request(),
        'customer-a',
        '2026-10-07',
      );

    expect(result).toBe(response);
    expect(harness.shell.assertPermission.mock.calls.map(
      (call: unknown[]): unknown => call[1],
    )).toEqual([
      'customer:read',
      'opportunity:read',
      'followup:read',
      'playbook:read',
    ]);
    expect(harness.preparations.generate).toHaveBeenCalledWith({
      integration,
      actorOpenId: OPEN_ID,
      customerRecordId: 'customer-a',
      referenceDate: '2026-10-07',
      timezone: 'Asia/Shanghai',
    });
  });

  it('rejects missing login before any product data read', async (): Promise<void> => {
    const harness: Harness = setup();

    await expect(
      harness.controller.getCustomerCommunication(request(false), 'customer-a'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(harness.shell.assertPermission).not.toHaveBeenCalled();
    expect(harness.preparations.generate).not.toHaveBeenCalled();
  });

  it.each([
    'customer:read',
    'opportunity:read',
    'followup:read',
    'playbook:read',
  ])('rejects when %s is missing', async (blockedPermission: string) => {
    const harness: Harness = setup();
    harness.shell.assertPermission.mockImplementation(
      async (_session: unknown, permission: string): Promise<void> => {
        if (permission === blockedPermission) {
          throw new PlatformAccessDeniedError();
        }
      },
    );

    await expect(
      harness.controller.getCustomerCommunication(request(), 'customer-a'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(harness.store.resolveTenantById).not.toHaveBeenCalled();
    expect(harness.preparations.generate).not.toHaveBeenCalled();
  });

  it('rejects mismatched authenticated and platform identities', async (): Promise<void> => {
    const harness: Harness = setup();
    harness.sessions.getSessionByMembership.mockResolvedValueOnce({
      ...platformSession,
      member: { ...platformSession.member, feishuOpenId: 'ou_other' },
    });

    await expect(
      harness.controller.getCustomerCommunication(request(), 'customer-a'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(harness.store.resolveTenantById).not.toHaveBeenCalled();
    expect(harness.preparations.generate).not.toHaveBeenCalled();
  });

  it.each(['cross_tenant', 'inactive'])(
    'fails closed for a %s integration',
    async (failure: string): Promise<void> => {
      const harness: Harness = setup();
      harness.store.resolveTenantById.mockResolvedValueOnce(
        failure === 'cross_tenant'
          ? { ...integration, tenantId: 'other-tenant' }
          : { ...integration, status: 'disabled' },
      );

      await expect(
        harness.controller.getCustomerCommunication(request(), 'customer-a'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(harness.preparations.generate).not.toHaveBeenCalled();
    },
  );
});
