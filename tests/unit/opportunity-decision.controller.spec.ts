import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';

import type {
  OpportunityDecisionResponse,
  PlatformSessionResponse,
} from '@shared/api.interface';
import type { ControlStore } from
  '@server/modules/agent-core/agent.ports';
import type { TenantIntegration } from
  '@server/modules/agent-core/agent.types';
import { OpportunityDecisionController } from
  '@server/modules/insight/opportunity-decision.controller';
import type { OpportunityDecisionService } from
  '@server/modules/insight/opportunity-decision.service';
import {
  PlatformAccessDeniedError,
  type PlatformSessionService,
} from '@server/modules/platform-shell/platform-session.service';
import type { PlatformShellService } from
  '@server/modules/platform-shell/platform-shell.service';
import type { FeishuWebAuthService } from
  '@server/modules/web-auth/feishu-web-auth.service';

const tenantId = '00000000-0000-4000-8000-00000000000a';
const memberId = '00000000-0000-4000-8000-00000000000b';

const integration: TenantIntegration = {
  tenantId,
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

const response: OpportunityDecisionResponse = {
  referenceDate: '2026-10-06',
  timezone: 'Asia/Shanghai',
  status: 'empty',
  generatedAt: '2026-10-06T04:00:00.000Z',
  summary: {
    totalOpportunityCount: 0,
    activeOpportunityCount: 0,
    excludedClosedOpportunityCount: 0,
    criticalCount: 0,
    atRiskCount: 0,
    needsAttentionCount: 0,
    onTrackCount: 0,
  },
  priorities: [],
  globalTaskAlerts: [],
  coverage: {
    scope: 'self',
    customers: 'complete',
    opportunities: 'complete',
    followups: 'complete',
    taskPromises: 'agent_confirmed_only',
    taskAssociation: 'explicit_agent_confirmation_only',
  },
  warnings: [],
};

const platformSession: PlatformSessionResponse = {
  tenant: { id: tenantId, name: 'Tenant A', timezone: 'Asia/Shanghai' },
  member: {
    id: memberId,
    feishuOpenId: 'ou_sales_a',
    displayName: '销售 A',
  },
  roles: ['sales'],
  permissions: ['opportunity:read'],
  navigation: [],
  policyVersion: 'test',
};

interface Harness {
  controller: OpportunityDecisionController;
  auth: { authenticateSession: ReturnType<typeof vi.fn> };
  shell: { assertPermission: ReturnType<typeof vi.fn> };
  sessions: { getSessionByMembership: ReturnType<typeof vi.fn> };
  decisions: { analyze: ReturnType<typeof vi.fn> };
  store: { resolveTenantById: ReturnType<typeof vi.fn> };
}

const setup = (): Harness => {
  const auth = {
    authenticateSession: vi.fn(async () => ({
      tenantId,
      member: {
        id: memberId,
        tenantId,
        feishuOpenId: 'ou_sales_a',
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
  const decisions = {
    analyze: vi.fn(async (): Promise<OpportunityDecisionResponse> => response),
  };
  const store = {
    resolveTenantById: vi.fn(
      async (): Promise<TenantIntegration | null> => integration,
    ),
  };
  return {
    controller: new OpportunityDecisionController(
      auth as unknown as FeishuWebAuthService,
      shell as unknown as PlatformShellService,
      sessions as unknown as PlatformSessionService,
      decisions as unknown as OpportunityDecisionService,
      store as unknown as ControlStore,
    ),
    auth,
    shell,
    sessions,
    decisions,
    store,
  };
};

const request = (withCookie: boolean = true): Request => ({
  headers: {
    cookie: withCookie ? 'sales-agent-session=session-secret' : undefined,
  },
}) as Request;

describe('OpportunityDecisionController', (): void => {
  it('reads only the authenticated member portfolio with opportunity permission', async (): Promise<void> => {
    const harness: Harness = setup();

    const result: OpportunityDecisionResponse =
      await harness.controller.getOpportunityDecisions(
        request(),
        '2026-10-06',
      );

    expect(result).toBe(response);
    expect(harness.shell.assertPermission).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId }),
      'opportunity:read',
    );
    expect(harness.decisions.analyze).toHaveBeenCalledWith({
      integration,
      actorOpenId: 'ou_sales_a',
      referenceDate: '2026-10-06',
      timezone: 'Asia/Shanghai',
    });
  });

  it('rejects a missing login before reading data', async (): Promise<void> => {
    const harness: Harness = setup();

    await expect(
      harness.controller.getOpportunityDecisions(request(false)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(harness.shell.assertPermission).not.toHaveBeenCalled();
    expect(harness.decisions.analyze).not.toHaveBeenCalled();
  });

  it('rejects a member without opportunity permission', async (): Promise<void> => {
    const harness: Harness = setup();
    harness.shell.assertPermission.mockRejectedValueOnce(
      new PlatformAccessDeniedError(),
    );

    await expect(
      harness.controller.getOpportunityDecisions(request()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(harness.store.resolveTenantById).not.toHaveBeenCalled();
    expect(harness.decisions.analyze).not.toHaveBeenCalled();
  });

  it('fails closed if the resolved integration belongs to another tenant', async (): Promise<void> => {
    const harness: Harness = setup();
    harness.store.resolveTenantById.mockResolvedValueOnce({
      ...integration,
      tenantId: '00000000-0000-4000-8000-000000000099',
    });

    await expect(
      harness.controller.getOpportunityDecisions(request()),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(harness.decisions.analyze).not.toHaveBeenCalled();
  });
});
