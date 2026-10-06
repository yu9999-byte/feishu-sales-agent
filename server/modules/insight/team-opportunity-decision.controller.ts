import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import type {
  PlatformSessionResponse,
  TeamOpportunityDecisionResponse,
} from '@shared/api.interface';
import {
  CONTROL_STORE,
  type ControlStore,
} from '@server/modules/agent-core/agent.ports';
import type { TenantIntegration } from
  '@server/modules/agent-core/agent.types';
import {
  PlatformAccessDeniedError,
  PlatformSessionService,
} from '@server/modules/platform-shell/platform-session.service';
import { PlatformShellService } from
  '@server/modules/platform-shell/platform-shell.service';
import {
  FeishuWebAuthError,
  FeishuWebAuthService,
} from '@server/modules/web-auth/feishu-web-auth.service';
import { readSessionCookie } from
  '@server/modules/web-auth/feishu-web-auth.controller';
import type { AuthenticatedWebSession } from
  '@server/modules/web-auth/web-auth.ports';
import { TeamOpportunityDecisionService } from
  './team-opportunity-decision.service';

const formatLocalDate = (value: Date, timezone: string): string => {
  const parts: Intl.DateTimeFormatPart[] = new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    },
  ).formatToParts(value);
  const partValue = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(
      (part: Intl.DateTimeFormatPart): boolean => part.type === type,
    )?.value ?? '';
  return [partValue('year'), partValue('month'), partValue('day')].join('-');
};

@Controller('api/platform')
class TeamOpportunityDecisionController {
  constructor(
    private readonly auth: FeishuWebAuthService,
    private readonly shell: PlatformShellService,
    private readonly sessions: PlatformSessionService,
    private readonly decisions: TeamOpportunityDecisionService,
    @Inject(CONTROL_STORE)
    private readonly controlStore: ControlStore,
  ) {}

  @Get('team-opportunity-decisions')
  async getTeamOpportunityDecisions(
    @Req() request: Request,
    @Query('date') requestedDate?: string,
  ): Promise<TeamOpportunityDecisionResponse> {
    const session: AuthenticatedWebSession =
      await this.authenticatedSession(request);
    let platformSession: PlatformSessionResponse;
    try {
      await this.shell.assertPermission(session, 'review:read-team');
      await this.shell.assertPermission(session, 'opportunity:read');
      platformSession = await this.sessions.getSessionByMembership(
        session.tenantId,
        session.member.id,
      );
    } catch (error: unknown) {
      if (error instanceof PlatformAccessDeniedError) {
        throw new ForbiddenException({
          code: 'ACCESS_DENIED',
          message: '无权读取团队客户与商机决策',
        });
      }
      throw error;
    }
    if (
      platformSession.tenant.id !== session.tenantId ||
      platformSession.member.id !== session.member.id ||
      platformSession.member.feishuOpenId !== session.member.feishuOpenId
    ) {
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message: '当前登录身份与团队成员不一致',
      });
    }

    const integration: TenantIntegration | null =
      await this.controlStore.resolveTenantById(session.tenantId);
    if (
      integration === null ||
      integration.status !== 'active' ||
      integration.tenantId !== session.tenantId
    ) {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        message: '客户与商机数据源暂时不可用',
      });
    }
    const referenceDate: string = requestedDate?.trim() ||
      formatLocalDate(new Date(), platformSession.tenant.timezone);
    return this.decisions.generate({
      integration,
      session: platformSession,
      referenceDate,
      timezone: platformSession.tenant.timezone,
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

export { TeamOpportunityDecisionController };
