import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

import type {
  CustomerCommunicationPreparationResponse,
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
  permissions: ['customer:read', 'opportunity:read', 'followup:read'],
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
  store: { resolveTenantById: ReturnType<typeof vi.fn> };
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
    resolveTenantById: vi.fn(
      async (): Promise<TenantIntegration | null> => integration,
    ),
  };
  return {
    controller: new CustomerCommunicationPreparationController(
      auth as unknown as FeishuWebAuthService,
      shell as unknown as PlatformShellService,
      sessions as unknown as PlatformSessionService,
      preparations as unknown as CustomerCommunicationPreparationService,
      store as unknown as ControlStore,
    ),
    shell,
    sessions,
    preparations,
    store,
  };
};

const request = (withCookie: boolean = true): Request => ({
  headers: {
    cookie: withCookie ? 'sales-agent-session=session-secret' : undefined,
  },
}) as Request;

describe('CustomerCommunicationPreparationController', (): void => {
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
    )).toEqual(['customer:read', 'opportunity:read', 'followup:read']);
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

