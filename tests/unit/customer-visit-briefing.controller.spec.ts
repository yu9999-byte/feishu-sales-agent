import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

import type {
  CustomerVisitBriefingResponse,
  PlatformSessionResponse,
} from '@shared/api.interface';
import type { ControlStore } from
  '@server/modules/agent-core/agent.ports';
import type { TenantIntegration } from
  '@server/modules/agent-core/agent.types';
import { CustomerVisitBriefingController } from
  '@server/modules/insight/customer-visit-briefing.controller';
import type { CustomerVisitBriefingService } from
  '@server/modules/insight/customer-visit-briefing.service';
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

const briefing: CustomerVisitBriefingResponse = {
  referenceDate: '2026-10-07',
  timezone: 'Asia/Shanghai',
  status: 'empty',
  generatedAt: '2026-10-07T04:00:00.000Z',
  customer: null,
  metrics: {
    relatedOpportunityCount: 0,
    activeOpportunityCount: 0,
    riskOpportunityCount: 0,
    totalFollowupCount: 0,
    knownActiveExpectedAmount: null,
  },
  opportunities: [],
  recentFollowups: [],
  questions: [],
  agenda: [],
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
  controller: CustomerVisitBriefingController;
  auth: { authenticateSession: ReturnType<typeof vi.fn> };
  shell: { assertPermission: ReturnType<typeof vi.fn> };
  sessions: { getSessionByMembership: ReturnType<typeof vi.fn> };
  briefings: { generate: ReturnType<typeof vi.fn> };
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
  const briefings = {
    generate: vi.fn(
      async (): Promise<CustomerVisitBriefingResponse> => briefing,
    ),
  };
  const store = {
    resolveTenantById: vi.fn(
      async (): Promise<TenantIntegration | null> => integration,
    ),
  };
  return {
    controller: new CustomerVisitBriefingController(
      auth as unknown as FeishuWebAuthService,
      shell as unknown as PlatformShellService,
      sessions as unknown as PlatformSessionService,
      briefings as unknown as CustomerVisitBriefingService,
      store as unknown as ControlStore,
    ),
    auth,
    shell,
    sessions,
    briefings,
    store,
  };
};

const request = (withCookie: boolean = true): Request => ({
  headers: {
    cookie: withCookie ? 'sales-agent-session=session-secret' : undefined,
  },
}) as Request;

describe('CustomerVisitBriefingController', (): void => {
  it('passes only the authenticated member open id and URL customer id', async (): Promise<void> => {
    const harness: Harness = setup();

    const result: CustomerVisitBriefingResponse =
      await harness.controller.getCustomerBriefing(
        request(),
        'customer-a',
        '2026-10-07',
      );

    expect(result).toBe(briefing);
    expect(harness.shell.assertPermission.mock.calls.map(
      (call: unknown[]): unknown => call[1],
    )).toEqual(['customer:read', 'opportunity:read', 'followup:read']);
    expect(harness.briefings.generate).toHaveBeenCalledWith({
      integration,
      actorOpenId: OPEN_ID,
      customerRecordId: 'customer-a',
      referenceDate: '2026-10-07',
      timezone: 'Asia/Shanghai',
    });
  });

  it('rejects a missing login before reading data', async (): Promise<void> => {
    const harness: Harness = setup();

    await expect(
      harness.controller.getCustomerBriefing(request(false), 'customer-a'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(harness.shell.assertPermission).not.toHaveBeenCalled();
    expect(harness.briefings.generate).not.toHaveBeenCalled();
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
      harness.controller.getCustomerBriefing(request(), 'customer-a'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(harness.store.resolveTenantById).not.toHaveBeenCalled();
    expect(harness.briefings.generate).not.toHaveBeenCalled();
  });

  it('rejects a platform session that does not match authenticated identity', async (): Promise<void> => {
    const harness: Harness = setup();
    harness.sessions.getSessionByMembership.mockResolvedValueOnce({
      ...platformSession,
      member: { ...platformSession.member, feishuOpenId: 'ou_other' },
    });

    await expect(
      harness.controller.getCustomerBriefing(request(), 'customer-a'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(harness.store.resolveTenantById).not.toHaveBeenCalled();
    expect(harness.briefings.generate).not.toHaveBeenCalled();
  });

  it.each(['cross_tenant', 'inactive'])(
    'fails closed for a %s integration',
    async (failure: string) => {
      const harness: Harness = setup();
      harness.store.resolveTenantById.mockResolvedValueOnce(
        failure === 'cross_tenant'
          ? { ...integration, tenantId: 'other-tenant' }
          : { ...integration, status: 'disabled' },
      );

      await expect(
        harness.controller.getCustomerBriefing(request(), 'customer-a'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(harness.briefings.generate).not.toHaveBeenCalled();
    },
  );
});
