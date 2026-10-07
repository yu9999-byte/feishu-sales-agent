import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import type {
  CustomerVisitBriefingResponse,
  PlatformPermission,
  PlatformSessionResponse,
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
import { readSessionCookie } from
  '@server/modules/web-auth/feishu-web-auth.controller';
import {
  FeishuWebAuthError,
  FeishuWebAuthService,
} from '@server/modules/web-auth/feishu-web-auth.service';
import type { AuthenticatedWebSession } from
  '@server/modules/web-auth/web-auth.ports';
import { CustomerVisitBriefingService } from
  './customer-visit-briefing.service';

const REQUIRED_PERMISSIONS: PlatformPermission[] = [
  'customer:read',
  'opportunity:read',
  'followup:read',
];

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

@Controller('api/platform/customer-briefings')
class CustomerVisitBriefingController {
  constructor(
    private readonly auth: FeishuWebAuthService,
    private readonly shell: PlatformShellService,
    private readonly sessions: PlatformSessionService,
    private readonly briefings: CustomerVisitBriefingService,
    @Inject(CONTROL_STORE)
    private readonly controlStore: ControlStore,
  ) {}

  @Get(':customerRecordId')
  async getCustomerBriefing(
    @Req() request: Request,
    @Param('customerRecordId') customerRecordId: string,
    @Query('date') requestedDate?: string,
  ): Promise<CustomerVisitBriefingResponse> {
    const session: AuthenticatedWebSession =
      await this.authenticatedSession(request);
    const platformSession: PlatformSessionResponse =
      await this.authorizedPlatformSession(session);
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
    return this.briefings.generate({
      integration,
      actorOpenId: session.member.feishuOpenId,
      customerRecordId,
      referenceDate,
      timezone: platformSession.tenant.timezone,
    });
  }

  private async authorizedPlatformSession(
    session: AuthenticatedWebSession,
  ): Promise<PlatformSessionResponse> {
    try {
      for (const permission of REQUIRED_PERMISSIONS) {
        await this.shell.assertPermission(session, permission);
      }
      const platformSession: PlatformSessionResponse =
        await this.sessions.getSessionByMembership(
          session.tenantId,
          session.member.id,
        );
      if (
        platformSession.tenant.id !== session.tenantId ||
        platformSession.member.id !== session.member.id ||
        platformSession.member.feishuOpenId !== session.member.feishuOpenId
      ) {
        throw new PlatformAccessDeniedError();
      }
      return platformSession;
    } catch (error: unknown) {
      if (error instanceof PlatformAccessDeniedError) {
        throw new ForbiddenException({
          code: 'ACCESS_DENIED',
          message: '无权读取该客户的拜访准备资料',
        });
      }
      throw error;
    }
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
      const session: AuthenticatedWebSession =
        await this.auth.authenticateSession(token);
      if (
        session.member.status !== 'active' ||
        session.member.tenantId !== session.tenantId
      ) {
        throw new FeishuWebAuthError(
          'ACCESS_DENIED',
          '当前成员身份不可用',
        );
      }
      return session;
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

export { CustomerVisitBriefingController };
