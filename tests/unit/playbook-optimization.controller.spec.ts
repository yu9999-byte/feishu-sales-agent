import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';

import { PlaybookOptimizationController } from
  '@server/modules/knowledge/playbook-optimization.controller';
import { PlaybookOptimizationModule } from
  '@server/modules/knowledge/playbook-optimization.module';
import { PlaybookOptimizationError } from
  '@server/modules/knowledge/playbook-optimization.service';
import { PlatformAccessDeniedError } from
  '@server/modules/platform-shell/platform-session.service';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const MEMBER_ID = '20000000-0000-4000-8000-000000000001';
const UPDATED_AT = '2026-10-08T03:00:00.000Z';

const request = (): Request => ({
  headers: { cookie: 'sales-agent-session=session-token' },
} as never);

const session = {
  tenantId: TENANT_ID,
  member: {
    id: MEMBER_ID,
    tenantId: TENANT_ID,
    feishuOpenId: 'ou_manager',
    displayName: '销售经理',
    status: 'active' as const,
  },
  tokenHash: 'hash',
};

const setup = (overrides: {
  authenticateSession?: ReturnType<typeof vi.fn>;
  assertPermission?: ReturnType<typeof vi.fn>;
  list?: ReturnType<typeof vi.fn>;
  review?: ReturnType<typeof vi.fn>;
} = {}) => {
  const authenticateSession = overrides.authenticateSession ??
    vi.fn(async () => session);
  const assertPermission = overrides.assertPermission ??
    vi.fn(async (): Promise<void> => undefined);
  const list = overrides.list ?? vi.fn(async () => ({
    status: 'ready' as const,
    items: [],
    summary: {
      pendingReview: 0,
      observing: 0,
      acceptedForAuthoring: 0,
      dismissed: 0,
    },
  }));
  const review = overrides.review ?? vi.fn(async () => ({
    reviewId: 'review-1',
    candidate: {},
  }));
  return {
    authenticateSession,
    assertPermission,
    list,
    review,
    controller: new PlaybookOptimizationController(
      { authenticateSession } as never,
      { assertPermission } as never,
      { list, review } as never,
    ),
  };
};

describe('PlaybookOptimizationController', (): void => {
  it('is registered in the optimization module', (): void => {
    const controllers: unknown[] = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      PlaybookOptimizationModule,
    ) ?? [];
    expect(controllers).toContain(PlaybookOptimizationController);
  });

  it('requires a trusted web session', async (): Promise<void> => {
    const { controller, authenticateSession, list } = setup();
    await expect(controller.list({ headers: {} } as never))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(authenticateSession).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it('requires playbook review permission', async (): Promise<void> => {
    const assertPermission = vi.fn(async (): Promise<void> => {
      throw new PlatformAccessDeniedError();
    });
    const { controller, list } = setup({ assertPermission });
    await expect(controller.list(request()))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(assertPermission).toHaveBeenCalledWith(session, 'playbook:review');
    expect(list).not.toHaveBeenCalled();
  });

  it('injects tenant and reviewer from the session', async (): Promise<void> => {
    const { controller, review } = setup();
    await controller.review(request(), 'candidate-1', {
      tenantId: 'attacker-tenant',
      reviewerMemberId: 'attacker-member',
      decision: 'accept_for_authoring',
      expectedUpdatedAt: UPDATED_AT,
      note: '证据充分，进入资料编写',
    });
    expect(review).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      reviewerMemberId: MEMBER_ID,
      candidateId: 'candidate-1',
      decision: 'accept_for_authoring',
      expectedUpdatedAt: UPDATED_AT,
      note: '证据充分，进入资料编写',
    });
  });

  it('maps optimistic conflicts to HTTP 409', async (): Promise<void> => {
    const review = vi.fn(async (): Promise<never> => {
      throw new PlaybookOptimizationError(
        'CONFLICT',
        '候选已发生变化，请刷新后重新审核',
        '2026-10-08T03:01:00.000Z',
      );
    });
    const { controller } = setup({ review });
    await expect(controller.review(request(), 'candidate-1', {
      decision: 'dismiss',
      expectedUpdatedAt: UPDATED_AT,
      note: '当前证据不足，暂不编写',
    })).rejects.toBeInstanceOf(ConflictException);
  });
});
