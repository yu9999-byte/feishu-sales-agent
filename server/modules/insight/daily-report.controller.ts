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
  DailySalesReportResponse,
  PlatformSessionResponse,
} from '@shared/api.interface';
import {
  CONTROL_STORE,
  type ControlStore,
} from '@server/modules/agent-core/agent.ports';
import {
  FeishuWebAuthError,
  FeishuWebAuthService,
} from '@server/modules/web-auth/feishu-web-auth.service';
import { readSessionCookie } from '@server/modules/web-auth/feishu-web-auth.controller';
import type {
  AuthenticatedWebSession,
} from '@server/modules/web-auth/web-auth.ports';
import {
  PlatformAccessDeniedError,
  PlatformSessionService,
} from '@server/modules/platform-shell/platform-session.service';
import {
  PlatformShellService,
} from '@server/modules/platform-shell/platform-shell.service';
import {
  DailySalesReportService,
} from './daily-sales-report.service';

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
class DailyReportController {
  constructor(
    private readonly auth: FeishuWebAuthService,
    private readonly shell: PlatformShellService,
    private readonly sessions: PlatformSessionService,
    private readonly reports: DailySalesReportService,
    @Inject(CONTROL_STORE)
    private readonly controlStore: ControlStore,
  ) {}

  @Get('daily-report')
  async getDailyReport(
    @Req() request: Request,
    @Query('date') requestedDate?: string,
  ): Promise<DailySalesReportResponse> {
    const session: AuthenticatedWebSession =
      await this.authenticatedSession(request);
    let platformSession: PlatformSessionResponse;
    try {
      await this.shell.assertPermission(session, 'review:read-personal');
      platformSession = await this.sessions.getSessionByMembership(
        session.tenantId,
        session.member.id,
      );
    } catch (error: unknown) {
      if (error instanceof PlatformAccessDeniedError) {
        throw new ForbiddenException({
          code: 'ACCESS_DENIED',
          message: '无权读取个人销售日报',
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
    const reportDate: string = requestedDate?.trim() ||
      formatLocalDate(new Date(), platformSession.tenant.timezone);
    return this.reports.generate({
      integration,
      actorOpenId: session.member.feishuOpenId,
      reportDate,
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

export { DailyReportController };
