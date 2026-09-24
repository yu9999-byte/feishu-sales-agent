import {
  BadRequestException,
  Controller,
  Get,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';

import type { Request, Response } from 'express';
import {
  FeishuWebAuthError,
  FeishuWebAuthService,
} from './feishu-web-auth.service';

const SESSION_COOKIE: string = 'sales-agent-session';
const OAUTH_STATE_COOKIE: string = 'sales-agent-oauth-state';
const SEVEN_DAYS_MS: number = 7 * 24 * 60 * 60 * 1000;
const OAUTH_STATE_TTL_MS: number = 5 * 60 * 1000;

const readSessionCookie = (request: Request): string | null => {
  const cookieHeader: string | undefined = request.headers.cookie;
  if (!cookieHeader) {
    return null;
  }
  const entry: string | undefined = cookieHeader.split(';').find(
    (part: string): boolean =>
      part.trim().startsWith(`${SESSION_COOKIE}=`),
  );
  if (!entry) {
    return null;
  }
  const value: string = entry.trim().slice(SESSION_COOKIE.length + 1);
  return value.length > 0 ? value : null;
};

const readCookie = (request: Request, name: string): string | null => {
  const cookieHeader: string | undefined = request.headers.cookie;
  if (!cookieHeader) return null;
  const entry: string | undefined = cookieHeader.split(';').find(
    (part: string): boolean => part.trim().startsWith(`${name}=`),
  );
  if (!entry) return null;
  const value: string = entry.trim().slice(name.length + 1);
  return value.length > 0 ? decodeURIComponent(value) : null;
};

@Controller('api/auth/feishu')
class FeishuWebAuthController {
  constructor(private readonly auth: FeishuWebAuthService) {}

  @Get('start')
  async start(
    @Query('tenantKey') tenantKey: string | undefined,
    @Query('returnTo') returnTo: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    if (!tenantKey || tenantKey.trim().length === 0) {
      throw new BadRequestException('缺少企业入口信息');
    }
    try {
      const url: string = await this.auth.startLogin(
        tenantKey,
        returnTo ?? '/',
      );
      const state: string | null = new URL(url).searchParams.get('state');
      if (!state) {
        throw new BadRequestException('登录请求无效');
      }
      response.cookie(OAUTH_STATE_COOKIE, state, {
        httpOnly: true,
        secure: this.auth.secureCookie,
        sameSite: 'lax',
        path: '/api/auth/feishu',
        maxAge: OAUTH_STATE_TTL_MS,
      });
      response.redirect(HttpStatus.FOUND, url);
    } catch (error: unknown) {
      this.sendAuthFailure(response, error);
    }
  }

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    if (error || !code || !state) {
      response.status(HttpStatus.BAD_REQUEST).send(
        '飞书授权未完成，请返回应用重新登录',
      );
      return;
    }
    try {
      const completed = await this.auth.completeLogin(
        code,
        state,
        new Date(),
        readCookie(request, OAUTH_STATE_COOKIE) ?? undefined,
      );
      response.clearCookie(OAUTH_STATE_COOKIE, {
        path: '/api/auth/feishu',
      });
      response.cookie(SESSION_COOKIE, completed.sessionToken, {
        httpOnly: true,
        secure: this.auth.secureCookie,
        sameSite: 'lax',
        path: '/',
        maxAge: SEVEN_DAYS_MS,
      });
      response.redirect(HttpStatus.FOUND, completed.redirectPath);
    } catch (failure: unknown) {
      response.clearCookie(OAUTH_STATE_COOKIE, {
        path: '/api/auth/feishu',
      });
      this.sendAuthFailure(response, failure);
    }
  }

  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    if (request.headers.origin !== this.auth.publicOrigin) {
      response.status(HttpStatus.FORBIDDEN).send('无权执行登出操作');
      return;
    }
    const sessionToken: string | null = readSessionCookie(request);
    if (sessionToken !== null) {
      await this.auth.revokeSession(sessionToken);
    }
    response.clearCookie(SESSION_COOKIE, { path: '/' });
    response.status(HttpStatus.NO_CONTENT).send();
  }

  private sendAuthFailure(response: Response, error: unknown): void {
    if (error instanceof FeishuWebAuthError) {
      const denied: boolean =
        error.code === 'ACCESS_DENIED' ||
        error.code === 'TENANT_MISMATCH';
      response.status(denied ? HttpStatus.FORBIDDEN : HttpStatus.BAD_REQUEST)
        .send(denied
          ? '无权访问当前工作区'
          : '飞书授权未完成或已失效，请重新登录');
      return;
    }
    response.status(HttpStatus.INTERNAL_SERVER_ERROR)
      .send('登录暂时不可用，请稍后重试');
  }
}

export { FeishuWebAuthController, readSessionCookie };
