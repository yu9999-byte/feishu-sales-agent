import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

import type {
  PlatformSessionResponse,
  TeamOpportunityDecisionResponse,
} from '@shared/api.interface';
import type { ControlStore } from
  '@server/modules/agent-core/agent.ports';
import type { TenantIntegration } from
  '@server/modules/agent-core/agent.types';
import { TeamOpportunityDecisionController } from
  '@server/modules/insight/team-opportunity-decision.controller';
import type { TeamOpportunityDecisionService } from
  '@server/modules/insight/team-opportunity-decision.service';
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

const platformSession: PlatformSessionResponse = {
  tenant: { id: tenantId, name: 'Tenant A', timezone: 'Asia/Shanghai' },
  member: { id: memberId, feishuOpenId: 'ou_manager', displayName: '主管' },
  roles: ['manager'],
  permissions: ['review:read-team', 'opportunity:read'],
  navigation: [],
  policyVersion: 'test',
};

const response: TeamOpportunityDecisionResponse = {
  referenceDate: '2026-10-07',
  timezone: 'Asia/Shanghai',
  status: 'empty',
  generatedAt: '2026-10-07T04:00:00.000Z',
  scope: 'team',
  metrics: {
    memberCount: 1,
    readableMemberCount: 1,
    activeOpportunityCount: 0,
    criticalCount: 0,
    atRiskCount: 0,
    needsAttentionCount: 0,
    onTrackCount: 0,
    knownExpectedAmount: null,
  },
  priorities: [],
  members: [],
  managerActions: [],
  taskAlerts: [],
  warnings: [],
};

interface Harness {
  controller: TeamOpportunityDecisionController;
  shell: { assertPermission: ReturnType<typeof vi.fn> };
  sessions: { getSessionByMembership: ReturnType<typeof vi.fn> };
  decisions: { generate: ReturnType<typeof vi.fn> };
  store: { resolveTenantById: ReturnType<typeof vi.fn> };
}

const setup = (): Harness => {
  const auth = {
    authenticateSession: vi.fn(async () => ({
      tenantId,
      member: {
        id: memberId,
        tenantId,
        feishuOpenId: 'ou_manager',
        displayName: '主管',
        status: 'active',
      },
      tokenHash: 'hash',
    })),
  };
  const shell = {
    assertPermission: vi.fn(async (): Promise<void> => undefined),
  };
  const sessions = {
    getSessionByMembership: vi.fn(async () => platformSession),
  };
  const decisions = {
    generate: vi.fn(async () => response),
  };
  const store = {
    resolveTenantById: vi.fn(async () => integration),
  };
  return {
    controller: new TeamOpportunityDecisionController(
      auth as unknown as FeishuWebAuthService,
      shell as unknown as PlatformShellService,
      sessions as unknown as PlatformSessionService,
      decisions as unknown as TeamOpportunityDecisionService,
      store as unknown as ControlStore,
    ),
    shell,
    sessions,
    decisions,
    store,
  };
};

const request = (withCookie = true): Request => ({
  headers: {
    cookie: withCookie ? 'sales-agent-session=session-secret' : undefined,
  },
}) as Request;

describe('TeamOpportunityDecisionController', (): void => {
  it('requires both team review and opportunity permissions', async (): Promise<void> => {
    const harness = setup();

    const result = await harness.controller.getTeamOpportunityDecisions(
      request(),
      '2026-10-07',
    );

    expect(result).toBe(response);
    expect(harness.shell.assertPermission).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ tenantId }),
      'review:read-team',
    );
    expect(harness.shell.assertPermission).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ tenantId }),
      'opportunity:read',
    );
    expect(harness.decisions.generate).toHaveBeenCalledWith({
      integration,
      session: platformSession,
      referenceDate: '2026-10-07',
      timezone: 'Asia/Shanghai',
    });
  });

  it('returns 401 before any business read when login is missing', async (): Promise<void> => {
    const harness = setup();

    await expect(
      harness.controller.getTeamOpportunityDecisions(request(false)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(harness.shell.assertPermission).not.toHaveBeenCalled();
    expect(harness.decisions.generate).not.toHaveBeenCalled();
  });

  it('returns 403 when either required permission is denied', async (): Promise<void> => {
    const harness = setup();
    harness.shell.assertPermission
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new PlatformAccessDeniedError());

    await expect(
      harness.controller.getTeamOpportunityDecisions(request()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(harness.store.resolveTenantById).not.toHaveBeenCalled();
  });

  it('fails closed for a cross-tenant session or integration', async (): Promise<void> => {
    const sessionHarness = setup();
    sessionHarness.sessions.getSessionByMembership.mockResolvedValueOnce({
      ...platformSession,
      tenant: { ...platformSession.tenant, id: 'other-tenant' },
    });
    await expect(
      sessionHarness.controller.getTeamOpportunityDecisions(request()),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const integrationHarness = setup();
    integrationHarness.store.resolveTenantById.mockResolvedValueOnce({
      ...integration,
      tenantId: 'other-tenant',
    });
    await expect(
      integrationHarness.controller.getTeamOpportunityDecisions(request()),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(integrationHarness.decisions.generate).not.toHaveBeenCalled();
  });
});
