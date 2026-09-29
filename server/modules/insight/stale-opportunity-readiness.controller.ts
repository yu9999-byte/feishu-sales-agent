import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import type { Request } from 'express';
import type { StaleOpportunityReadinessResponse } from '@shared/api.interface';
import {
  CONTROL_STORE,
  type ControlStore,
} from '@server/modules/agent-core/agent.ports';
import {
  FeishuWebAuthError,
  FeishuWebAuthService,
} from '@server/modules/web-auth/feishu-web-auth.service';
import { readSessionCookie } from '@server/modules/web-auth/feishu-web-auth.controller';
import type { AuthenticatedWebSession } from
  '@server/modules/web-auth/web-auth.ports';
import {
  PlatformAccessDeniedError,
} from '@server/modules/platform-shell/platform-session.service';
import { PlatformShellService } from
  '@server/modules/platform-shell/platform-shell.service';
import { StaleOpportunityReadinessService } from
  './stale-opportunity-readiness.service';

@Controller('api/platform')
class StaleOpportunityReadinessController {
  constructor(
    private readonly auth: FeishuWebAuthService,
    private readonly shell: PlatformShellService,
    private readonly readiness: StaleOpportunityReadinessService,
    @Inject(CONTROL_STORE)
    private readonly controlStore: ControlStore,
  ) {}

  @Get('stale-opportunity-readiness')
  async getReadiness(
    @Req() request: Request,
  ): Promise<StaleOpportunityReadinessResponse> {
    const session: AuthenticatedWebSession =
      await this.authenticatedSession(request);
    try {
      await this.shell.assertPermission(session, 'review:read-personal');
    } catch (error: unknown) {
      if (error instanceof PlatformAccessDeniedError) {
        throw new ForbiddenException({
          code: 'ACCESS_DENIED',
          message: '无权读取商机提醒数据准备度',
        });
      }
      throw error;
    }
    const integration = await this.controlStore.resolveTenantById(
      session.tenantId,
    );
    if (integration === null || integration.status !== 'active') {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: '销售数据源暂时不可用',
      });
    }
    return this.readiness.generate({
      integration,
      actorOpenId: session.member.feishuOpenId,
      now: new Date(),
    });
  }

  private async authenticatedSession(
    request: Request,
  ): Promise<AuthenticatedWebSession> {
    const token: string | null = readSessionCookie(request);
    if (token === null) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: '请先通过飞书登录',
      });
    }
    try {
      return await this.auth.authenticateSession(token);
    } catch (error: unknown) {
      if (
        error instanceof FeishuWebAuthError &&
        error.code === 'UNAUTHENTICATED'
      ) {
        throw new UnauthorizedException({
          code: 'UNAUTHENTICATED',
          message: '登录状态已失效，请重新登录',
        });
      }
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message: '无权访问当前工作区',
      });
    }
  }
}

export { StaleOpportunityReadinessController };
