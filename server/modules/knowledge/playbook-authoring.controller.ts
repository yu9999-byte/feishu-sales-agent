import {
  Body, ConflictException, Controller, ForbiddenException, Get, Header, Inject,
  NotFoundException, Param, Post, Query, Req, ServiceUnavailableException,
  UnauthorizedException, UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { PlaybookDraftResponse, PlaybookDraftVersion } from '@shared/api.interface';
import { PlatformAccessDeniedError } from '@server/modules/platform-shell/platform-session.service';
import { PlatformShellService } from '@server/modules/platform-shell/platform-shell.service';
import { readSessionCookie } from '@server/modules/web-auth/feishu-web-auth.controller';
import { FeishuWebAuthError, FeishuWebAuthService } from
  '@server/modules/web-auth/feishu-web-auth.service';
import type { AuthenticatedWebSession } from '@server/modules/web-auth/web-auth.ports';
import { PlaybookAuthoringError, PlaybookAuthoringService } from './playbook-authoring.service';

@Controller('api/platform/playbook-candidates/:candidateId/draft')
class PlaybookAuthoringController {
  constructor(
    @Inject(FeishuWebAuthService) private readonly auth: FeishuWebAuthService,
    @Inject(PlatformShellService) private readonly shell: PlatformShellService,
    @Inject(PlaybookAuthoringService) private readonly authoring: PlaybookAuthoringService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @Req() request: Request, @Param('candidateId') candidateId: string,
    @Query('beforeVersion') beforeVersion?: string,
  ): Promise<PlaybookDraftResponse> {
    const session: AuthenticatedWebSession = await this.authorizedSession(request);
    try { return await this.authoring.list(session.tenantId, candidateId, beforeVersion); }
    catch (error: unknown) { this.rethrow(error); }
  }

  @Get('versions/:version')
  @Header('Cache-Control', 'no-store')
  async get(
    @Req() request: Request, @Param('candidateId') candidateId: string,
    @Param('version') version: string,
  ): Promise<PlaybookDraftVersion> {
    const session: AuthenticatedWebSession = await this.authorizedSession(request);
    try { return await this.authoring.get(session.tenantId, candidateId, version); }
    catch (error: unknown) { this.rethrow(error); }
  }

  @Post('versions')
  @Header('Cache-Control', 'no-store')
  async save(
    @Req() request: Request, @Param('candidateId') candidateId: string, @Body() body: unknown,
  ): Promise<PlaybookDraftVersion> {
    const session: AuthenticatedWebSession = await this.authorizedSession(request);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message: '草稿参数格式无效' });
    }
    const value = body as Record<string, unknown>;
    if (typeof value.expectedVersion !== 'number' || typeof value.requestId !== 'string' ||
      typeof value.title !== 'string' || typeof value.body !== 'string' ||
      typeof value.applicability !== 'string' || typeof value.changeNote !== 'string') {
      throw new UnprocessableEntityException({ code: 'VALIDATION_FAILED', message: '请填写完整的草稿内容' });
    }
    try {
      return await this.authoring.save({
        tenantId: session.tenantId, candidateId, authorMemberId: session.member.id,
        expectedVersion: value.expectedVersion, requestId: value.requestId, title: value.title,
        body: value.body, applicability: value.applicability, changeNote: value.changeNote,
      });
    } catch (error: unknown) { this.rethrow(error); }
  }

  private async authorizedSession(request: Request): Promise<AuthenticatedWebSession> {
    const token: string | null = readSessionCookie(request);
    if (token === null) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: '请先通过飞书登录' });
    let session: AuthenticatedWebSession;
    try { session = await this.auth.authenticateSession(token); }
    catch (error: unknown) {
      if (error instanceof FeishuWebAuthError && error.code === 'UNAUTHENTICATED') {
        throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: '登录状态已失效' });
      }
      throw new ForbiddenException({ code: 'ACCESS_DENIED', message: '无法验证当前身份' });
    }
    try { await this.shell.assertPermission(session, 'playbook:review'); }
    catch (error: unknown) {
      if (error instanceof PlatformAccessDeniedError) {
        throw new ForbiddenException({ code: 'ACCESS_DENIED', message: '无权编写或查看知识草稿' });
      }
      throw error;
    }
    return session;
  }

  private rethrow(error: unknown): never {
    if (!(error instanceof PlaybookAuthoringError)) throw error;
    const response = { code: error.code, message: error.message };
    if (error.code === 'NOT_FOUND') throw new NotFoundException(response);
    if (error.code === 'CONFLICT') throw new ConflictException(response);
    if (error.code === 'VALIDATION_FAILED') throw new UnprocessableEntityException(response);
    throw new ServiceUnavailableException(response);
  }
}

export { PlaybookAuthoringController };
