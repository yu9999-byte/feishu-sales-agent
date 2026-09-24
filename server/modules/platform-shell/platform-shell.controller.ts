import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import type { Request } from 'express';
import type {
  PlatformSectionKey,
  PlatformSectionResponse,
  PlatformSessionResponse,
  WorkspaceResponse,
} from '@shared/api.interface';
import {
  FeishuWebAuthService,
  FeishuWebAuthError,
} from '@server/modules/web-auth/feishu-web-auth.service';
import { readSessionCookie } from '@server/modules/web-auth/feishu-web-auth.controller';
import type {
  AuthenticatedWebSession,
} from '@server/modules/web-auth/web-auth.ports';
import { PlatformAccessDeniedError, PlatformSessionService } from './platform-session.service';
import { PlatformShellService } from './platform-shell.service';

@Controller('api/platform')
class PlatformShellController {
  constructor(
    private readonly auth: FeishuWebAuthService,
    private readonly sessions: PlatformSessionService,
    private readonly shell: PlatformShellService,
  ) {}

  @Get('session')
  async getSession(
    @Req() request: Request,
  ): Promise<PlatformSessionResponse> {
    const session: AuthenticatedWebSession =
      await this.authenticatedSession(request);
    try {
      return await this.sessions.getSessionByMembership(
        session.tenantId,
        session.member.id,
      );
    } catch (error: unknown) {
      this.rethrowSafe(error);
    }
  }

  @Get('workspace')
  async getWorkspace(
    @Req() request: Request,
  ): Promise<WorkspaceResponse> {
    const session: AuthenticatedWebSession =
      await this.authenticatedSession(request);
    try {
      return await this.shell.getWorkspace(session);
    } catch (error: unknown) {
      this.rethrowSafe(error);
    }
  }

  @Get('section/:key')
  async getSection(
    @Req() request: Request,
    @Param('key') key: PlatformSectionKey,
  ): Promise<PlatformSectionResponse> {
    const session: AuthenticatedWebSession =
      await this.authenticatedSession(request);
    try {
      return await this.shell.getSection(session, key);
    } catch (error: unknown) {
      this.rethrowSafe(error);
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
      return await this.auth.authenticateSession(token);
    } catch (error: unknown) {
      this.rethrowSafe(error);
    }
  }

  private rethrowSafe(error: unknown): never {
    if (
      error instanceof FeishuWebAuthError &&
      error.code === 'UNAUTHENTICATED'
    ) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: '登录状态已失效，请重新登录',
      });
    }
    if (
      error instanceof FeishuWebAuthError ||
      error instanceof PlatformAccessDeniedError
    ) {
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message: '无权访问当前工作区',
      });
    }
    throw error;
  }
}

export { PlatformShellController };
